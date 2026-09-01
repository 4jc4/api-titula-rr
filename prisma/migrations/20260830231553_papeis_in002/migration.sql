-- =====================================================================
-- Papéis da IN 002/2026 — o enum "Papel" fecha em 12 valores
-- ---------------------------------------------------------------------
-- Migração escrita à mão, como a do break-glass e a do núcleo processual:
-- o Prisma emite `ALTER TYPE ... ADD VALUE` para valor novo, mas NÃO sabe
-- remover valor de enum — o Postgres não tem `ALTER TYPE ... DROP VALUE`.
-- Removê-los exige recriar o tipo e reapontar a coluna.
--
-- Saem: `informatica` e `colaborador` (nenhum artigo da IN lhes atribui
--       ato próprio — ver docs/in002/papeis-rbac.md §1).
-- Entram: `servicos_fundiarios` (DSF), `notificacao` (Câmara),
--         `presidente` (atos privativos) e `cidadao` (Portal).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ninguém pode ficar com um papel que deixa de existir.
--
-- Quem estiver só em `informatica`/`colaborador` termina com `papeis` vazio
-- — e sem papel, sem acesso (AuthService nega no login). É o resultado certo:
-- o vínculo real está nos grupos do AD, e o §8 do documento manda migrar a
-- pessoa para o grupo do setor (ou TITULA_ADMINISTRADOR) antes de apagar
-- TITULA_COLABORADOR e TITULA_INFORMATICA. No próximo login — ou no recheck
-- de 15 min — os papéis voltam a ser sincronizados do AD.
-- ---------------------------------------------------------------------
UPDATE "users"
   SET "papeis" = array_remove(
                    array_remove("papeis", 'informatica'::"Papel"),
                    'colaborador'::"Papel"
                  )
 WHERE "papeis" && ARRAY['informatica', 'colaborador']::"Papel"[];

-- ---------------------------------------------------------------------
-- 2. Recriação do tipo.
--
-- `users."papeis"` é a única dependência de "Papel" no banco (a coluna não
-- tem DEFAULT, então não há default a soltar antes do ALTER). O cast passa
-- por text[]: enum -> text -> enum novo, elemento a elemento.
-- ---------------------------------------------------------------------
ALTER TYPE "Papel" RENAME TO "Papel_old";

CREATE TYPE "Papel" AS ENUM (
  'atendimento',
  'governanca',
  'servicos_fundiarios',
  'financeiro',
  'titulacao',
  'planejamento',
  'presidencia',
  'notificacao',
  'presidente',
  'gestor',
  'administrador',
  'cidadao'
);

ALTER TABLE "users"
  ALTER COLUMN "papeis" TYPE "Papel"[] USING "papeis"::text[]::"Papel"[];

-- Falha de propósito se alguma outra coluna ainda apontar para o tipo
-- antigo: melhor a migração parar aqui do que deixar dois enums vivos.
DROP TYPE "Papel_old";
