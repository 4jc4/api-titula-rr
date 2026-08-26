\set ON_ERROR_STOP off
\pset pager off

\echo '=== A. Pascoa calculada x datas conhecidas ==='
SELECT ano,
       pascoa(ano)      AS pascoa,
       pascoa(ano) - 47 AS carnaval,
       pascoa(ano) -  2 AS sexta_santa,
       pascoa(ano) + 60 AS corpus_christi
FROM (VALUES (2024),(2025),(2026),(2027)) AS t(ano);

\echo ''
\echo '=== B. Feriados semeados por abrangencia (2026) ==='
SELECT abrangencia, count(*) AS qtd
FROM feriados WHERE date_part('year', data) = 2026
GROUP BY abrangencia ORDER BY 1;

\echo ''
\echo '=== C. Calendario de 2026 aplicavel a Boa Vista ==='
SELECT to_char(data,'DD/MM') AS dia, nome, abrangencia
FROM feriados
WHERE date_part('year', data) = 2026
  AND (abrangencia <> 'MUNICIPAL' OR "municipioId" = (SELECT id FROM municipios WHERE "codigoIbge"='1400100'))
ORDER BY data;

\echo ''
\echo '=== D. e_dia_util em datas criticas de 2026 ==='
SELECT d AS data, to_char(d,'Dy') AS dia_semana,
       e_dia_util(d, (SELECT id FROM municipios WHERE "codigoIbge"='1400100')) AS e_dia_util
FROM (VALUES ('2026-02-17'::date),  -- Carnaval (movel)
             ('2026-04-03'::date),  -- Sexta-feira Santa (movel)
             ('2026-06-04'::date),  -- Corpus Christi (movel)
             ('2026-07-09'::date),  -- Aniversario de Boa Vista (municipal)
             ('2026-10-05'::date),  -- Aniversario de Roraima (estadual)
             ('2026-08-22'::date),  -- sabado
             ('2026-08-25'::date))  -- terca comum
  AS t(d);

\echo ''
\echo '=== E. Art. 71 §1º — 5 dias uteis a partir de sexta 03/07/2026 ==='
\echo '    Com Boa Vista, o feriados municipal de 09/07 empurra o vencimento.'
SELECT '2026-07-03'::date AS inicio_sexta,
       adicionar_dias_uteis('2026-07-03', 5,
         (SELECT id FROM municipios WHERE "codigoIbge"='1400100')) AS vence_em_boa_vista,
       adicionar_dias_uteis('2026-07-03', 5, NULL) AS vence_sem_feriado_municipal;

\echo ''
\echo '=== F. Feriado nacional com uf preenchida (deve falhar) ==='
INSERT INTO feriados (data, nome, abrangencia, uf) VALUES ('2026-03-01','Invalido','NACIONAL','RR');

\echo ''
\echo '=== G. Feriado nacional duplicado (deve ser ignorado, nao duplicar) ==='
SELECT count(*) AS antes FROM feriados WHERE data='2026-01-01';
INSERT INTO feriados (data, nome, abrangencia) VALUES ('2026-01-01','Ano Novo de novo','NACIONAL')
ON CONFLICT ON CONSTRAINT ux_feriado DO NOTHING;
SELECT count(*) AS depois FROM feriados WHERE data='2026-01-01';

\echo ''
\echo '=== H. gerar_feriados_moveis e idempotente ==='
SELECT gerar_feriados_moveis(2026) AS inseridos_na_segunda_chamada;

\echo ''
\echo '=== I. Storage: juntada duplicada do mesmo arquivo (deve falhar) ==='
INSERT INTO pessoas ("tipoPessoa",nome,cpf) VALUES ('FISICA','Teste','12345678901');
INSERT INTO imoveis (denominacao,"municipioId","areaDeclaradaHa") VALUES ('Sitio',1,100);
INSERT INTO processos ("numeroSei","interessadoId","imovelId") VALUES ('SEI-1',1,1);
INSERT INTO tipos_documento (codigo,nome) VALUES ('RG','Documento de identidade');
INSERT INTO documentos_processo ("processoId","tipoDocumentoId","nomeOriginal","storageKey","mimeType","tamanhoBytes","hashSha256","formaAutenticacao")
 VALUES (1,1,'rg.pdf','proc/1/rg.pdf','application/pdf',1024, repeat('a',64), 'ASSINATURA_DIGITAL_ICP');
INSERT INTO documentos_processo ("processoId","tipoDocumentoId","nomeOriginal","storageKey","mimeType","tamanhoBytes","hashSha256","formaAutenticacao")
 VALUES (1,1,'rg-copia.pdf','proc/1/rg2.pdf','application/pdf',1024, repeat('a',64), 'ASSINATURA_DIGITAL_ICP');
SELECT id, "nomeOriginal" FROM documentos_processo WHERE id=1;

\echo ''
\echo '=== J. Cidadao: acesso sem subject do gov.br (deve falhar) ==='
INSERT INTO pessoas_acesso ("pessoaId","emailAcesso") VALUES (1,'a@b.com');

\echo ''
\echo '=== K. Cidadao: duas credenciais ativas para a mesma pessoa (deve falhar) ==='
INSERT INTO pessoas_acesso ("pessoaId","govbrSubject","emailAcesso") VALUES (1,'sub-123','a@b.com');
INSERT INTO pessoas_acesso ("pessoaId","govbrSubject","emailAcesso") VALUES (1,'sub-456','c@d.com');

\echo ''
\echo '=== L. Cidadao: revogar a antiga e criar nova (deve passar) ==='
UPDATE pessoas_acesso SET ativo=FALSE WHERE "pessoaId"=1;
INSERT INTO pessoas_acesso ("pessoaId","govbrSubject","emailAcesso") VALUES (1,'sub-456','c@d.com');
SELECT id, "govbrSubject", ativo FROM pessoas_acesso ORDER BY id;
