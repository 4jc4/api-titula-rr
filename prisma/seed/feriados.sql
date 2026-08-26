-- =====================================================================
-- Seed do calendário de feriados — Roraima / Boa Vista
--
-- Fixos nacionais: Lei 662/1949, Lei 6.802/1980 e Lei 14.759/2023.
-- Móveis nacionais: gerados por gerar_feriados_moveis(ano), que deriva
-- de pascoa(ano) — não precisam ser semeados ano a ano.
-- Estaduais e municipais conferidos no calendário oficial do TJRR
-- (Portaria TJRR/PR nº 1558, de 19/12/2025).
--
-- Idempotente: pode ser reexecutado.
-- Requer: municipios já semeado (Boa Vista, IBGE 1400100).
-- =====================================================================

DO $$
DECLARE
  v_ano        INTEGER;
  v_boa_vista  INTEGER;
  v_ano_inicio CONSTANT INTEGER := 2026;
  v_ano_fim    CONSTANT INTEGER := 2036;
BEGIN
  SELECT id INTO v_boa_vista FROM municipios WHERE "codigoIbge" = '1400100';

  FOR v_ano IN v_ano_inicio..v_ano_fim LOOP

    -- Nacionais fixos
    INSERT INTO feriados (data, nome, abrangencia, "fundamentoLegal") VALUES
      (make_date(v_ano,  1,  1), 'Confraternizacao Universal',   'NACIONAL', 'Lei 662/1949'),
      (make_date(v_ano,  4, 21), 'Tiradentes',                   'NACIONAL', 'Lei 662/1949'),
      (make_date(v_ano,  5,  1), 'Dia do Trabalhador',           'NACIONAL', 'Lei 662/1949'),
      (make_date(v_ano,  9,  7), 'Independencia do Brasil',      'NACIONAL', 'Lei 662/1949'),
      (make_date(v_ano, 10, 12), 'Nossa Senhora Aparecida',      'NACIONAL', 'Lei 6.802/1980'),
      (make_date(v_ano, 11,  2), 'Finados',                      'NACIONAL', 'Lei 662/1949'),
      (make_date(v_ano, 11, 15), 'Proclamacao da Republica',     'NACIONAL', 'Lei 662/1949'),
      (make_date(v_ano, 11, 20), 'Dia Nacional de Zumbi e da Consciencia Negra',
                                                                 'NACIONAL', 'Lei 14.759/2023'),
      (make_date(v_ano, 12, 25), 'Natal',                        'NACIONAL', 'Lei 662/1949')
    ON CONFLICT ON CONSTRAINT ux_feriado DO NOTHING;

    -- Nacionais móveis (Carnaval, Sexta-feira Santa, Corpus Christi)
    PERFORM gerar_feriados_moveis(v_ano);

    -- Estaduais de Roraima
    INSERT INTO feriados (data, nome, abrangencia, uf, "fundamentoLegal") VALUES
      (make_date(v_ano, 10,  5), 'Aniversario do Estado de Roraima', 'ESTADUAL', 'RR',
       'Calendario oficial TJRR — Portaria TJRR/PR 1558/2025'),
      (make_date(v_ano, 12,  8), 'Dia da Justica e Nossa Senhora da Conceicao', 'ESTADUAL', 'RR',
       'Calendario oficial TJRR — Portaria TJRR/PR 1558/2025')
    ON CONFLICT ON CONSTRAINT ux_feriado DO NOTHING;

    -- Municipais de Boa Vista
    IF v_boa_vista IS NOT NULL THEN
      INSERT INTO feriados (data, nome, abrangencia, "municipioId", "fundamentoLegal") VALUES
        (make_date(v_ano, 1, 20), 'Sao Sebastiao, padroeiro de Boa Vista', 'MUNICIPAL', v_boa_vista,
         'Calendario oficial TJRR — Portaria TJRR/PR 1558/2025'),
        (make_date(v_ano, 7,  9), 'Aniversario de Boa Vista',              'MUNICIPAL', v_boa_vista,
         'Calendario oficial TJRR — Portaria TJRR/PR 1558/2025')
      ON CONFLICT ON CONSTRAINT ux_feriado DO NOTHING;
    END IF;

  END LOOP;
END $$;

-- Nota operacional: rodar gerar_feriados_moveis(ano) e as inserções fixas
-- para o ano seguinte é tarefa anual. Os demais municípios de RR entram
-- aqui conforme forem cadastrados, com suas leis orgânicas.
