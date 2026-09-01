import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { abrirPool, limparDominio, violacao } from './helpers/postgres.js';

// Sem calendário não existe prazo em dia útil, e todo prazo da IN 002 é em
// dia útil (Art. 71 §1º à frente). As funções são PL/pgSQL, então é aqui —
// contra o Postgres real — que elas podem ser verificadas.
//
// As datas esperadas foram conferidas fora do banco: Páscoa por tabela
// astronômica, e a contagem de 03/07/2026 dia a dia no calendário.

const SEED_FERIADOS = resolve(process.cwd(), 'prisma/seed/feriados.sql');

describe('Domínio — calendário e contagem de prazo', () => {
  let pool: Pool;
  let boaVistaId: number;
  let cantaId: number;

  beforeAll(async () => {
    pool = abrirPool();
    await limparDominio(pool);

    // Boa Vista é a SEDE — decisão de 01/09/2026, é o calendário que rege
    // o prazo por omissão. O Cantá existe aqui só para provar a diferença.
    const municipio = await pool.query<{ id: number }>(
      `INSERT INTO municipios ("codigoIbge", nome, uf, "sedeOrgao")
            VALUES ('1400100','Boa Vista','RR', true) RETURNING id`,
    );
    boaVistaId = municipio.rows[0].id;

    const outro = await pool.query<{ id: number }>(
      `INSERT INTO municipios ("codigoIbge", nome, uf) VALUES ('1400175','Cantá','RR') RETURNING id`,
    );
    cantaId = outro.rows[0].id;

    // O seed de verdade, lido do disco: quem quebrar o arquivo quebra o teste.
    await pool.query(await readFile(SEED_FERIADOS, 'utf8'));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('pascoa() bate com as datas conhecidas de 2024 a 2027', async () => {
    const { rows } = await pool.query<{ ano: number; pascoa: string }>(
      `SELECT ano, to_char(pascoa(ano),'YYYY-MM-DD') AS pascoa
         FROM (VALUES (2024),(2025),(2026),(2027)) AS t(ano) ORDER BY ano`,
    );

    expect(rows.map((r) => r.pascoa)).toEqual([
      '2024-03-31',
      '2025-04-20',
      '2026-04-05',
      '2027-03-28',
    ]);
  });

  it('deriva os três móveis nacionais da Páscoa de 2026', async () => {
    const { rows } = await pool.query<{ nome: string; data: string }>(
      `SELECT nome, to_char(data,'YYYY-MM-DD') AS data
         FROM feriados
        WHERE date_part('year', data) = 2026
          AND data IN (pascoa(2026) - 47, pascoa(2026) - 2, pascoa(2026) + 60)
        ORDER BY data`,
    );

    expect(rows.map((r) => r.data)).toEqual([
      '2026-02-17', // Carnaval
      '2026-04-03', // Sexta-feira Santa
      '2026-06-04', // Corpus Christi
    ]);
  });

  it('o seed é idempotente — rodar de novo não duplica nem insere', async () => {
    const antes = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM feriados`,
    );

    await pool.query(await readFile(SEED_FERIADOS, 'utf8'));
    const inseridos = await pool.query<{ n: number }>(
      `SELECT gerar_feriados_moveis(2026) AS n`,
    );

    const depois = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM feriados`,
    );

    expect(depois.rows[0].total).toBe(antes.rows[0].total);
    expect(inseridos.rows[0].n).toBe(0);
  });

  it('e_dia_util reconhece móveis, estaduais, municipais e fim de semana', async () => {
    const datas = [
      '2026-02-17', // Carnaval (móvel nacional)
      '2026-04-03', // Sexta-feira Santa (móvel nacional)
      '2026-06-04', // Corpus Christi (móvel nacional)
      '2026-07-09', // Aniversário de Boa Vista (municipal)
      '2026-10-05', // Aniversário de Roraima (estadual)
      '2026-08-22', // sábado
      '2026-08-25', // terça comum
    ];

    const { rows } = await pool.query<{ data: string; util: boolean }>(
      `SELECT to_char(d,'YYYY-MM-DD') AS data, e_dia_util(d, $1) AS util
         FROM unnest($2::date[]) AS t(d) ORDER BY d`,
      [boaVistaId, datas],
    );

    expect(rows.map((r) => [r.data, r.util])).toEqual([
      ['2026-02-17', false],
      ['2026-04-03', false],
      ['2026-06-04', false],
      ['2026-07-09', false],
      ['2026-08-22', false],
      ['2026-08-25', true],
      ['2026-10-05', false],
    ]);
  });

  it('sem município, o calendário é o da sede do órgão', async () => {
    // Fecha o achado C3: antes a omissão caía em COALESCE(uf, 'RR') e
    // aplicava só os estaduais, em silêncio. Agora significa a sede.
    const { rows } = await pool.query<{
      omisso: boolean;
      sede: boolean;
      outro: boolean;
    }>(
      `SELECT e_dia_util('2026-07-09')      AS omisso,
              e_dia_util('2026-07-09', $1)  AS sede,
              e_dia_util('2026-07-09', $2)  AS outro`,
      [boaVistaId, cantaId],
    );

    // 09/07 é o aniversário de Boa Vista: feriado na sede, dia útil no Cantá.
    expect(rows[0].omisso).toBe(false);
    expect(rows[0].sede).toBe(false);
    expect(rows[0].outro).toBe(true);
  });

  it('sem sede cadastrada, a contagem falha em vez de improvisar', async () => {
    await pool.query(`UPDATE municipios SET "sedeOrgao" = false`);
    try {
      const erro = await violacao(() =>
        pool.query(`SELECT adicionar_dias_uteis('2026-07-03', 5)`),
      );

      // data_exception: prazo sem calendário definido não tem resposta certa,
      // e devolver uma errada em silêncio é pior que falhar.
      expect(erro.code).toBe('22000');
      expect(erro.message).toContain('sede do orgao');
    } finally {
      await pool.query(
        `UPDATE municipios SET "sedeOrgao" = true WHERE id = $1`,
        [boaVistaId],
      );
    }
  });

  it('o banco recusa duas sedes', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO municipios ("codigoIbge", nome, uf, "sedeOrgao")
              VALUES ('1400209','Caracaraí','RR', true)`,
      ),
    );

    expect(erro.code).toBe('23505');
    expect(erro.constraint).toBe('ux_municipio_sede_unica');
  });

  it('recusa município inexistente em vez de tratar como sem feriado', async () => {
    const erro = await violacao(() =>
      pool.query(`SELECT e_dia_util('2026-07-09', 99999)`),
    );

    expect(erro.code).toBe('22023');
    expect(erro.message).toContain('inexistente');
  });

  it('Art. 71 §1º: 5 dias úteis a partir de sexta 03/07/2026', async () => {
    const { rows } = await pool.query<{
      sede: string;
      omisso: string;
      outro: string;
    }>(
      `SELECT to_char(adicionar_dias_uteis('2026-07-03', 5, $1),'YYYY-MM-DD')   AS sede,
              to_char(adicionar_dias_uteis('2026-07-03', 5),'YYYY-MM-DD')       AS omisso,
              to_char(adicionar_dias_uteis('2026-07-03', 5, $2),'YYYY-MM-DD')   AS outro`,
      [boaVistaId, cantaId],
    );

    // Contagem exclui o dia inicial: 06, 07, 08, (09 é feriado em Boa Vista),
    // 10 e 13 — a segunda-feira seguinte, porque 11 e 12 caem no fim de semana.
    expect(rows[0].sede).toBe('2026-07-13');
    // Omitir o município é o caso comum, e tem de dar o mesmo resultado.
    expect(rows[0].omisso).toBe('2026-07-13');
    // O tamanho da decisão, em dias: pelo calendário do imóvel seriam três
    // dias a menos para a mesma intimação.
    expect(rows[0].outro).toBe('2026-07-10');
  });

  it('data_local tira a data civil de Boa Vista, não a de UTC', async () => {
    const { rows } = await pool.query<{ ingenuo: string; correto: string }>(
      `SELECT to_char(('2026-07-09 23:30:00-04'::timestamptz)::date,'YYYY-MM-DD')   AS ingenuo,
              to_char(data_local('2026-07-09 23:30:00-04'::timestamptz),'YYYY-MM-DD') AS correto`,
    );

    // O cluster roda em UTC: às 23h30 em Boa Vista já é o dia seguinte lá.
    // Um documento juntado nesse instante começaria a contar prazo de um dia
    // que não aconteceu — por isso ::date sobre timestamptz é proibido.
    expect(rows[0].ingenuo).toBe('2026-07-10');
    expect(rows[0].correto).toBe('2026-07-09');
  });

  it('recusa feriado nacional com uf preenchida', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO feriados (data, nome, abrangencia, uf) VALUES ('2026-03-01','Inválido','NACIONAL','RR')`,
      ),
    );

    expect(erro.code).toBe('23514');
    expect(erro.constraint).toBe('ck_feriado_escopo');
  });

  it('recusa feriado nacional duplicado (NULLS NOT DISTINCT)', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO feriados (data, nome, abrangencia) VALUES ('2026-01-01','Ano Novo de novo','NACIONAL')`,
      ),
    );

    // Sem NULLS NOT DISTINCT, (data, NACIONAL, NULL, NULL) seria sempre
    // distinto de si mesmo e o calendário aceitaria duplicata silenciosa.
    expect(erro.code).toBe('23505');
    expect(erro.constraint).toBe('ux_feriado');
  });
});
