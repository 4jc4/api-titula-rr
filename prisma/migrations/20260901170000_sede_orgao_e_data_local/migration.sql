-- =====================================================================
-- Duas decisões que estavam pendentes desde 25/08/2026, agora fechadas.
--
-- 1. QUAL MUNICÍPIO REGE O PRAZO: o da SEDE DO ÓRGÃO.
--    O prazo existe para a parte praticar ato perante o ITERAIMA. Se Boa
--    Vista está fechada, ninguém protocola — e o prazo tem de esticar. Se
--    o Cantá tem feriado e Boa Vista não, o interessado continua podendo
--    protocolar. É a lógica do feriado forense: segue o juízo, não o
--    domicílio da parte.
--
--    Antes, `e_dia_util(data, NULL)` caía em `COALESCE(uf, 'RR')` e
--    aplicava só os estaduais, em silêncio — o achado C3 da segunda
--    varredura. Agora a omissão tem significado explícito (a sede) e a
--    ausência de sede é ERRO, não um default improvisado.
--
--    O parâmetro continua existindo: o dia em que um ato praticado EM
--    CAMPO (vistoria, entrega por agente local, edital afixado na
--    prefeitura) precisar do calendário de lá, basta passá-lo.
--
-- 2. FUSO DAS COLUNAS DE TEMPO: cluster em UTC, conversão explícita.
--    O cluster de produção roda em Etc/UTC e assim permanece. O domínio
--    fica em timestamptz, e toda derivação de DATA LOCAL passa por
--    `data_local()`. A regra viaja com a consulta em vez de depender de
--    uma configuração de servidor — e um `grep data_local` mostra todos
--    os pontos onde a data local importa.
--
--    O que isso evita: um documento juntado às 23h30 de 09/07 em Boa
--    Vista é 03h30 de 10/07 em UTC. `dataCienciaEfetiva::date` daria
--    10/07 e o prazo começaria de um dia que não aconteceu.
--
--    users/sessions seguem em TIMESTAMP(3) de propósito: mudar o fuso do
--    cluster faria `DEFAULT CURRENT_TIMESTAMP` gravar hora local numa
--    coluna que o Prisma lê como UTC — 4 horas de defasagem silenciosa
--    na auditoria de acesso, que é onde o erro custa mais caro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Sede do órgão
-- ---------------------------------------------------------------------

ALTER TABLE "municipios" ADD COLUMN "sedeOrgao" BOOLEAN NOT NULL DEFAULT false;

-- Índice único sobre expressão constante: o banco garante NO MÁXIMO uma
-- sede. Duas sedes não é um estado que o código deva ter de tratar.
CREATE UNIQUE INDEX "ux_municipio_sede_unica" ON "municipios" ((1)) WHERE "sedeOrgao";

CREATE OR REPLACE FUNCTION municipio_sede() RETURNS INTEGER
LANGUAGE plpgsql STABLE AS $$
DECLARE v_id INTEGER;
BEGIN
  SELECT m.id INTO v_id FROM municipios m WHERE m."sedeOrgao";
  IF v_id IS NULL THEN
    RAISE EXCEPTION
      'municipio_sede: nenhum municipio marcado como sede do orgao (municipios."sedeOrgao"). Sem sede nao existe calendario padrao de prazo.'
      USING ERRCODE = 'data_exception';
  END IF;
  RETURN v_id;
END; $$;

-- ---------------------------------------------------------------------
-- 2. e_dia_util: a omissão passa a significar "sede do órgão"
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION e_dia_util(p_data DATE, p_municipio_id INTEGER DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_id INTEGER;
  v_uf CHAR(2);
BEGIN
  v_id := COALESCE(p_municipio_id, municipio_sede());

  SELECT m.uf INTO v_uf FROM municipios m WHERE m.id = v_id;
  IF v_uf IS NULL THEN
    -- Antes isto passava batido: município inexistente virava "sem
    -- feriado municipal" e o prazo fechava mais cedo, sem aviso.
    RAISE EXCEPTION 'e_dia_util: municipio % inexistente', p_municipio_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN EXTRACT(ISODOW FROM p_data) < 6
     AND NOT EXISTS (
       SELECT 1 FROM feriados f
        WHERE f.data = p_data
          AND ( f.abrangencia = 'NACIONAL'
             OR (f.abrangencia = 'ESTADUAL' AND f.uf = v_uf)
             OR (f.abrangencia = 'MUNICIPAL' AND f."municipioId" = v_id) ) );
END; $$;

-- ---------------------------------------------------------------------
-- 3. adicionar_dias_uteis: resolve a sede UMA vez, fora do laço
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION adicionar_dias_uteis(
  p_inicio DATE, p_dias INTEGER, p_municipio_id INTEGER DEFAULT NULL
) RETURNS DATE LANGUAGE plpgsql STABLE AS $$
DECLARE
  d          DATE    := p_inicio;
  restante   INTEGER := p_dias;
  voltas     INTEGER := 0;
  v_mun      INTEGER;
  -- teto defensivo: nenhum prazo legal desta IN passa de 5 anos corridos.
  -- Sem ele, uma tabela de feriados mal semeada (ex.: todo dia é feriado)
  -- deixaria o WHILE rodando para sempre e prenderia a conexao.
  max_voltas CONSTANT INTEGER := 1830;
BEGIN
  IF p_dias IS NULL OR p_dias <= 0 THEN RETURN p_inicio; END IF;

  -- Resolvido aqui, e não dentro de e_dia_util a cada volta: o laço pode
  -- rodar centenas de vezes e a sede não muda no meio de uma contagem.
  v_mun := COALESCE(p_municipio_id, municipio_sede());

  WHILE restante > 0 LOOP
    d      := d + 1;
    voltas := voltas + 1;
    IF voltas > max_voltas THEN
      RAISE EXCEPTION
        'adicionar_dias_uteis: % dias uteis nao alcancados em % dias corridos a partir de % (municipio %). Calendario de feriados provavelmente inconsistente.',
        p_dias, max_voltas, p_inicio, v_mun
        USING ERRCODE = 'data_exception';
    END IF;
    IF e_dia_util(d, v_mun) THEN restante := restante - 1; END IF;
  END LOOP;

  RETURN d;
END; $$;

-- ---------------------------------------------------------------------
-- 4. data_local: a única forma correta de tirar uma data de um instante
-- ---------------------------------------------------------------------

-- IMMUTABLE de verdade: `timezone(text, timestamptz)` é immutable no
-- Postgres (não lê o TimeZone da sessão), então esta função pode entrar
-- em índice ou coluna gerada se um dia precisar.
CREATE OR REPLACE FUNCTION data_local(p_momento TIMESTAMPTZ)
RETURNS DATE LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (p_momento AT TIME ZONE 'America/Boa_Vista')::date;
$$;

COMMENT ON FUNCTION data_local(TIMESTAMPTZ) IS
  'Data civil em Boa Vista (UTC-4) de um instante. Use SEMPRE isto no lugar de ::date sobre timestamptz: o cluster roda em UTC e o cast ingenuo adianta em um dia todo ato praticado depois das 20h locais.';

COMMENT ON COLUMN "municipios"."sedeOrgao" IS
  'Sede do ITERAIMA. No maximo um municipio (ux_municipio_sede_unica). E o calendario que rege a contagem de prazo quando nenhum municipio e informado.';
