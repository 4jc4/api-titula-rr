\set ON_ERROR_STOP off
\pset pager off

INSERT INTO municipios ("codigoIbge",nome) VALUES ('1400100','Boa Vista');
INSERT INTO pessoas ("tipoPessoa",nome,cpf) VALUES ('FISICA','Teste','12345678901');
INSERT INTO imoveis (denominacao,"municipioId","areaDeclaradaHa") VALUES ('Sitio',1,100);
INSERT INTO processos ("numeroSei","interessadoId","imovelId") VALUES ('SEI-1',1,1);
INSERT INTO taxas_processuais (codigo,descricao,valor,"fundamentoLegal","vigenciaInicio")
 VALUES ('ABERTURA_RURAL','Taxa de abertura de processos rural',180.00,'Lei 1.252/2018 alterada pela Lei 2.317/2025','2026-01-01');

\echo ''
\echo '=== 1. Valor congelado: taxa reajusta, boleto emitido nao muda ==='
INSERT INTO debitos_taxa ("processoId","taxaProcessualId",valor,"numeroDocumento","dataVencimento")
 VALUES (1,1,180.00,'DAE-2026-0001','2026-09-30');
UPDATE taxas_processuais SET "vigenciaFim"='2027-01-01' WHERE id=1;
INSERT INTO taxas_processuais (codigo,descricao,valor,"fundamentoLegal","vigenciaInicio")
 VALUES ('ABERTURA_RURAL','Taxa de abertura de processos rural',250.00,'Reajuste 2027','2027-01-01');
SELECT d."numeroDocumento", d.valor AS valor_no_boleto,
       (SELECT valor FROM taxas_processuais WHERE codigo='ABERTURA_RURAL' AND "vigenciaFim" IS NULL) AS valor_vigente
FROM debitos_taxa d;

\echo ''
\echo '=== 2. Taxas com vigencias sobrepostas (deve falhar) ==='
INSERT INTO taxas_processuais (codigo,descricao,valor,"fundamentoLegal","vigenciaInicio")
 VALUES ('ABERTURA_RURAL','Duplicata',999.00,'Invalido','2027-06-01');

\echo ''
\echo '=== 3. PAGO sem data de pagamento (deve falhar) ==='
UPDATE debitos_taxa SET situacao='PAGO' WHERE id=1;

\echo ''
\echo '=== 4. Pagamento valido, confirmado pelo GEORF/CER (deve passar) ==='
UPDATE debitos_taxa SET situacao='PAGO', "dataPagamento"='2026-09-15', "confirmadoPorId"='georf.cer' WHERE id=1;
SELECT id, situacao, "dataPagamento", "confirmadoPorId" FROM debitos_taxa;

\echo ''
\echo '=== 5. Vencimento anterior a emissao (deve falhar) ==='
INSERT INTO debitos_taxa ("processoId","taxaProcessualId",valor,"dataEmissao","dataVencimento")
 VALUES (1,1,180.00,'2026-08-25','2026-08-01');

\echo ''
\echo '=== 6. Numero de boleto duplicado (deve falhar) ==='
INSERT INTO debitos_taxa ("processoId","taxaProcessualId",valor,"numeroDocumento","dataVencimento")
 VALUES (1,1,180.00,'DAE-2026-0001','2026-10-30');

\echo ''
\echo '=== 7. 2a via e desarquivamentos sucessivos da mesma taxa (deve passar) ==='
INSERT INTO debitos_taxa ("processoId","taxaProcessualId",valor,"numeroDocumento","dataVencimento")
 VALUES (1,1,180.00,'DAE-2026-0002','2026-10-30'),
        (1,1,180.00,'DAE-2027-0007','2027-03-30');
SELECT count(*) AS debitos_no_processo FROM debitos_taxa WHERE "processoId"=1;

\echo ''
\echo '=== 8. A pergunta da admissibilidade: ha debito em aberto? ==='
SELECT p."numeroSei",
       count(*) FILTER (WHERE d.situacao='EMITIDO') AS em_aberto,
       count(*) FILTER (WHERE d.situacao='EMITIDO' AND d."dataVencimento" < CURRENT_DATE) AS vencidos
FROM processos p LEFT JOIN debitos_taxa d ON d."processoId" = p.id
GROUP BY p."numeroSei";
