-- =====================================================================
-- Integridade referencial das colunas de servidor responsável
-- ---------------------------------------------------------------------
-- Sete colunas do núcleo processual nasceram TEXT sem FK porque, quando o
-- modelo foi desenhado, o tipo de `users.id` ainda não estava confirmado.
-- Está: TEXT com @default(uuid(7)). São as únicas colunas do domínio sem
-- integridade referencial — e justamente as que dizem QUEM praticou o ato.
--
-- Migração à parte, e não edição da migração do núcleo: aquela já pode ter
-- sido aplicada em algum banco de desenvolvimento, e alterar o arquivo
-- mudaria o checksum que o Prisma guarda em _prisma_migrations.
--
-- ON DELETE: SET NULL desliga a autoria sem apagar o ato; RESTRICT no
-- arquivamento, porque a coluna é NOT NULL (Art. 80 — não existe
-- arquivamento sem chefia identificada). CASCADE em nenhuma: apagar um
-- servidor não pode apagar o que ele movimentou.
--
-- ON UPDATE CASCADE em todas por uma razão mecânica: é o default implícito
-- do Prisma para relações, e escrever outra coisa aqui faria o
-- `prisma migrate dev` acusar drift contra o schema.
-- =====================================================================

ALTER TABLE documentos_processo
  ADD CONSTRAINT "documentos_processo_juntadoPorId_fkey"
  FOREIGN KEY ("juntadoPorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE tramitacoes
  ADD CONSTRAINT "tramitacoes_servidorRecebId_fkey"
  FOREIGN KEY ("servidorRecebId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE processos_relacionamentos
  ADD CONSTRAINT "processos_relacionamentos_criadoPorId_fkey"
  FOREIGN KEY ("criadoPorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE arquivamentos
  ADD CONSTRAINT "arquivamentos_chefiaAprovouId_fkey"
  FOREIGN KEY ("chefiaAprovouId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE processos_eventos
  ADD CONSTRAINT "processos_eventos_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE debitos_taxa
  ADD CONSTRAINT "debitos_taxa_emitidoPorId_fkey"
  FOREIGN KEY ("emitidoPorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE debitos_taxa
  ADD CONSTRAINT "debitos_taxa_confirmadoPorId_fkey"
  FOREIGN KEY ("confirmadoPorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Sem índice nas colunas referenciadas: nenhum módulo consulta "os
-- documentos juntados por fulano" ainda, e a varredura que a FK faria só
-- aconteceria em DELETE/UPDATE de `users` — que este sistema não faz
-- (conta some do AD, a linha fica com isActive=false). O índice entra junto
-- com a consulta que precisar dele, não antes.
