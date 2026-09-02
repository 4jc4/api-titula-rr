# Núcleo processual da IN 002/2026 — índice e estado

A norma em si está aqui, desde 02/09/2026: [`IN-002-2026.pdf`](./IN-002-2026.pdf)
é a fonte, [`IN-002-2026.txt`](./IN-002-2026.txt) é a versão que se lê com
`grep`, e [`NORMA.md`](./NORMA.md) explica os dois, mapeia os 89 artigos e
registra a rodada em que as citações dos achados estruturais foram conferidas
contra o texto. **Antes disso, toda citação neste diretório era citação de
citação** — o texto não estava versionado e ninguém conferia sem sair do repo.

Os seis documentos de análise são **rodadas datadas**, não especificação
viva. Cada um registra o raciocínio de um momento: o que foi decidido, o que
foi cortado e por quê. Não os reescrevemos quando a realidade muda — o estado
atual mora aqui, no índice, e a fonte de verdade do que existe é sempre o
`prisma/schema.prisma`, as migrações e os testes.

Última atualização: **02/09/2026**.

## Os documentos

| Documento                                                            | O que é                                                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`modelo-dominio.md`](./modelo-dominio.md)                           | O modelo: 29 models e 23 enums, entidade por entidade, com o artigo da IN que justifica cada um                                                                                      |
| [`papeis-rbac.md`](./papeis-rbac.md)                                 | Os papéis, pelo teste "papel sem ato exclusivo não existe" — e a matriz de permissões que saiu dele                                                                                  |
| [`modulos-api.md`](./modulos-api.md)                                 | Os 12 módulos NestJS derivados do modelo, e a fronteira de cada um                                                                                                                   |
| [`pente-fino.md`](./pente-fino.md)                                   | A rodada que cortou o que fora acrescentado sem consumidor, e consertou o `CASCADE` que apagaria os autos                                                                            |
| [`segunda-analise-lacunas.md`](./segunda-analise-lacunas.md)         | Varredura adversarial contra o texto da IN: 20 achados, dos quais 17 seguem abertos — é o backlog do domínio. Traz duas notas de correção de 02/09, de quando a norma entrou no repo |
| [`reconciliacao-api-existente.md`](./reconciliacao-api-existente.md) | O confronto do modelo com a API que já existia, e o que cada lado teve de ceder                                                                                                      |

## Estado em 01/09/2026

Fechado, com o commit onde aconteceu:

| Item                                                | Onde                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Convenção de nomes (camelCase, tabelas em plural)   | `f8129da`                                                                             |
| Schema, migração e seed de feriados                 | `f8129da`                                                                             |
| Enum `Papel` nos 12 papéis, 31 permissões, matriz   | `2252393`                                                                             |
| `cidadao` fora do provisionamento por grupo do AD   | `2252393`                                                                             |
| dev e CI na major de produção (PG 16 + PostGIS 3.4) | `8144b03`                                                                             |
| As 7 FKs das colunas de servidor responsável        | `d6e4523`                                                                             |
| `ON UPDATE CASCADE` nas 46 FKs escritas à mão       | `b81020d`                                                                             |
| `verifica_*.sql` convertidos em 35 testes e2e       | `1d9cc2f`                                                                             |
| PostGIS e `btree_gist` no banco de produção         | verificado e criado no LXC em 31/08 — ver [`infrastructure.md`](../infrastructure.md) |
| Backup diário com restauração testada               | idem — ver [`runbook.md`](../runbook.md)                                              |
| Prazo regido pela sede do órgão (fecha o C3)        | `20260901170000_sede_orgao_e_data_local`                                              |
| Fuso: cluster em UTC + `data_local()` explícito     | idem                                                                                  |

Aberto:

- **Os 12 módulos.** Nenhum existe ainda. O schema está no banco, e nada em
  `src/` o consome. `NormativoModule` e `TerritorioModule` são os candidatos
  naturais para começar: não dependem dos outros, e o cache de parâmetros
  vigentes é consultado por todo o resto.
- **17 dos 20 achados** da segunda varredura — os quatro estruturais
  (requerimento antes do processo, manifestação da parte, destinatário da
  comunicação, instrumento e onerosidade) mudam o formato do modelo e devem
  ser decididos antes dos módulos que os tocam. Com a norma no repo, as quatro
  citações que os sustentam foram conferidas em 02/09 e **as quatro batem**;
  A1 fica decidido pela saída (a), agora por fidelidade ao Art. 5º e não por
  economia — ver [`NORMA.md`](./NORMA.md).
- ~~**Fuso das colunas de tempo.**~~ **DECIDIDO (01/09/2026): cluster em UTC,
  conversão explícita.** O cluster de produção continua em `Etc/UTC`, o domínio
  continua em `timestamptz`, e toda derivação de data local passa por
  `data_local(timestamptz)` — função `IMMUTABLE`, porque
  `timezone(text, timestamptz)` não lê o fuso da sessão. `users`/`sessions`
  ficam em `TIMESTAMP(3)` de propósito: mudar o fuso do cluster faria
  `DEFAULT CURRENT_TIMESTAMP` gravar hora local numa coluna que o Prisma lê
  como UTC, 4 horas de defasagem silenciosa na auditoria de acesso. A regra
  está no `CLAUDE.md`: `::date` sobre `timestamptz` é proibido.
- ~~**Qual município rege a contagem de prazo.**~~ **DECIDIDO (01/09/2026): o
  da sede do órgão.** O prazo existe para a parte praticar ato perante o
  ITERAIMA — se Boa Vista está fechada, ninguém protocola. É a lógica do
  feriado forense: segue o juízo, não o domicílio da parte. `municipios` ganhou
  `sedeOrgao`, com índice parcial único garantindo no máximo uma; `e_dia_util`
  e `adicionar_dias_uteis` resolvem a omissão pela sede e **falham** se não
  houver sede, em vez do antigo `COALESCE(uf, 'RR')` silencioso — o que fecha
  o achado C3. O parâmetro continua disponível para o ato praticado em campo.
- **Um ponto operacional** levantado no `papeis-rbac.md` §8 e nunca confirmado
  com quem opera: quem é a chefia imediata de cada setor — sem essa lista,
  `gestor` não tem a quem ser atribuído e ninguém arquiva (Art. 80). O outro
  ponto, se existe estado entre protocolo e autuação, a própria norma responde:
  existe, é a admissibilidade dos Anexos VII a IX, e o Art. 49, I parágrafo
  único separa o caminho digital do presencial quando ela falha.
