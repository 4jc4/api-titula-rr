import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Pool } from 'pg';
import { abrirPool, limparDominio, violacao } from './helpers/postgres.js';

// Art. 5º: o cidadão acessa o Portal, e o principal dele é SEPARADO do
// servidor — não há conta no AD para requerente. Só gov.br: manter senha de
// cidadão significaria fluxo de reset, bloqueio e exposição em vazamento.

describe('Domínio — acesso do cidadão ao Portal', () => {
  let pool: Pool;
  let pessoaId: number;

  beforeAll(async () => {
    pool = abrirPool();
    await limparDominio(pool);

    const pessoa = await pool.query<{ id: number }>(
      `INSERT INTO pessoas ("tipoPessoa", nome, cpf) VALUES ('FISICA','Requerente Portal','12345678901') RETURNING id`,
    );
    pessoaId = pessoa.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('recusa acesso sem o subject do gov.br', async () => {
    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO pessoas_acesso ("pessoaId","emailAcesso") VALUES ($1,'a@b.com')`,
        [pessoaId],
      ),
    );

    expect(erro.code).toBe('23502'); // not_null_violation
    expect(erro.column).toBe('govbrSubject');
  });

  it('recusa duas credenciais ativas para a mesma pessoa', async () => {
    await pool.query(
      `INSERT INTO pessoas_acesso ("pessoaId","govbrSubject","emailAcesso") VALUES ($1,'sub-123','a@b.com')`,
      [pessoaId],
    );

    const erro = await violacao(() =>
      pool.query(
        `INSERT INTO pessoas_acesso ("pessoaId","govbrSubject","emailAcesso") VALUES ($1,'sub-456','c@d.com')`,
        [pessoaId],
      ),
    );

    expect(erro.code).toBe('23505');
    expect(erro.constraint).toBe('ux_pessoa_acesso_ativo');
  });

  it('aceita credencial nova depois de revogar a anterior', async () => {
    await pool.query(
      `UPDATE pessoas_acesso SET ativo = FALSE WHERE "pessoaId" = $1`,
      [pessoaId],
    );
    await pool.query(
      `INSERT INTO pessoas_acesso ("pessoaId","govbrSubject","emailAcesso") VALUES ($1,'sub-456','c@d.com')`,
      [pessoaId],
    );

    const { rows } = await pool.query<{ ativos: string; total: string }>(
      `SELECT count(*) FILTER (WHERE ativo)::text AS ativos, count(*)::text AS total
         FROM pessoas_acesso WHERE "pessoaId" = $1`,
      [pessoaId],
    );

    // O índice é parcial: histórico fica, uma credencial viva por vez.
    expect(rows[0].ativos).toBe('1');
    expect(rows[0].total).toBe('2');
  });
});
