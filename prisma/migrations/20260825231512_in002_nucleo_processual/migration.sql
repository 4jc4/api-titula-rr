-- =====================================================================
-- Núcleo processual da Instrução Normativa nº 002/2026 (ITERAIMA)
-- SIRGAS 2000 (EPSG:4674) · validado em PostgreSQL 16 + PostGIS 3.4.2
--
-- Migração escrita à mão, como a do break-glass: o Prisma não expressa
-- EXCLUDE constraints, índices parciais, CHECKs compostos, funções nem
-- tipos PostGIS operáveis, e todos eles são regra de negócio aqui.
--
-- ATENÇÃO ao aplicar em produção: o LXC 20.50.2.224 roda PostgreSQL 16.13
-- SEM PostGIS. `CREATE EXTENSION postgis` abaixo FALHA lá enquanto o
-- pacote não for instalado, e o rollback do CD restaura a imagem mas não
-- desfaz migração parcial. Ver docs/reconciliacao-api-existente.md, §4.
--
-- ON UPDATE CASCADE em TODAS as FKs, embora nenhuma destas chaves mude de
-- valor: é o default implícito do Prisma para relações — `sessions_userId_fkey`,
-- gerada por ele a partir de um @relation que só declarava `onDelete`, saiu
-- com `ON DELETE CASCADE ON UPDATE CASCADE`. Escrever só o lado do DELETE
-- deixa o Postgres em NO ACTION, e o `prisma migrate dev` passa a acusar uma
-- diferença por FK contra o schema. As ações de DELETE continuam decididas
-- uma a uma (RESTRICT nos autos, SET NULL no acessório).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------
-- 1. Tipos enumerados (domínio estável — Art. 5º, 6º, 13-15, 69-74)
-- ---------------------------------------------------------------------
CREATE TYPE "TipoPessoa"            AS ENUM ('FISICA','JURIDICA');
CREATE TYPE "CondicaoNacionalidade" AS ENUM ('BRASILEIRO_NATO','BRASILEIRO_NATURALIZADO','ESTRANGEIRO');
CREATE TYPE "EstadoCivil"           AS ENUM ('SOLTEIRO','CASADO','UNIAO_ESTAVEL','DIVORCIADO','SEPARADO','VIUVO');
CREATE TYPE "TipoEndereco"          AS ENUM ('RESIDENCIAL','CORRESPONDENCIA');

CREATE TYPE "CanalProtocolo"        AS ENUM ('PORTAL_CIDADAO','PRESENCIAL');
CREATE TYPE "TipoRequerimento"      AS ENUM ('INICIAL','ADITIVO');
CREATE TYPE "SituacaoProcesso"      AS ENUM ('EM_TRAMITE','SOBRESTADO','EM_CONFLITO','ARQUIVADO','INDEFERIDO','CONCLUIDO');
CREATE TYPE "FaseProcesso"          AS ENUM (
  'PROTOCOLO','ADMISSIBILIDADE','ANALISE_SOBREPOSICAO','PARECER_DSF',
  'AUTORIZACAO_GEORREFERENCIAMENTO','ANALISE_JURIDICA','DECISAO_PRESIDENCIA',
  'APURACAO_VTN','PAGAMENTO','EMISSAO_INSTRUMENTO','ASSINATURA_PUBLICACAO',
  'POS_TITULACAO','ENCERRADO');
-- ADVOGADO é categoria própria, não um procurador comum: Art. 6º §5º exige
-- procuração ad judicia e cópia da OAB (dispensando a escritura pública do
-- §4º), o Art. 7º pu lhe dá peticionamento intercorrente e o Art. 55 §1º IV
-- o legitima a requerer desarquivamento.
CREATE TYPE "PapelParte"            AS ENUM ('PROCURADOR','ADVOGADO','TRANSMITENTE','INVENTARIANTE','RESPONSAVEL_TECNICO','CONFRONTANTE');

CREATE TYPE "RumoConfrontacao"      AS ENUM ('NORTE','SUL','LESTE','OESTE');
CREATE TYPE "TipoCoberturaVegetal" AS ENUM ('CERRADO','FLORESTA');
CREATE TYPE "TipoEletrificacao"     AS ENUM ('PUBLICA','PRIVADA','INEXISTENTE');
CREATE TYPE "TipoAcessoRodoviario" AS ENUM ('FEDERAL','ESTADUAL','MUNICIPAL','VARIANTE','CAMINHO');

CREATE TYPE "ObrigatoriedadeDoc"    AS ENUM ('OBRIGATORIO','CONDICIONAL','FACULTATIVO');
CREATE TYPE "FormaAutenticacao"     AS ENUM ('CARTORIO','CONFERE_COM_ORIGINAL','ASSINATURA_DIGITAL_ICP','DISPENSADA');

-- Sem ACAO_JUDICIAL: o Art. 15 §5º prevê relacionar ações judiciais, mas
-- esta tabela liga dois processos INTERNOS (CHECK menor < maior) e uma ação
-- é externa. O valor seria inutilizável. Suporte real exige uma entidade
-- própria (número CNJ, vara, comarca) — entra com o Cap. VII.
CREATE TYPE "MotivoRelacionamento"  AS ENUM (
  'DUPLICIDADE','SOBREPOSICAO','CADEIA_POSSESSORIA','FRACIONAMENTO_IRREGULAR',
  'CONTIGUIDADE_INDICIO_OCUPACAO','OCUPACAO_CONSOLIDADA_SENSOR');

CREATE TYPE "TipoComunicacao"       AS ENUM ('NOTIFICACAO','INTIMACAO');
CREATE TYPE "MeioComunicacao"       AS ENUM ('APLICATIVO_MENSAGENS','EMAIL','PESSOAL','POSTAL_AR','EDITAL');
CREATE TYPE "ResultadoTentativa"    AS ENUM ('ENTREGUE_CONFIRMADO','ENVIADO_SEM_CONFIRMACAO','FRUSTRADA','RECUSADA');

CREATE TYPE "ChaveParametro"        AS ENUM (
  'MARCO_TEMPORAL_OCUPACAO','VALIDADE_PARECER_SOBREPOSICAO_MESES',
  'VALIDADE_LAUDO_VISTORIA_MESES','VALIDADE_AUTORIZACAO_GEORREF_MESES',
  'PRAZO_CONFIRMACAO_INTIMACAO_DIAS_UTEIS','PRAZO_MANDATO_MESES');

-- Só o que NÃO tem tabela própria. Juntada, tramitação, comunicação,
-- relacionamento e arquivamentos já gravam data e autor nas suas tabelas —
-- repetir aqui é escrituração dupla, e duas fontes divergem.
CREATE TYPE "TipoEventoProcesso"   AS ENUM (
  'MUDANCA_FASE','MUDANCA_SITUACAO','DECISAO','DESPACHO','OBSERVACAO');

CREATE TYPE "AbrangenciaFeriado"    AS ENUM ('NACIONAL','ESTADUAL','MUNICIPAL');
CREATE TYPE "SituacaoDebito"        AS ENUM ('EMITIDO','PAGO','CANCELADO');

-- ---------------------------------------------------------------------
-- 2. Tabelas de referência territorial
-- ---------------------------------------------------------------------
CREATE TABLE municipios (
  id           SERIAL PRIMARY KEY,
  "codigoIbge"  CHAR(7)      NOT NULL UNIQUE,
  nome         VARCHAR(120) NOT NULL,
  uf           CHAR(2)      NOT NULL DEFAULT 'RR',
  CONSTRAINT ck_municipio_ibge CHECK ("codigoIbge" ~ '^[0-9]{7}$')
);

-- Módulo fiscal é definido pelo INCRA por município e MUDA por instrução
-- normativa federal. Art. 10-12 escalonam todo o rito por ele, e o Art. 51
-- manda verificar "os requisitos da lei à época" — logo, precisa de vigência.
CREATE TABLE modulos_fiscais (
  id               SERIAL PRIMARY KEY,
  "municipioId"     INTEGER      NOT NULL REFERENCES municipios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  hectares         NUMERIC(10,4) NOT NULL,
  "fundamentoLegal" VARCHAR(255)  NOT NULL,
  "vigenciaInicio"  DATE          NOT NULL,
  "vigenciaFim"     DATE,
  CONSTRAINT ck_mfm_hectares CHECK (hectares > 0),
  CONSTRAINT ck_mfm_vigencia CHECK ("vigenciaFim" IS NULL OR "vigenciaFim" > "vigenciaInicio"),
  CONSTRAINT ex_mfm_sem_sobreposicao EXCLUDE USING gist (
    "municipioId" WITH =,
    daterange("vigenciaInicio", "vigenciaFim", '[)') WITH &&
  )
);

CREATE TABLE glebas (
  id           SERIAL PRIMARY KEY,
  nome         VARCHAR(180) NOT NULL,
  codigo       VARCHAR(60),
  "municipioId" INTEGER NOT NULL REFERENCES municipios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  perimetro    geometry(MultiPolygon, 4674),
  UNIQUE (nome, "municipioId")
);

-- Setores do fluxo do Anexo X. Tabela, não enum: a estrutura organizacional
-- muda por decreto e `papelRbac` expõe explicitamente quais setores ainda
-- não têm papel correspondente na matriz de RBAC (caso da DSF).
CREATE TABLE setores (
  id         SERIAL PRIMARY KEY,
  sigla      VARCHAR(20)  NOT NULL UNIQUE,
  nome       VARCHAR(180) NOT NULL,
  "papelRbac" VARCHAR(40),
  ativo      BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- 3. Parâmetros normativos versionados
--    (a metade banco da decisão mista sobre onde ficam as regras)
-- ---------------------------------------------------------------------
CREATE TABLE parametros_normativos (
  id               SERIAL PRIMARY KEY,
  chave            "ChaveParametro" NOT NULL,
  "valorTexto"      VARCHAR(255),
  "valorNumerico"   NUMERIC(18,6),
  "valorData"       DATE,
  "fundamentoLegal" VARCHAR(255) NOT NULL,
  observacao       TEXT,
  "vigenciaInicio"  DATE NOT NULL,
  "vigenciaFim"     DATE,
  CONSTRAINT ck_param_um_valor CHECK (
    num_nonnulls("valorTexto", "valorNumerico", "valorData") = 1
  ),
  CONSTRAINT ck_param_vigencia CHECK ("vigenciaFim" IS NULL OR "vigenciaFim" > "vigenciaInicio"),
  CONSTRAINT ex_param_sem_sobreposicao EXCLUDE USING gist (
    chave WITH =,
    daterange("vigenciaInicio", "vigenciaFim", '[)') WITH &&
  )
);

-- Faixas de porte. A EXCLUDE constraint abaixo é a defesa direta contra a
-- inconsistência do Art. 10 ("até 1") vs Art. 11 ("até 4"): o banco recusa
-- faixas que se sobreponham na mesma vigência.
CREATE TABLE faixas_modulo_fiscal (
  id                         SERIAL PRIMARY KEY,
  codigo                     VARCHAR(30)  NOT NULL,
  descricao                  VARCHAR(180) NOT NULL,
  "limiteInferiorExclusivo"  NUMERIC(10,4) NOT NULL,
  "limiteSuperiorInclusivo"  NUMERIC(10,4),
  "anexoReferencia"           VARCHAR(10)  NOT NULL,
  "fundamentoLegal"           VARCHAR(255) NOT NULL,
  "vigenciaInicio"            DATE NOT NULL,
  "vigenciaFim"               DATE,
  CONSTRAINT ck_faixa_limites CHECK (
    "limiteInferiorExclusivo" >= 0
    AND ("limiteSuperiorInclusivo" IS NULL OR "limiteSuperiorInclusivo" > "limiteInferiorExclusivo")
  ),
  CONSTRAINT ck_faixa_vigencia CHECK ("vigenciaFim" IS NULL OR "vigenciaFim" > "vigenciaInicio"),
  CONSTRAINT ex_faixa_sem_sobreposicao EXCLUDE USING gist (
    numrange("limiteInferiorExclusivo", "limiteSuperiorInclusivo", '(]') WITH &&,
    daterange("vigenciaInicio", "vigenciaFim", '[)') WITH &&
  )
);

CREATE TABLE taxas_processuais (
  id               SERIAL PRIMARY KEY,
  codigo           VARCHAR(40)  NOT NULL,
  descricao        VARCHAR(180) NOT NULL,
  valor            NUMERIC(12,2) NOT NULL,
  "fundamentoLegal" VARCHAR(255) NOT NULL,
  "vigenciaInicio"  DATE NOT NULL,
  "vigenciaFim"     DATE,
  CONSTRAINT ck_taxa_valor CHECK (valor >= 0),
  CONSTRAINT ck_taxa_vigencia CHECK ("vigenciaFim" IS NULL OR "vigenciaFim" > "vigenciaInicio"),
  CONSTRAINT ex_taxa_sem_sobreposicao EXCLUDE USING gist (
    codigo WITH =,
    daterange("vigenciaInicio", "vigenciaFim", '[)') WITH &&
  )
);

-- ---------------------------------------------------------------------
-- 4. Pessoas e endereços (Art. 6º, I a VI, §4º · Anexo I)
-- ---------------------------------------------------------------------
CREATE TABLE pessoas (
  id                       SERIAL PRIMARY KEY,
  "tipoPessoa"              "TipoPessoa" NOT NULL DEFAULT 'FISICA',
  nome                     VARCHAR(180) NOT NULL,
  cpf                      CHAR(11) UNIQUE,
  cnpj                     CHAR(14) UNIQUE,
  rg                       VARCHAR(30),
  "orgaoEmissorRg"         VARCHAR(30),
  "dataNascimento"          DATE,
  "condicaoNacionalidade"   "CondicaoNacionalidade",
  nacionalidade            VARCHAR(60),
  naturalidade             VARCHAR(120),
  profissao                VARCHAR(120),
  "estadoCivil"             "EstadoCivil",
  email                    VARCHAR(180),
  telefone                 VARCHAR(20),
  celular                  VARCHAR(20),
  "portariaNaturalizacao"   VARCHAR(120),
  "criadoEm"                TIMESTAMPTZ NOT NULL DEFAULT now(),
  "atualizadoEm"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Art. 6º, IV exige CPF do interessado; §4º admite PJ apenas como procurador
  CONSTRAINT ck_pessoa_documento CHECK (
    ("tipoPessoa" = 'FISICA'   AND cpf  IS NOT NULL AND cnpj IS NULL) OR
    ("tipoPessoa" = 'JURIDICA' AND cnpj IS NOT NULL AND cpf  IS NULL)
  ),
  CONSTRAINT ck_pessoa_cpf_formato  CHECK (cpf  IS NULL OR cpf  ~ '^[0-9]{11}$'),
  CONSTRAINT ck_pessoa_cnpj_formato CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
  -- Art. 6º, XI: naturalizado precisa comprovar por portaria/certificado
  CONSTRAINT ck_pessoa_naturalizacao CHECK (
    "condicaoNacionalidade" IS DISTINCT FROM 'BRASILEIRO_NATURALIZADO'
    OR "portariaNaturalizacao" IS NOT NULL
  )
);

CREATE TABLE enderecos (
  id           SERIAL PRIMARY KEY,
  "pessoaId"    INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE ON UPDATE CASCADE,
  tipo         "TipoEndereco" NOT NULL DEFAULT 'RESIDENCIAL',
  logradouro   VARCHAR(180) NOT NULL,
  numero       VARCHAR(20),
  complemento  VARCHAR(120),
  bairro       VARCHAR(120),
  "municipioId" INTEGER NOT NULL REFERENCES municipios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  cep          CHAR(8),
  CONSTRAINT ck_endereco_cep CHECK (cep IS NULL OR cep ~ '^[0-9]{8}$')
);
CREATE INDEX ix_endereco_pessoa ON enderecos ("pessoaId");

-- ---------------------------------------------------------------------
-- 5. Imóvel (Art. 6º, II e III · Anexo I · Art. 23)
-- ---------------------------------------------------------------------
CREATE TABLE imoveis (
  id                    SERIAL PRIMARY KEY,
  denominacao           VARCHAR(180) NOT NULL,
  "municipioId"          INTEGER NOT NULL REFERENCES municipios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "glebaId"              INTEGER REFERENCES glebas(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "enderecoDescritivo"   TEXT,
  -- área declarada pelo requerente no Anexo I
  "areaDeclaradaHa"     NUMERIC(14,4) NOT NULL,
  -- área da peça técnica certificada: é a autoritativa (Art. 23 + NTGIR/INCRA)
  "areaCertificadaHa"   NUMERIC(14,4),
  "codigoSncr"           VARCHAR(30),
  "codigoCcir"           VARCHAR(30),
  "codigoParcelaSigef"  VARCHAR(60),
  matricula             VARCHAR(60),
  cartorio              VARCHAR(180),
  perimetro             geometry(MultiPolygon, 4674),
  "criadoEm"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_imovel_area CHECK ("areaDeclaradaHa" > 0),
  CONSTRAINT ck_imovel_area_cert CHECK ("areaCertificadaHa" IS NULL OR "areaCertificadaHa" > 0),
  CONSTRAINT ck_imovel_perimetro_valido CHECK (perimetro IS NULL OR ST_IsValid(perimetro))
);
CREATE INDEX ix_imovel_perimetro ON imoveis USING gist (perimetro);
CREATE INDEX ix_imovel_municipio ON imoveis ("municipioId");
CREATE UNIQUE INDEX ux_imovel_parcela_sigef ON imoveis ("codigoParcelaSigef")
  WHERE "codigoParcelaSigef" IS NOT NULL;

-- Área de triagem NÃO é coluna: o Art. 23 remete ao cálculo em Sistema
-- Geodésico Local do INCRA, que não é reproduzível aqui, e uma coluna
-- GENERATED numa tabela que o Prisma escreve é armadilha (erro 428C9 se
-- alguém a passar em create/update). O GeoService calcula sob demanda:
--   SELECT ROUND((ST_Area(perimetro::geography)/10000)::numeric, 4)
--     FROM imoveis WHERE id = $1;

-- ---------------------------------------------------------------------
-- 6. Processo e requerimentos (Art. 5º, 7º, 78)
-- ---------------------------------------------------------------------
CREATE TABLE processos (
  id                        SERIAL PRIMARY KEY,
  "numeroSei"                VARCHAR(40) NOT NULL UNIQUE,
  "numeroProtocolo"          VARCHAR(40) UNIQUE,
  "interessadoId"            INTEGER  NOT NULL REFERENCES pessoas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "conjugeId"                INTEGER  REFERENCES pessoas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "imovelId"                 INTEGER  NOT NULL REFERENCES imoveis(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  situacao                  "SituacaoProcesso" NOT NULL DEFAULT 'EM_TRAMITE',
  "faseAtual"                "FaseProcesso"     NOT NULL DEFAULT 'PROTOCOLO',
  "setorAtualId"            INTEGER REFERENCES setores(id) ON DELETE SET NULL ON UPDATE CASCADE,
  -- snapshots deliberados: registram QUAL regra foi aplicada a este processos
  "faixaModuloFiscalId"    INTEGER REFERENCES faixas_modulo_fiscal(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "moduloFiscalAplicadoHa" NUMERIC(10,4),
  "numeroModulosFiscais"    NUMERIC(12,4),
  "marcoTemporalAplicado"   DATE,
  "dataAbertura"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "dataEncerramento"         TIMESTAMPTZ,
  CONSTRAINT ck_processo_conjuge  CHECK ("conjugeId" IS NULL OR "conjugeId" <> "interessadoId"),
  CONSTRAINT ck_processo_modulos  CHECK ("numeroModulosFiscais" IS NULL OR "numeroModulosFiscais" > 0),
  CONSTRAINT ck_processo_encerrado CHECK (
    (situacao IN ('ARQUIVADO','INDEFERIDO','CONCLUIDO')) = ("dataEncerramento" IS NOT NULL)
  )
);
CREATE INDEX ix_processo_interessado ON processos ("interessadoId");
CREATE INDEX ix_processo_imovel      ON processos ("imovelId");
CREATE INDEX ix_processo_situacao    ON processos (situacao, "faseAtual");
CREATE INDEX ix_processo_setor       ON processos ("setorAtualId", situacao);

-- Art. 5º, parágrafo único: "sendo vedada a duplicidade de processos".
-- Índice parcial — o Prisma não expressa; precisa ficar aqui.
CREATE UNIQUE INDEX ux_processo_ativo_por_interessado_imovel
  ON processos ("interessadoId", "imovelId")
  WHERE situacao IN ('EM_TRAMITE','SOBRESTADO','EM_CONFLITO');

CREATE TABLE requerimentos (
  id                  SERIAL PRIMARY KEY,
  "processoId"         INTEGER NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  tipo                "TipoRequerimento" NOT NULL DEFAULT 'INICIAL',
  canal               "CanalProtocolo"   NOT NULL,
  "dataProtocolo"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "protocoladoPorId"  INTEGER REFERENCES pessoas(id) ON DELETE SET NULL ON UPDATE CASCADE,
  observacao          TEXT
);
CREATE INDEX ix_requerimento_processo ON requerimentos ("processoId");
-- um único requerimentos INICIAL por processos; aditivos são anexados (Art. 5º pu)
CREATE UNIQUE INDEX ux_requerimento_inicial ON requerimentos ("processoId") WHERE tipo = 'INICIAL';

-- Partes com vínculo temporal e multiplicidade (Art. 6º §4º a §8º)
CREATE TABLE partes_processo (
  id                       SERIAL PRIMARY KEY,
  "processoId"              INTEGER NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "pessoaId"                INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  papel                    "PapelParte" NOT NULL,
  "dataInicio"              DATE NOT NULL DEFAULT CURRENT_DATE,
  "dataFim"                 DATE,
  "mandatoValidoAte"       DATE,
  CONSTRAINT ck_parte_periodo CHECK ("dataFim" IS NULL OR "dataFim" >= "dataInicio")
);
CREATE INDEX ix_parte_processo ON partes_processo ("processoId", papel);
CREATE UNIQUE INDEX ux_parte_vigente ON partes_processo ("processoId", "pessoaId", papel)
  WHERE "dataFim" IS NULL;

-- ---------------------------------------------------------------------
-- 7. Declaração de qualificação (Anexos II e III)
--    Fatos DECLARADOS ficam aqui, não no imóvel: são afirmação do
--    requerente sob o Art. 299 do CP, datada e congelada.
-- ---------------------------------------------------------------------
CREATE TABLE declaracoes_qualificacao (
  id                             SERIAL PRIMARY KEY,
  "processoId"                    INTEGER NOT NULL UNIQUE REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "ocupantePrimitivo"             BOOLEAN NOT NULL,
  "transmitenteId"                INTEGER REFERENCES pessoas(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "dataOcupacaoPrimitiva"        DATE,
  "dataOcupacaoAtual"            DATE,
  "haContestacaoTerceiros"       BOOLEAN NOT NULL DEFAULT FALSE,
  "jaBeneficiadoProgFundiario"  BOOLEAN NOT NULL DEFAULT FALSE,
  "ocupacaoAnteriorMarco"        BOOLEAN NOT NULL,
  -- qual marco temporal foi apresentado ao declarante (Art. 11 §1º = 17/11/2017
  -- vs Anexo II = 19/11/2017): grava-se o efetivamente aplicado
  "marcoTemporalReferencia"      DATE NOT NULL,
  "atividadeRecreativaFamiliar"  BOOLEAN NOT NULL DEFAULT FALSE,
  "exerceMoradiaHabitual"        BOOLEAN,
  "declaraAusenciaTrabalhoEscravo" BOOLEAN NOT NULL,
  eletrificacao                  "TipoEletrificacao",
  "haAcessoRodoviario"           BOOLEAN,
  "tipoAcesso"                    "TipoAcessoRodoviario",
  "acessoPavimentado"             BOOLEAN,
  "edificacoesExistentes"         TEXT,
  "criacoesExistentes"            TEXT,
  "interesseEcologico"            BOOLEAN NOT NULL DEFAULT FALSE,
  "projetoRecuperacaoDegradada"  BOOLEAN NOT NULL DEFAULT FALSE,
  "efetivaRecuperacaoDegradada"  BOOLEAN NOT NULL DEFAULT FALSE,
  "culturaEfetiva"                BOOLEAN NOT NULL DEFAULT FALSE,
  -- RL total NÃO fica aqui: é a soma de coberturas_vegetais,
  -- e dois lugares para o mesmo número divergem.
  "assinadaEm"                    DATE NOT NULL,
  CONSTRAINT ck_decl_transmitente CHECK ("ocupantePrimitivo" OR "transmitenteId" IS NOT NULL),
  CONSTRAINT ck_decl_recreativa   CHECK (NOT "atividadeRecreativaFamiliar" OR "exerceMoradiaHabitual" IS NOT NULL),
  CONSTRAINT ck_decl_acesso       CHECK ("haAcessoRodoviario" IS NOT TRUE OR "tipoAcesso" IS NOT NULL),
  CONSTRAINT ck_decl_datas        CHECK (
    "dataOcupacaoPrimitiva" IS NULL OR "dataOcupacaoAtual" IS NULL
    OR "dataOcupacaoAtual" >= "dataOcupacaoPrimitiva"
  )
);

-- 1FN: Cerrado e Floresta eram colunas repetidas no formulário
CREATE TABLE coberturas_vegetais (
  id                      SERIAL PRIMARY KEY,
  "declaracaoId"           INTEGER NOT NULL REFERENCES declaracoes_qualificacao(id) ON DELETE CASCADE ON UPDATE CASCADE,
  tipo                    "TipoCoberturaVegetal" NOT NULL,
  "areaHa"                 NUMERIC(14,4) NOT NULL,
  "areaReservaLegalHa"   NUMERIC(14,4),
  percentual              NUMERIC(6,3),
  UNIQUE ("declaracaoId", tipo),
  CONSTRAINT ck_cob_area CHECK ("areaHa" >= 0),
  CONSTRAINT ck_cob_pct  CHECK (percentual IS NULL OR (percentual >= 0 AND percentual <= 100))
);

-- 1FN: norte/sul/leste/oeste eram quatro linhas fixas do Anexo III
CREATE TABLE confrontacoes (
  id              SERIAL PRIMARY KEY,
  "declaracaoId"   INTEGER NOT NULL REFERENCES declaracoes_qualificacao(id) ON DELETE CASCADE ON UPDATE CASCADE,
  rumo            "RumoConfrontacao" NOT NULL,
  descricao       TEXT NOT NULL,
  "confrontanteId" INTEGER REFERENCES pessoas(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ordem           SMALLINT NOT NULL DEFAULT 1,
  UNIQUE ("declaracaoId", rumo, ordem)
);

-- ---------------------------------------------------------------------
-- 8. Documentos e checklist (Art. 6º · Anexos VII, VIII, IX)
-- ---------------------------------------------------------------------
CREATE TABLE tipos_documento (
  id                 SERIAL PRIMARY KEY,
  codigo             VARCHAR(60)  NOT NULL UNIQUE,
  nome               VARCHAR(180) NOT NULL,
  descricao          TEXT,
  "exigeAutenticacao" BOOLEAN NOT NULL DEFAULT TRUE,
  "aceitaDigital"     BOOLEAN NOT NULL DEFAULT TRUE
);

-- União de Art. 6º com o anexo da faixa. Resolve a divergência entre as
-- listas (declaração de nacionalidade só no Art. 6º; comprovação de renda
-- só no Anexo VII; certidão negativa só no Anexo IX).
CREATE TABLE checklist_exigencias (
  id                    SERIAL PRIMARY KEY,
  "tipoDocumentoId"     INTEGER NOT NULL REFERENCES tipos_documento(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "faixaModuloFiscalId" INTEGER NOT NULL REFERENCES faixas_modulo_fiscal(id) ON DELETE CASCADE ON UPDATE CASCADE,
  obrigatoriedade       "ObrigatoriedadeDoc" NOT NULL,
  condicao              TEXT,
  "fundamentoLegal"      VARCHAR(255) NOT NULL,
  "vigenciaInicio"       DATE NOT NULL,
  "vigenciaFim"          DATE,
  CONSTRAINT ck_checklist_condicao CHECK (obrigatoriedade <> 'CONDICIONAL' OR condicao IS NOT NULL),
  CONSTRAINT ck_checklist_vigencia CHECK ("vigenciaFim" IS NULL OR "vigenciaFim" > "vigenciaInicio"),
  CONSTRAINT ex_checklist_sem_sobreposicao EXCLUDE USING gist (
    "tipoDocumentoId" WITH =,
    "faixaModuloFiscalId" WITH =,
    daterange("vigenciaInicio", "vigenciaFim", '[)') WITH &&
  )
);

CREATE TABLE documentos_processo (
  id                  SERIAL PRIMARY KEY,
  "processoId"         INTEGER  NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "tipoDocumentoId"   INTEGER NOT NULL REFERENCES tipos_documento(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "nomeOriginal"       VARCHAR(255) NOT NULL,
  "storageKey"         VARCHAR(512) NOT NULL UNIQUE,
  "mimeType"           VARCHAR(120) NOT NULL,
  "tamanhoBytes"       BIGINT  NOT NULL,
  "hashSha256"         CHAR(64) NOT NULL,
  "formaAutenticacao"  "FormaAutenticacao" NOT NULL,
  "dataJuntada"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "juntadoPorId"      TEXT,
  "setorJuntadaId"    INTEGER REFERENCES setores(id) ON DELETE SET NULL ON UPDATE CASCADE,
  observacao          TEXT,
  CONSTRAINT ck_doc_tamanho CHECK ("tamanhoBytes" > 0),
  CONSTRAINT ck_doc_hash    CHECK ("hashSha256" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX ix_documento_processo ON documentos_processo ("processoId", "tipoDocumentoId");
CREATE INDEX ix_documento_hash     ON documentos_processo ("hashSha256");
-- mesmo arquivo, mesmo tipo, mesmo processos = reenvio, não nova juntada
CREATE UNIQUE INDEX ux_documento_dedup
  ON documentos_processo ("processoId", "tipoDocumentoId", "hashSha256");

-- ---------------------------------------------------------------------
-- 9. Tramitação (Anexo X · Art. 78 · Art. 80)
-- ---------------------------------------------------------------------
CREATE TABLE tramitacoes (
  id                  SERIAL PRIMARY KEY,
  "processoId"         INTEGER  NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "etapaAnexoX"       SMALLINT,
  "setorOrigemId"     INTEGER REFERENCES setores(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "setorDestinoId"    INTEGER NOT NULL REFERENCES setores(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "enviadoEm"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "recebidoEm"         TIMESTAMPTZ,
  "concluidoEm"        TIMESTAMPTZ,
  "servidorRecebId"   TEXT,
  despacho            TEXT,
  CONSTRAINT ck_tram_etapa   CHECK ("etapaAnexoX" IS NULL OR "etapaAnexoX" BETWEEN 1 AND 14),
  CONSTRAINT ck_tram_ordem   CHECK (
    ("recebidoEm"  IS NULL OR "recebidoEm"  >= "enviadoEm") AND
    ("concluidoEm" IS NULL OR ("recebidoEm" IS NOT NULL AND "concluidoEm" >= "recebidoEm"))
  ),
  CONSTRAINT ck_tram_setores CHECK ("setorOrigemId" IS NULL OR "setorOrigemId" <> "setorDestinoId")
);
CREATE INDEX ix_tramitacao_processo ON tramitacoes ("processoId", "enviadoEm" DESC);

-- Art. 78: "vedada a tramitação simultânea em mais de uma unidade"
CREATE UNIQUE INDEX ux_tramitacao_aberta_por_processo
  ON tramitacoes ("processoId") WHERE "concluidoEm" IS NULL;

-- ---------------------------------------------------------------------
-- 10. Relacionamento de processos (Cap. III, Art. 13-15)
--     Par não ordenado: canonizado por menor < maior para impedir (A,B)+(B,A)
-- ---------------------------------------------------------------------
CREATE TABLE processos_relacionamentos (
  id                    SERIAL PRIMARY KEY,
  "processoMenorId"     INTEGER NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "processoMaiorId"     INTEGER NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  motivo                "MotivoRelacionamento" NOT NULL,
  "setorResponsavelId"  INTEGER REFERENCES setores(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "certidaoDocumentoId" INTEGER REFERENCES documentos_processo(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "criadoEm"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "criadoPorId"         TEXT,
  CONSTRAINT ck_rel_ordem CHECK ("processoMenorId" < "processoMaiorId"),
  UNIQUE ("processoMenorId", "processoMaiorId", motivo)
);
CREATE INDEX ix_rel_maior ON processos_relacionamentos ("processoMaiorId");

-- ---------------------------------------------------------------------
-- 11. Notificação e intimação (Cap. X · Arts. 69-74 · Anexo XIII)
-- ---------------------------------------------------------------------
CREATE TABLE termos_anuencia (
  id                  SERIAL PRIMARY KEY,
  "pessoaId"           INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "telefoneAplicativo" VARCHAR(20)  NOT NULL,
  email               VARCHAR(180) NOT NULL,
  "enderecoFisico"     TEXT,
  "assinadoEm"         DATE NOT NULL,
  "revogadoEm"         DATE,
  versao              SMALLINT NOT NULL DEFAULT 1,
  CONSTRAINT ck_termo_periodo CHECK ("revogadoEm" IS NULL OR "revogadoEm" >= "assinadoEm")
);
-- Art. 69 §5º: pode ser alterado a qualquer tempo → historiza, não sobrescreve
CREATE UNIQUE INDEX ux_termo_anuencia_vigente
  ON termos_anuencia ("pessoaId") WHERE "revogadoEm" IS NULL;

CREATE TABLE comunicacoes (
  id                   SERIAL PRIMARY KEY,
  "processoId"          INTEGER NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  tipo                 "TipoComunicacao" NOT NULL,
  "setorDemandanteId"  INTEGER REFERENCES setores(id) ON DELETE SET NULL ON UPDATE CASCADE,
  assunto              VARCHAR(255) NOT NULL,
  "fundamentoLegal"     VARCHAR(255),
  "decisaoDocumentoId" INTEGER REFERENCES documentos_processo(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "expedidaEm"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "prazoDias"           SMALLINT,
  "prazoEmDiasUteis"  BOOLEAN NOT NULL DEFAULT TRUE,
  -- Art. 71, III: havendo duplo meio, vale a data que ocorrer POR ÚLTIMO
  "dataCienciaEfetiva" TIMESTAMPTZ,
  "dataInicioPrazo"    DATE,
  "dataFimPrazo"       DATE,
  "encerradaEm"         TIMESTAMPTZ,
  CONSTRAINT ck_com_prazo  CHECK ("prazoDias" IS NULL OR "prazoDias" > 0),
  CONSTRAINT ck_com_datas  CHECK ("dataFimPrazo" IS NULL OR "dataInicioPrazo" IS NULL OR "dataFimPrazo" >= "dataInicioPrazo")
);
CREATE INDEX ix_comunicacao_processo ON comunicacoes ("processoId", "expedidaEm" DESC);
CREATE INDEX ix_comunicacao_prazo    ON comunicacoes ("dataFimPrazo") WHERE "encerradaEm" IS NULL;

CREATE TABLE tentativas_entrega (
  id                     SERIAL PRIMARY KEY,
  "comunicacaoId"         INTEGER NOT NULL REFERENCES comunicacoes(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ordem                  SMALLINT NOT NULL,
  meio                   "MeioComunicacao" NOT NULL,
  destino                VARCHAR(255) NOT NULL,
  "enviadaEm"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "confirmadaEm"          TIMESTAMPTZ,
  resultado              "ResultadoTentativa" NOT NULL DEFAULT 'ENVIADO_SEM_CONFIRMACAO',
  "comprovanteDocId"     INTEGER REFERENCES documentos_processo(id) ON DELETE SET NULL ON UPDATE CASCADE,
  UNIQUE ("comunicacaoId", ordem),
  CONSTRAINT ck_tent_confirmacao CHECK (
    (resultado = 'ENTREGUE_CONFIRMADO') = ("confirmadaEm" IS NOT NULL)
  ),
  CONSTRAINT ck_tent_ordem CHECK ("confirmadaEm" IS NULL OR "confirmadaEm" >= "enviadaEm")
);

-- ---------------------------------------------------------------------
-- 12. Arquivamento e trilha de auditoria (Art. 80 · Art. 53, V)
-- ---------------------------------------------------------------------
CREATE TABLE arquivamentos (
  id                   SERIAL PRIMARY KEY,
  "processoId"          INTEGER NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "arquivadoEm"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  motivo               TEXT NOT NULL,
  "fundamentoLegal"     VARCHAR(255),
  "despachoDocumentoId" INTEGER REFERENCES documentos_processo(id) ON DELETE SET NULL ON UPDATE CASCADE,
  -- Art. 80: vedado arquivar sem decisão expressa da chefia imediata
  "chefiaAprovouId"    TEXT NOT NULL,
  "desarquivadoEm"      TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_arquivamento_vigente
  ON arquivamentos ("processoId") WHERE "desarquivadoEm" IS NULL;

CREATE TABLE processos_eventos (
  id            SERIAL PRIMARY KEY,
  "processoId"   INTEGER NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  tipo          "TipoEventoProcesso" NOT NULL,
  "faseAnterior" "FaseProcesso",
  "faseNova"     "FaseProcesso",
  "usuarioId"    TEXT,
  "ocorridoEm"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  dados         JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_evento_processo ON processos_eventos ("processoId", "ocorridoEm" DESC);

-- ---------------------------------------------------------------------
-- 13. Calendário de feriados e contagem de dias úteis
--     Art. 71 §1º (5 dias úteis) e todos os prazos processuais dependem
--     disto. Sem calendário, prazo em dia útil não é computável.
-- ---------------------------------------------------------------------
CREATE TABLE feriados (
  id                SERIAL PRIMARY KEY,
  data              DATE NOT NULL,
  nome              VARCHAR(180) NOT NULL,
  abrangencia       "AbrangenciaFeriado" NOT NULL,
  uf                CHAR(2),
  "municipioId"      INTEGER REFERENCES municipios(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "fundamentoLegal"  VARCHAR(255),
  CONSTRAINT ck_feriado_escopo CHECK (
    (abrangencia = 'NACIONAL'  AND uf IS NULL     AND "municipioId" IS NULL) OR
    (abrangencia = 'ESTADUAL'  AND uf IS NOT NULL AND "municipioId" IS NULL) OR
    (abrangencia = 'MUNICIPAL' AND "municipioId" IS NOT NULL)
  ),
  -- NULLS NOT DISTINCT (PG 15+): impede duplicar o mesmo feriados nacional
  CONSTRAINT ux_feriado UNIQUE NULLS NOT DISTINCT (data, abrangencia, uf, "municipioId")
);
CREATE INDEX ix_feriado_data ON feriados (data);

-- Páscoa pelo algoritmo gregoriano anônimo (Meeus/Jones/Butcher).
-- IMMUTABLE: não depende de nada além do argumento.
CREATE OR REPLACE FUNCTION pascoa(p_ano INTEGER) RETURNS DATE
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  a INT; b INT; c INT; d INT; e INT; f INT; g INT;
  h INT; i INT; k INT; l INT; m INT; mes INT; dia INT;
BEGIN
  a := p_ano % 19;
  b := p_ano / 100;
  c := p_ano % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31;
  dia := ((h + l - 7 * m + 114) % 31) + 1;
  RETURN make_date(p_ano, mes, dia);
END; $$;

-- Gera os três feriados nacionais móveis do ano. Idempotente.
CREATE OR REPLACE FUNCTION gerar_feriados_moveis(p_ano INTEGER) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_pascoa DATE := pascoa(p_ano); v_inseridos INTEGER;
BEGIN
  INSERT INTO feriados (data, nome, abrangencia, "fundamentoLegal") VALUES
    (v_pascoa - 47, 'Carnaval',           'NACIONAL', 'Feriado movel — 47 dias antes da Pascoa'),
    (v_pascoa -  2, 'Sexta-feira Santa',  'NACIONAL', 'Feriado movel — 2 dias antes da Pascoa'),
    (v_pascoa + 60, 'Corpus Christi',     'NACIONAL', 'Feriado movel — 60 dias apos a Pascoa')
  ON CONFLICT ON CONSTRAINT ux_feriado DO NOTHING;
  GET DIAGNOSTICS v_inseridos = ROW_COUNT;
  RETURN v_inseridos;
END; $$;

-- Dia útil = seg-sex, sem feriados aplicável ao município do processos.
-- Ponto facultativo não entra na tabela: não suspende prazo.
CREATE OR REPLACE FUNCTION e_dia_util(p_data DATE, p_municipio_id INTEGER DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXTRACT(ISODOW FROM p_data) < 6
     AND NOT EXISTS (
       SELECT 1 FROM feriados f
        WHERE f.data = p_data
          AND (
                f.abrangencia = 'NACIONAL'
             OR (f.abrangencia = 'ESTADUAL'
                 AND f.uf = COALESCE((SELECT m.uf FROM municipios m WHERE m.id = p_municipio_id), 'RR'))
             OR (f.abrangencia = 'MUNICIPAL' AND f."municipioId" = p_municipio_id)
          )
     );
$$;

-- Vencimento de prazo em dias úteis. A contagem exclui o dia inicial
-- (Lei 418/2004, art. 24) e recai no próximo dia útil.
CREATE OR REPLACE FUNCTION adicionar_dias_uteis(
  p_inicio DATE, p_dias INTEGER, p_municipio_id INTEGER DEFAULT NULL
) RETURNS DATE LANGUAGE plpgsql STABLE AS $$
DECLARE
  d          DATE    := p_inicio;
  restante   INTEGER := p_dias;
  voltas     INTEGER := 0;
  -- teto defensivo: nenhum prazo legal desta IN passa de 5 anos corridos.
  -- Sem ele, uma tabela de feriados mal semeada (ex.: todo dia é feriados)
  -- deixaria o WHILE rodando para sempre e prenderia a conexao.
  max_voltas CONSTANT INTEGER := 1830;
BEGIN
  IF p_dias IS NULL OR p_dias <= 0 THEN RETURN p_inicio; END IF;
  WHILE restante > 0 LOOP
    d      := d + 1;
    voltas := voltas + 1;
    IF voltas > max_voltas THEN
      RAISE EXCEPTION
        'adicionar_dias_uteis: % dias uteis nao alcancados em % dias corridos a partir de % (municipios %). Calendario de feriados provavelmente inconsistente.',
        p_dias, max_voltas, p_inicio, p_municipio_id
        USING ERRCODE = 'data_exception';
    END IF;
    IF e_dia_util(d, p_municipio_id) THEN restante := restante - 1; END IF;
  END LOOP;
  RETURN d;
END; $$;

-- ---------------------------------------------------------------------
-- 14. Acesso do cidadão ao Portal Iteraima Cidadão (Art. 5º)
--     Principal SEPARADO do servidor: o cidadão não tem conta no AD.
--     A tabela de autenticação existente (AD + break-glass) não muda.
--     SÓ gov.br: manter senha de requerente significaria fluxo de reset,
--     bloqueio e exposição em vazamento — que é o que o gov.br evita.
-- ---------------------------------------------------------------------
CREATE TABLE pessoas_acesso (
  id             SERIAL PRIMARY KEY,
  "pessoaId"      INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "govbrSubject"  VARCHAR(255) NOT NULL,
  "emailAcesso"   VARCHAR(180) NOT NULL,
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  "criadoEm"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ultimoAcesso"  TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_pessoa_acesso_govbr ON pessoas_acesso ("govbrSubject");
-- uma credencial ativa por pessoas
CREATE UNIQUE INDEX ux_pessoa_acesso_ativo ON pessoas_acesso ("pessoaId") WHERE ativo;

-- ---------------------------------------------------------------------
-- 15. Taxas processuais devidas (Anexo X, etapa 1 — DCI)
--     A etapa 1 do fluxograma manda a DCI emitir os boletos de taxas
--     diretas já na abertura: taxa de abertura (rural/urbano), 2ª via,
--     desarquivamento, pesquisa documental, atestado de cadeia
--     possessória, transformação de alienação não onerosa em onerosa,
--     reprodução de mapas e reanálise de peças técnicas.
--     Sem isto, `taxas_processuais` fica sem consumidor e o processos pode
--     ser aberto sem a obrigação financeira que a IN prevê.
-- ---------------------------------------------------------------------
CREATE TABLE debitos_taxa (
  id                  SERIAL PRIMARY KEY,
  "processoId"         INTEGER NOT NULL REFERENCES processos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "taxaProcessualId"  INTEGER NOT NULL REFERENCES taxas_processuais(id) ON DELETE RESTRICT ON UPDATE CASCADE,

  -- valor CONGELADO na emissão: a taxa muda por lei, o boleto emitido não.
  -- Mesmo padrão dos snapshots de modulo_fiscal e marco_temporal.
  valor               NUMERIC(12,2) NOT NULL,

  "numeroDocumento"    VARCHAR(60),
  "dataEmissao"        DATE NOT NULL DEFAULT CURRENT_DATE,
  "dataVencimento"     DATE NOT NULL,
  "dataPagamento"      DATE,
  situacao            "SituacaoDebito" NOT NULL DEFAULT 'EMITIDO',
  "comprovanteDocId"  INTEGER REFERENCES documentos_processo(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "emitidoPorId"      TEXT,
  "confirmadoPorId"   TEXT,
  observacao          TEXT,

  CONSTRAINT ck_debito_valor      CHECK (valor >= 0),
  CONSTRAINT ck_debito_vencimento CHECK ("dataVencimento" >= "dataEmissao"),
  CONSTRAINT ck_debito_pagamento  CHECK ((situacao = 'PAGO') = ("dataPagamento" IS NOT NULL)),
  CONSTRAINT ck_debito_pago_apos  CHECK ("dataPagamento" IS NULL OR "dataPagamento" >= "dataEmissao")
);
CREATE INDEX ix_debito_processo ON debitos_taxa ("processoId", situacao);
CREATE UNIQUE INDEX ux_debito_numero ON debitos_taxa ("numeroDocumento")
  WHERE "numeroDocumento" IS NOT NULL;
-- em aberto e vencido: a consulta que o setores precisa todo dia
CREATE INDEX ix_debito_em_aberto ON debitos_taxa ("dataVencimento")
  WHERE situacao = 'EMITIDO';

-- Sem UNIQUE por (processos, taxa): 2ª via de boleto e desarquivamentos
-- sucessivos geram débitos legítimos da mesma taxa no mesmo processos.
-- Art. 57: o valor pago não é restituído em caso de indeferimento — por
-- isso PAGO nunca volta para EMITIDO; cancelamento é situação própria.
