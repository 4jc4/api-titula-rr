-- =====================================================================
-- Seed de municípios — parcial e deliberado.
--
-- Só Boa Vista, porque é o que duas coisas exigem hoje: o seed de
-- feriados (que procura o IBGE 1400100) e a SEDE DO ÓRGÃO, que rege a
-- contagem de todo prazo em dia útil.
--
-- Os outros 14 municípios de Roraima entram quando houver a carga
-- oficial do IBGE, junto com módulo fiscal e leis orgânicas — código
-- errado de município num sistema de titulação não é erro cosmético.
--
-- Idempotente: pode ser reexecutado.
-- Rodar ANTES de prisma/seed/feriados.sql.
-- =====================================================================

INSERT INTO municipios ("codigoIbge", nome, uf, "sedeOrgao")
VALUES ('1400100', 'Boa Vista', 'RR', true)
ON CONFLICT ("codigoIbge") DO UPDATE SET "sedeOrgao" = EXCLUDED."sedeOrgao";
