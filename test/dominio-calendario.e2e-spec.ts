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

  beforeAll(async () => {
    pool = abrirPool();
    await limparDominio(pool);

    const municipio = await pool.query<{ id: number }>(
      `INSERT INTO municipios ("codigoIbge", nome, uf) VALUES ('1400100','Boa Vista','RR') RETURNING id`,
    );
    boaVistaId = municipio.rows[0].id;

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

  it('sem município, o feriado municipal deixa de valer — mas o estadual de RR continua', async () => {
    // Comportamento deliberado da função: `COALESCE(uf do município, 'RR')`.
    // Num sistema de um estado só é o default certo, e está registrado como
    // achado C3 na segunda análise — quem for reusar a função fora de RR
    // precisa saber que a omissão não significa "só feriado nacional".
    const { rows } = await pool.query<{
      municipal: boolean;
      estadual: boolean;
    }>(
      `SELECT e_dia_util('2026-07-09', NULL) AS municipal,
              e_dia_util('2026-10-05', NULL) AS estadual`,
    );

    expect(rows[0].municipal).toBe(true); // 09/07 vira dia útil comum
    expect(rows[0].estadual).toBe(false); // 05/10 continua feriado
  });

  it('Art. 71 §1º: 5 dias úteis a partir de sexta 03/07/2026', async () => {
    const { rows } = await pool.query<{ com: string; sem: string }>(
      `SELECT to_char(adicionar_dias_uteis('2026-07-03', 5, $1),'YYYY-MM-DD') AS com,
              to_char(adicionar_dias_uteis('2026-07-03', 5, NULL),'YYYY-MM-DD') AS sem`,
      [boaVistaId],
    );

    // Contagem exclui o dia inicial: 06, 07, 08, (09 é feriado em Boa Vista),
    // 10 e 13 — a segunda-feira seguinte, porque 11 e 12 caem no fim de semana.
    expect(rows[0].com).toBe('2026-07-13');
    // Sem o feriado municipal, o quinto dia útil é 10/07: três dias antes.
    expect(rows[0].sem).toBe('2026-07-10');
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
