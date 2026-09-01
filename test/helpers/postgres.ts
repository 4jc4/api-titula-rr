import { Pool } from 'pg';
import type { DatabaseError } from 'pg';

// Estes e2e falam com o Postgres DIRETO, sem subir o Nest.
//
// O que eles verificam não é código nosso: são as 47 CHECK, as 5 EXCLUDE e
// os 11 índices parciais da migração do núcleo processual — regra da IN 002
// escrita em DDL. Passar pelo Prisma aqui só embrulharia o erro do banco
// numa exceção genérica; o driver `pg` devolve `code` (SQLSTATE) e
// `constraint` (o nome), que é exatamente o que o teste quer afirmar.
//
// Substituem os três scripts psql em test/sql/, que provavam as mesmas
// regras mas dependiam de alguém rodá-los à mão e ler a saída.

export function abrirPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL ausente — rode via `npm run test:e2e`.');
  }
  return new Pool({ connectionString });
}

// Limpa o domínio inteiro entre suítes, preservando `users`/`sessions` (do
// auth.e2e-spec) e as tabelas de infraestrutura. A lista sai do catálogo, e
// não de um array aqui: tabela nova do domínio entra sozinha na limpeza, em
// vez de esta função silenciosamente deixar de cobri-la.
export async function limparDominio(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tabelas: string | null }>(`
    SELECT string_agg(format('%I', tablename), ', ') AS tabelas
      FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('users', 'sessions', '_prisma_migrations', 'spatial_ref_sys')
  `);
  const tabelas = rows[0]?.tabelas;
  if (tabelas) {
    await pool.query(`TRUNCATE ${tabelas} RESTART IDENTITY CASCADE`);
  }
}

// Executa o comando esperando que o BANCO o recuse, e devolve o erro para o
// teste afirmar o SQLSTATE e o nome da constraint. Se o comando passar, o
// teste falha aqui — e não três linhas adiante, num `expect` de undefined.
export async function violacao(
  executar: () => Promise<unknown>,
): Promise<DatabaseError> {
  try {
    await executar();
  } catch (erro: unknown) {
    return erro as DatabaseError;
  }
  throw new Error(
    'esperava uma violação de constraint, mas o banco aceitou o comando',
  );
}
