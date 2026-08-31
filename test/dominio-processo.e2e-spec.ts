import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Pool } from 'pg';
import { abrirPool, limparDominio, violacao } from './helpers/postgres.js';

// Regras processuais que vivem no banco (IN 002/2026). Cada teste aponta o
// artigo e o nome da constraint — se alguém mexer na migração, é o nome que
// vai aparecer no diff do teste.

describe('Domínio — regras do processo', () => {
  let pool: Pool;
  let pessoaId: number;
  let imovelId: number;
  let imovel2Id: number;
  let processoId: number;
  let dciId: number;
  let digofId: number;

  beforeAll(async () => {
    pool = abrirPool();
    await limparDominio(pool);

    const municipio = await pool.query<{ id: number }>(
      `INSERT INTO municipios ("codigoIbge", nome) VALUES ('1400100','Boa Vista') RETURNING id`,
    );
    const municipioId = municipio.rows[0].id;

    await pool.query(
      `INSERT INTO modulos_fiscais ("municipioId", hectares, "fundamentoLegal", "vigenciaInicio")
       VALUES ($1, 75.0000, 'INCRA — módulo fiscal de Boa Vista/RR', '2020-01-01')`,
      [municipioId],
    );

    await pool.query(
      `INSERT INTO faixas_modulo_fiscal
         (codigo, descricao, "limiteInferiorExclusivo", "limiteSuperiorInclusivo",
          "anexoReferencia", "fundamentoLegal", "vigenciaInicio")
       VALUES
         ('ATE_1',    'Até 1 módulo fiscal',        0, 1,    'VII',  'IN 002/2026, Art. 10', '2026-05-18'),
         ('DE_1_A_4', 'Acima de 1 até 4 módulos',   1, 4,    'VIII', 'IN 002/2026, Art. 11', '2026-05-18'),
         ('ACIMA_4',  'Acima de 4 módulos fiscais', 4, NULL, 'IX',   'IN 002/2026, Art. 12', '2026-05-18')`,
    );

    const setores = await pool.query<{ id: number; sigla: string }>(
      `INSERT INTO setores (sigla, nome, "papelRbac") VALUES
         ('DCI',  'Divisão de Cidadania',              'atendimento'),
         ('DIGOF','Diretoria de Governança Fundiária', 'governanca')
       RETURNING id, sigla`,
    );
    dciId = setores.rows.find((s) => s.sigla === 'DCI')!.id;
    digofId = setores.rows.find((s) => s.sigla === 'DIGOF')!.id;

    const pessoa = await pool.query<{ id: number }>(
      `INSERT INTO pessoas ("tipoPessoa", nome, cpf, "condicaoNacionalidade")
       VALUES ('FISICA','Requerente Teste','12345678901','BRASILEIRO_NATO') RETURNING id`,
    );
    pessoaId = pessoa.rows[0].id;

    // Polígono de ~1 km² perto de Boa Vista, em SIRGAS 2000 (EPSG:4674)
    const imovel = await pool.query<{ id: number }>(
      `INSERT INTO imoveis (denominacao, "municipioId", "areaDeclaradaHa", perimetro)
       VALUES ('Sítio Teste', $1, 100.0000,
               ST_Multi(ST_GeomFromText(
                 'POLYGON((-60.70 2.80,-60.69 2.80,-60.69 2.81,-60.70 2.81,-60.70 2.80))', 4674)))
       RETURNING id`,
      [municipioId],
    );
    imovelId = imovel.rows[0].id;

    const imovel2 = await pool.query<{ id: number }>(
      `INSERT INTO imoveis (denominacao, "municipioId", "areaDeclaradaHa")
       VALUES ('Sítio Vizinho', $1, 50.0000) RETURNING id`,
      [municipioId],
    );
    imovel2Id = imovel2.rows[0].id;

    const processo = await pool.query<{ id: number }>(
      `INSERT INTO processos ("numeroSei", "interessadoId", "imovelId", "faixaModuloFiscalId",
                              "moduloFiscalAplicadoHa", "numeroModulosFiscais", "marcoTemporalAplicado")
       VALUES ('SEI-0001', $1, $2, 2, 75.0000, 1.3333, '2017-11-17') RETURNING id`,
      [pessoaId, imovelId],
    );
    processoId = processo.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // -- duplicidade -----------------------------------------------------------

  it('Art. 5º pu: recusa segundo processo do mesmo interessado sobre o mesmo imóvel', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO processos ("numeroSei", "interessadoId", "imovelId") VALUES ('SEI-0002', $1, $2)`,
        [pessoaId, imovelId],
      ),
    );

    expect(erro.code).toBe('23505');
    expect(erro.constraint).toBe('ux_processo_ativo_por_interessado_imovel');
  });

  it('a vedação alcança só o processo VIVO: arquivado libera novo pedido', async () => {
    // O índice é parcial (EM_TRAMITE, SOBRESTADO, EM_CONFLITO). É essa metade
    // que costuma quebrar em refatoração: proibir sempre impediria o cidadão
    // de tentar de novo depois do arquivamento.
    const pessoa = await pool.query<{ id: number }>(
      `INSERT INTO pessoas ("tipoPessoa", nome, cpf) VALUES ('FISICA','Outro Requerente','98765432100') RETURNING id`,
    );
    const outroId = pessoa.rows[0].id;

    await pool.query(
      `INSERT INTO processos ("numeroSei","interessadoId","imovelId",situacao,"dataEncerramento")
       VALUES ('SEI-9001', $1, $2, 'ARQUIVADO', now())`,
      [outroId, imovel2Id],
    );
    await pool.query(
      `INSERT INTO processos ("numeroSei","interessadoId","imovelId")
       VALUES ('SEI-9002', $1, $2)`,
      [outroId, imovel2Id],
    );

    const { rows } = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM processos WHERE "interessadoId" = $1`,
      [outroId],
    );
    expect(Number(rows[0].total)).toBe(2);
  });

  it('situação terminal e data de encerramento andam sempre juntas', async () => {
    const pessoa = await pool.query<{ id: number }>(
      `INSERT INTO pessoas ("tipoPessoa", nome, cpf) VALUES ('FISICA','Terceiro','11122233344') RETURNING id`,
    );
    const terceiroId = pessoa.rows[0].id;

    // arquivar sem dizer quando não é arquivar
    const semData = await violacao(() =>
      pool.query(
        `INSERT INTO processos ("numeroSei","interessadoId","imovelId",situacao)
         VALUES ('SEI-9010', $1, $2, 'ARQUIVADO')`,
        [terceiroId, imovel2Id],
      ),
    );
    expect(semData.constraint).toBe('ck_processo_encerrado');

    // e a recíproca: processo vivo não tem data de encerramento
    const vivoComData = await violacao(() =>
      pool.query(
        `INSERT INTO processos ("numeroSei","interessadoId","imovelId","dataEncerramento")
         VALUES ('SEI-9011', $1, $2, now())`,
        [terceiroId, imovel2Id],
      ),
    );
    expect(vivoComData.constraint).toBe('ck_processo_encerrado');
  });

  // -- tramitação ------------------------------------------------------------

  it('Art. 78: recusa segunda tramitação aberta no mesmo processo', async () => {
    await pool.query(
      `INSERT INTO tramitacoes ("processoId","setorDestinoId","etapaAnexoX") VALUES ($1,$2,1)`,
      [processoId, dciId],
    );

    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO tramitacoes ("processoId","setorDestinoId","etapaAnexoX") VALUES ($1,$2,2)`,
        [processoId, digofId],
      ),
    );

    expect(erro.code).toBe('23505');
    expect(erro.constraint).toBe('ux_tramitacao_aberta_por_processo');
  });

  // -- vigências -------------------------------------------------------------

  it('recusa faixas de módulo fiscal sobrepostas (Art. 10 vs Art. 11 lidos ao pé da letra)', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO faixas_modulo_fiscal
           (codigo, descricao, "limiteInferiorExclusivo", "limiteSuperiorInclusivo",
            "anexoReferencia", "fundamentoLegal", "vigenciaInicio")
         VALUES ('ATE_4_LITERAL','Até 4 módulos, leitura literal', 0, 4, 'VIII',
                 'IN 002/2026, Art. 11', '2026-05-18')`,
      ),
    );

    expect(erro.code).toBe('23P01'); // exclusion_violation
    expect(erro.constraint).toBe('ex_faixa_sem_sobreposicao');
  });

  it('recusa duas vigências abertas para o mesmo parâmetro normativo', async () => {
    await pool.query(
      `INSERT INTO parametros_normativos (chave,"valorData","fundamentoLegal","vigenciaInicio")
       VALUES ('MARCO_TEMPORAL_OCUPACAO','2017-11-17','IN 002/2026, Art. 11 §1º','2026-05-18')`,
    );

    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO parametros_normativos (chave,"valorData","fundamentoLegal","vigenciaInicio")
         VALUES ('MARCO_TEMPORAL_OCUPACAO','2017-11-19','IN 002/2026, Anexo II','2026-05-18')`,
      ),
    );

    expect(erro.code).toBe('23P01');
    expect(erro.constraint).toBe('ex_param_sem_sobreposicao');
  });

  // -- relacionamento --------------------------------------------------------

  it('recusa relacionamento invertido: o par é sempre (menor, maior)', async () => {
    const outro = await pool.query<{ id: number }>(
      `INSERT INTO processos ("numeroSei","interessadoId","imovelId") VALUES ('SEI-0003',$1,$2) RETURNING id`,
      [pessoaId, imovel2Id],
    );
    const outroProcessoId = outro.rows[0].id;
    const [menor, maior] = [processoId, outroProcessoId].sort((a, b) => a - b);

    await pool.query(
      `INSERT INTO processos_relacionamentos ("processoMenorId","processoMaiorId",motivo)
       VALUES ($1,$2,'SOBREPOSICAO')`,
      [menor, maior],
    );

    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO processos_relacionamentos ("processoMenorId","processoMaiorId",motivo)
         VALUES ($1,$2,'SOBREPOSICAO')`,
        [maior, menor],
      ),
    );

    expect(erro.code).toBe('23514'); // check_violation
    expect(erro.constraint).toBe('ck_rel_ordem');
  });

  // -- qualificação ----------------------------------------------------------

  it('recusa pessoa física sem CPF', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO pessoas ("tipoPessoa", nome) VALUES ('FISICA','Sem CPF')`,
      ),
    );

    expect(erro.code).toBe('23514');
    expect(erro.constraint).toBe('ck_pessoa_documento');
  });

  it('Art. 69 §5º: recusa segundo termo de anuência vigente para a mesma pessoa', async () => {
    await pool.query(
      `INSERT INTO termos_anuencia ("pessoaId","telefoneAplicativo",email,"assinadoEm")
       VALUES ($1,'95999990000','a@b.com','2026-06-01')`,
      [pessoaId],
    );

    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO termos_anuencia ("pessoaId","telefoneAplicativo",email,"assinadoEm")
         VALUES ($1,'95999991111','c@d.com','2026-07-01')`,
        [pessoaId],
      ),
    );

    expect(erro.code).toBe('23505');
    expect(erro.constraint).toBe('ux_termo_anuencia_vigente');
  });

  // -- prazo -----------------------------------------------------------------

  it('Art. 71, III: a ciência efetiva é a confirmação que ocorreu POR ÚLTIMO', async () => {
    const comunicacao = await pool.query<{ id: number }>(
      `INSERT INTO comunicacoes ("processoId",tipo,assunto,"prazoDias")
       VALUES ($1,'INTIMACAO','Retificação de área',15) RETURNING id`,
      [processoId],
    );
    const comunicacaoId = comunicacao.rows[0].id;

    await pool.query(
      `INSERT INTO tentativas_entrega
         ("comunicacaoId",ordem,meio,destino,"enviadaEm","confirmadaEm",resultado)
       VALUES ($1,1,'APLICATIVO_MENSAGENS','95999990000','2026-06-01 09:00-04','2026-06-01 09:12-04','ENTREGUE_CONFIRMADO'),
              ($1,2,'EMAIL','a@b.com',                  '2026-06-01 09:00-04','2026-06-03 14:40-04','ENTREGUE_CONFIRMADO')`,
      [comunicacaoId],
    );

    const { rows } = await pool.query<{ ciencia: Date }>(
      `SELECT max("confirmadaEm") AS ciencia FROM tentativas_entrega WHERE "comunicacaoId" = $1`,
      [comunicacaoId],
    );

    // 03/06 (e-mail), não 01/06 (aplicativo): o prazo corre da última.
    expect(rows[0].ciencia.toISOString()).toBe('2026-06-03T18:40:00.000Z');
  });

  // -- geometria e faixa -----------------------------------------------------

  it('calcula a área de triagem a partir do perímetro, sem coluna gerada', async () => {
    const { rows } = await pool.query<{ area: string; divergencia: string }>(
      `SELECT ROUND((ST_Area(perimetro::geography)/10000)::numeric, 4) AS area,
              ROUND(abs("areaDeclaradaHa" - (ST_Area(perimetro::geography)/10000)::numeric), 4) AS divergencia
         FROM imoveis WHERE id = $1`,
      [imovelId],
    );

    // ~1,23 km² = ~123 ha contra 100 ha declarados: a divergência é o sinal
    // de triagem, e é por isso que a área CERTIFICADA é a autoritativa.
    expect(Number(rows[0].area)).toBeCloseTo(123.4, 0);
    expect(Number(rows[0].divergencia)).toBeGreaterThan(20);
  });

  it('resolve a faixa a partir da área declarada e do módulo fiscal vigente', async () => {
    const { rows } = await pool.query<{
      modulos: string;
      faixa: string;
      anexo: string;
    }>(
      `SELECT round(i."areaDeclaradaHa" / m.hectares, 4) AS modulos,
              f.codigo AS faixa,
              f."anexoReferencia" AS anexo
         FROM imoveis i
         JOIN modulos_fiscais m
           ON m."municipioId" = i."municipioId"
          AND daterange(m."vigenciaInicio", m."vigenciaFim", '[)') @> CURRENT_DATE
         JOIN faixas_modulo_fiscal f
           ON numrange(f."limiteInferiorExclusivo", f."limiteSuperiorInclusivo", '(]')
              @> (i."areaDeclaradaHa" / m.hectares)
          AND daterange(f."vigenciaInicio", f."vigenciaFim", '[)') @> CURRENT_DATE
        WHERE i.id = $1`,
      [imovelId],
    );

    expect(rows).toHaveLength(1); // uma faixa, nunca duas — é o que o EXCLUDE garante
    expect(Number(rows[0].modulos)).toBeCloseTo(1.3333, 4);
    expect(rows[0].faixa).toBe('DE_1_A_4');
    expect(rows[0].anexo).toBe('VIII');
  });

  // -- autos -----------------------------------------------------------------

  it('não deixa apagar processo com documento nos autos (RESTRICT)', async () => {
    await pool.query(
      `INSERT INTO tipos_documento (codigo,nome) VALUES ('RG','Documento de identidade')`,
    );
    await pool.query(
      `INSERT INTO documentos_processo
         ("processoId","tipoDocumentoId","nomeOriginal","storageKey","mimeType",
          "tamanhoBytes","hashSha256","formaAutenticacao")
       VALUES ($1, (SELECT id FROM tipos_documento WHERE codigo='RG'),
               'rg.pdf','proc/1/rg.pdf','application/pdf',1024,repeat('a',64),'ASSINATURA_DIGITAL_ICP')`,
      [processoId],
    );

    const erro = await violacao(() =>
      pool.query(`DELETE FROM processos WHERE id = $1`, [processoId]),
    );

    // Autos de processo administrativo se arquivam (Art. 80) ou se anulam
    // (Art. 73). Nunca se apagam.
    expect(erro.code).toBe('23503'); // foreign_key_violation
    expect(erro.table).toBe('documentos_processo');
  });

  it('recusa juntar duas vezes o mesmo arquivo no mesmo processo', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO documentos_processo
           ("processoId","tipoDocumentoId","nomeOriginal","storageKey","mimeType",
            "tamanhoBytes","hashSha256","formaAutenticacao")
         VALUES ($1, (SELECT id FROM tipos_documento WHERE codigo='RG'),
                 'rg-copia.pdf','proc/1/rg2.pdf','application/pdf',1024,repeat('a',64),'ASSINATURA_DIGITAL_ICP')`,
        [processoId],
      ),
    );

    // Mesmo processo + mesmo tipo + mesmo hash = reenvio, não nova juntada.
    expect(erro.code).toBe('23505');
    expect(erro.constraint).toBe('ux_documento_dedup');
  });
});
