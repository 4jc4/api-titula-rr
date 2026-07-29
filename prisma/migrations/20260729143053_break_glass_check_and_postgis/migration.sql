-- This is an empty migration.-- Extensão geoespacial (as tabelas de domínio com geometria virão depois)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Invariante do break-glass: conta LOCAL tem hash; conta AD nunca tem.
-- O Prisma não expressa CHECK; o Postgres garante.
ALTER TABLE "users" ADD CONSTRAINT "break_glass_password_check"
  CHECK ((origem = 'LOCAL') = ("passwordHash" IS NOT NULL));
