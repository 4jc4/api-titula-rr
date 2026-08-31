import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Pool } from 'pg';
import { abrirPool, limparDominio, violacao } from './helpers/postgres.js';

// Taxas da etapa 1 do Anexo X. O que o banco precisa garantir sozinho:
// o valor emitido não acompanha reajuste de lei (Art. 51 é o mesmo princípio
// dos snapshots), PAGO não volta atrás (Art. 57 — valor não restituível), e
// a mesma taxa pode ser cobrada de novo (2ª via, desarquivamento).

const SERVIDOR_GEORF = 'e2e-georf-cer';

describe('Domínio — débitos de taxa', () => {
  let pool: Pool;
  let processoId: number;
  let taxaId: number;
  let debitoId: number;

  beforeAll(async () => {
    pool = abrirPool();
    await limparDominio(pool);

    const municipio = await pool.query<{ id: number }>(
      `INSERT INTO municipios ("codigoIbge", nome) VALUES ('1400100','Boa Vista') RETURNING id`,
    );
    const pessoa = await pool.query<{ id: number }>(
      `INSERT INTO pessoas ("tipoPessoa", nome, cpf) VALUES ('FISICA','Requerente','12345678901') RETURNING id`,
    );
    const imovel = await pool.query<{ id: number }>(
      `INSERT INTO imoveis (denominacao,"municipioId","areaDeclaradaHa") VALUES ('Sítio',$1,100) RETURNING id`,
      [municipio.rows[0].id],
    );
    const processo = await pool.query<{ id: number }>(
      `INSERT INTO processos ("numeroSei","interessadoId","imovelId") VALUES ('SEI-1',$1,$2) RETURNING id`,
      [pessoa.rows[0].id, imovel.rows[0].id],
    );
    processoId = processo.rows[0].id;

    const taxa = await pool.query<{ id: number }>(
      `INSERT INTO taxas_processuais (codigo,descricao,valor,"fundamentoLegal","vigenciaInicio")
       VALUES ('ABERTURA_RURAL','Taxa de abertura de processo rural',180.00,
               'Lei 1.252/2018 alterada pela Lei 2.317/2025','2026-01-01') RETURNING id`,
    );
    taxaId = taxa.rows[0].id;

    // Servidor que confirma o pagamento (Art. 56, II). Existe de verdade
    // porque `confirmadoPorId` virou FK para users.
    await pool.query(
      `INSERT INTO users (id, username, name, papeis, origem, "updatedAt")
       VALUES ($1,'e2e.georf','GEORF/CER (e2e)','{financeiro}','AD', now())
       ON CONFLICT (id) DO NOTHING`,
      [SERVIDOR_GEORF],
    );

    const debito = await pool.query<{ id: number }>(
      `INSERT INTO debitos_taxa ("processoId","taxaProcessualId",valor,"numeroDocumento","dataVencimento")
       VALUES ($1,$2,180.00,'DAE-2026-0001','2026-09-30') RETURNING id`,
      [processoId, taxaId],
    );
    debitoId = debito.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [SERVIDOR_GEORF]);
    await pool.end();
  });

  it('congela o valor: a taxa reajusta, o boleto emitido não muda', async () => {
    await pool.query(
      `UPDATE taxas_processuais SET "vigenciaFim"='2027-01-01' WHERE id = $1`,
      [taxaId],
    );
    await pool.query(
      `INSERT INTO taxas_processuais (codigo,descricao,valor,"fundamentoLegal","vigenciaInicio")
       VALUES ('ABERTURA_RURAL','Taxa de abertura de processo rural',250.00,'Reajuste 2027','2027-01-01')`,
    );

    const { rows } = await pool.query<{ boleto: string; vigente: string }>(
      `SELECT d.valor::text AS boleto,
              (SELECT valor::text FROM taxas_processuais
                WHERE codigo='ABERTURA_RURAL' AND "vigenciaFim" IS NULL) AS vigente
         FROM debitos_taxa d WHERE d.id = $1`,
      [debitoId],
    );

    expect(rows[0].boleto).toBe('180.00');
    expect(rows[0].vigente).toBe('250.00');
  });

  it('recusa duas vigências sobrepostas para a mesma taxa', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO taxas_processuais (codigo,descricao,valor,"fundamentoLegal","vigenciaInicio")
         VALUES ('ABERTURA_RURAL','Duplicata',999.00,'Inválido','2027-06-01')`,
      ),
    );

    expect(erro.code).toBe('23P01');
    expect(erro.constraint).toBe('ex_taxa_sem_sobreposicao');
  });

  it('recusa PAGO sem data de pagamento', async () => {
    const erro = await violacao(() =>
      pool.query(`UPDATE debitos_taxa SET situacao='PAGO' WHERE id = $1`, [
        debitoId,
      ]),
    );

    expect(erro.code).toBe('23514');
    expect(erro.constraint).toBe('ck_debito_pagamento');
  });

  it('Art. 56, II: registra o pagamento confirmado por um servidor real', async () => {
    await pool.query(
      `UPDATE debitos_taxa
          SET situacao='PAGO', "dataPagamento"='2026-09-15', "confirmadoPorId"=$2
        WHERE id = $1`,
      [debitoId, SERVIDOR_GEORF],
    );

    const { rows } = await pool.query<{ situacao: string; confirmado: string }>(
      `SELECT situacao, "confirmadoPorId" AS confirmado FROM debitos_taxa WHERE id = $1`,
      [debitoId],
    );

    expect(rows[0].situacao).toBe('PAGO');
    expect(rows[0].confirmado).toBe(SERVIDOR_GEORF);
  });

  it('recusa confirmação por um servidor que não existe', async () => {
    const erro = await violacao(() =>
      pool.query(
        `UPDATE debitos_taxa SET "confirmadoPorId"='nao-existe' WHERE id = $1`,
        [debitoId],
      ),
    );

    expect(erro.code).toBe('23503');
    expect(erro.constraint).toBe('debitos_taxa_confirmadoPorId_fkey');
  });

  it('Art. 57: PAGO não volta para EMITIDO', async () => {
    // O valor pago não é restituível nem em caso de indeferimento, então
    // "despagar" não é uma transição — cancelamento é situação própria.
    const erro = await violacao(() =>
      pool.query(`UPDATE debitos_taxa SET situacao='EMITIDO' WHERE id = $1`, [
        debitoId,
      ]),
    );

    expect(erro.code).toBe('23514');
    expect(erro.constraint).toBe('ck_debito_pagamento');
  });

  it('recusa vencimento anterior à emissão', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO debitos_taxa ("processoId","taxaProcessualId",valor,"dataEmissao","dataVencimento")
         VALUES ($1,$2,180.00,'2026-08-25','2026-08-01')`,
        [processoId, taxaId],
      ),
    );

    expect(erro.code).toBe('23514');
    expect(erro.constraint).toBe('ck_debito_vencimento');
  });

  it('recusa número de boleto repetido', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO debitos_taxa ("processoId","taxaProcessualId",valor,"numeroDocumento","dataVencimento")
         VALUES ($1,$2,180.00,'DAE-2026-0001','2026-10-30')`,
        [processoId, taxaId],
      ),
    );

    expect(erro.code).toBe('23505');
    expect(erro.constraint).toBe('ux_debito_numero');
  });

  it('aceita a mesma taxa de novo — 2ª via e desarquivamento são legítimos', async () => {
    await pool.query(
      `INSERT INTO debitos_taxa ("processoId","taxaProcessualId",valor,"numeroDocumento","dataVencimento")
       VALUES ($1,$2,180.00,'DAE-2026-0002','2026-10-30'),
              ($1,$2,180.00,'DAE-2027-0007','2027-03-30')`,
      [processoId, taxaId],
    );

    const { rows } = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM debitos_taxa WHERE "processoId" = $1 AND "taxaProcessualId" = $2`,
      [processoId, taxaId],
    );

    // Sem UNIQUE por (processo, taxa) — de propósito.
    expect(rows[0].total).toBe('3');
  });

  it('responde a pergunta da admissibilidade: há débito em aberto?', async () => {
    const { rows } = await pool.query<{ em_aberto: string; pagos: string }>(
      `SELECT count(*) FILTER (WHERE situacao='EMITIDO')::text AS em_aberto,
              count(*) FILTER (WHERE situacao='PAGO')::text    AS pagos
         FROM debitos_taxa WHERE "processoId" = $1`,
      [processoId],
    );

    expect(rows[0].em_aberto).toBe('2');
    expect(rows[0].pagos).toBe('1');
  });
});
