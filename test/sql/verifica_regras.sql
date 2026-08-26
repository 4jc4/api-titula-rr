\set ON_ERROR_STOP off
\pset pager off

-- ============ dados mínimos ============
INSERT INTO municipios ("codigoIbge", nome) VALUES ('1400100','Boa Vista');
INSERT INTO modulos_fiscais ("municipioId", hectares, "fundamentoLegal", "vigenciaInicio")
  VALUES (1, 75.0000, 'INCRA — módulo fiscal de Boa Vista/RR', '2020-01-01');

INSERT INTO faixas_modulo_fiscal (codigo, descricao, "limiteInferiorExclusivo", "limiteSuperiorInclusivo", "anexoReferencia", "fundamentoLegal", "vigenciaInicio") VALUES
 ('ATE_1',    'Até 1 módulo fiscal',       0, 1,    'VII', 'IN 002/2026, Art. 10',  '2026-05-18'),
 ('DE_1_A_4', 'Acima de 1 até 4 módulos',  1, 4,    'VIII','IN 002/2026, Art. 11',  '2026-05-18'),
 ('ACIMA_4',  'Acima de 4 módulos fiscais',4, NULL, 'IX',  'IN 002/2026, Art. 12',  '2026-05-18');

INSERT INTO setores (sigla, nome, "papelRbac") VALUES
 ('DCI','Divisão de Cidadania','atendimento'),
 ('DIGOF','Diretoria de Governança Fundiária','governanca'),
 ('DSF','Diretoria de Serviços Fundiários', NULL);

INSERT INTO pessoas ("tipoPessoa", nome, cpf, "condicaoNacionalidade")
  VALUES ('FISICA','Requerente Teste','12345678901','BRASILEIRO_NATO');

-- polígono ~1 km² próximo a Boa Vista, em SIRGAS 2000
INSERT INTO imoveis (denominacao, "municipioId", "areaDeclaradaHa", perimetro)
VALUES ('Sítio Teste', 1, 100.0000,
  ST_Multi(ST_GeomFromText('POLYGON((-60.70 2.80,-60.69 2.80,-60.69 2.81,-60.70 2.81,-60.70 2.80))',4674)));

INSERT INTO processos ("numeroSei", "interessadoId", "imovelId", "faixaModuloFiscalId",
                      "moduloFiscalAplicadoHa", "numeroModulosFiscais", "marcoTemporalAplicado")
  VALUES ('SEI-0001', 1, 1, 2, 75.0000, 1.3333, '2017-11-17');

\echo ''
\echo '=== 1. Art. 5º pu — duplicidade de processos (mesmo interessado + imóvel) ==='
INSERT INTO processos ("numeroSei", "interessadoId", "imovelId") VALUES ('SEI-0002', 1, 1);

\echo ''
\echo '=== 2. Art. 78 — tramitação simultânea em duas unidades ==='
INSERT INTO tramitacoes ("processoId", "setorDestinoId", "etapaAnexoX") VALUES (1, 1, 1);
INSERT INTO tramitacoes ("processoId", "setorDestinoId", "etapaAnexoX") VALUES (1, 2, 2);

\echo ''
\echo '=== 3. Faixas de módulo fiscal sobrepostas (o bug do Art. 10 vs Art. 11) ==='
INSERT INTO faixas_modulo_fiscal (codigo, descricao, "limiteInferiorExclusivo", "limiteSuperiorInclusivo", "anexoReferencia", "fundamentoLegal", "vigenciaInicio")
  VALUES ('ATE_4_LITERAL','Até 4 módulos, leitura literal do Art. 11', 0, 4, 'VIII', 'IN 002/2026, Art. 11', '2026-05-18');

\echo ''
\echo '=== 4. Parâmetro normativo com vigências sobrepostas (marco temporal) ==='
INSERT INTO parametros_normativos (chave, "valorData", "fundamentoLegal", "vigenciaInicio")
  VALUES ('MARCO_TEMPORAL_OCUPACAO','2017-11-17','IN 002/2026, Art. 11 §1º','2026-05-18');
INSERT INTO parametros_normativos (chave, "valorData", "fundamentoLegal", "vigenciaInicio")
  VALUES ('MARCO_TEMPORAL_OCUPACAO','2017-11-19','IN 002/2026, Anexo II','2026-05-18');

\echo ''
\echo '=== 5. Relacionamento invertido (B,A) após (A,B) ==='
INSERT INTO processos ("numeroSei", "interessadoId", "imovelId") VALUES ('SEI-0003', 1, 1);
UPDATE processos SET situacao='ARQUIVADO', "dataEncerramento"=now() WHERE "numeroSei"='SEI-0003';
INSERT INTO processos_relacionamentos ("processoMenorId", "processoMaiorId", motivo) VALUES (1, 2, 'SOBREPOSICAO');
INSERT INTO processos_relacionamentos ("processoMenorId", "processoMaiorId", motivo) VALUES (2, 1, 'SOBREPOSICAO');

\echo ''
\echo '=== 6. Pessoa FISICA sem CPF ==='
INSERT INTO pessoas ("tipoPessoa", nome) VALUES ('FISICA','Sem CPF');

\echo ''
\echo '=== 7. Termo de anuência: dois vigentes para a mesma pessoas ==='
INSERT INTO termos_anuencia ("pessoaId", "telefoneAplicativo", email, "assinadoEm") VALUES (1,'95999990000','a@b.com','2026-06-01');
INSERT INTO termos_anuencia ("pessoaId", "telefoneAplicativo", email, "assinadoEm") VALUES (1,'95999991111','c@d.com','2026-07-01');

\echo ''
\echo '=== 8. Art. 71 III — ciência efetiva é a data que ocorrer POR ÚLTIMO ==='
INSERT INTO comunicacoes ("processoId", tipo, assunto, "prazoDias") VALUES (1,'INTIMACAO','Retificação de área',15);
INSERT INTO tentativas_entrega ("comunicacaoId", ordem, meio, destino, "enviadaEm", "confirmadaEm", resultado)
 VALUES (1,1,'APLICATIVO_MENSAGENS','95999990000','2026-06-01 09:00-04','2026-06-01 09:12-04','ENTREGUE_CONFIRMADO'),
        (1,2,'EMAIL','a@b.com',              '2026-06-01 09:00-04','2026-06-03 14:40-04','ENTREGUE_CONFIRMADO');
SELECT max("confirmadaEm") AS ciencia_efetiva_art71_III FROM tentativas_entrega WHERE "comunicacaoId" = 1;

\echo ''
\echo '=== 9. Área de triagem calculada sob demanda (sem coluna gerada) ==='
SELECT denominacao,
       "areaDeclaradaHa",
       ROUND((ST_Area(perimetro::geography)/10000)::numeric, 4) AS area_triagem_ha,
       ROUND(abs("areaDeclaradaHa" - (ST_Area(perimetro::geography)/10000)::numeric), 4) AS divergencia_ha
FROM imoveis;

\echo ''
\echo '=== 10. Faixa resolvida a partir da área e do módulo fiscal vigente ==='
SELECT i.denominacao,
       i."areaDeclaradaHa",
       m.hectares                                   AS modulo_fiscal_ha,
       round(i."areaDeclaradaHa" / m.hectares, 4)   AS modulos,
       f.codigo                                     AS faixa,
       f."anexoReferencia"                           AS anexo
FROM imoveis i
JOIN modulos_fiscais m
  ON m."municipioId" = i."municipioId"
 AND daterange(m."vigenciaInicio", m."vigenciaFim", '[)') @> CURRENT_DATE
JOIN faixas_modulo_fiscal f
  ON numrange(f."limiteInferiorExclusivo", f."limiteSuperiorInclusivo", '(]')
     @> (i."areaDeclaradaHa" / m.hectares)
 AND daterange(f."vigenciaInicio", f."vigenciaFim", '[)') @> CURRENT_DATE;

\echo ''
\echo '=== 11. Os autos nao caem junto com o processos (ON DELETE RESTRICT) ==='
INSERT INTO tipos_documento (codigo,nome) VALUES ('RG','Documento de identidade');
INSERT INTO documentos_processo ("processoId","tipoDocumentoId","nomeOriginal","storageKey","mimeType","tamanhoBytes","hashSha256","formaAutenticacao")
 VALUES (1,1,'rg.pdf','proc/1/rg.pdf','application/pdf',1024,repeat('a',64),'ASSINATURA_DIGITAL_ICP');
DELETE FROM processos WHERE id = 1;
