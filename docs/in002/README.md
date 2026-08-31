# Núcleo processual da IN 002/2026 — índice e estado

Estes seis documentos são **rodadas de análise datadas**, não especificação
viva. Cada um registra o raciocínio de um momento: o que foi decidido, o que
foi cortado e por quê. Não os reescrevemos quando a realidade muda — o estado
atual mora aqui, no índice, e a fonte de verdade do que existe é sempre o
`prisma/schema.prisma`, as migrações e os testes.

Última atualização: **31/08/2026**.

## Os documentos

| Documento                                                            | O que é                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`modelo-dominio.md`](./modelo-dominio.md)                           | O modelo: 29 models e 23 enums, entidade por entidade, com o artigo da IN que justifica cada um              |
| [`papeis-rbac.md`](./papeis-rbac.md)                                 | Os papéis, pelo teste "papel sem ato exclusivo não existe" — e a matriz de permissões que saiu dele          |
| [`modulos-api.md`](./modulos-api.md)                                 | Os 12 módulos NestJS derivados do modelo, e a fronteira de cada um                                           |
| [`pente-fino.md`](./pente-fino.md)                                   | A rodada que cortou o que fora acrescentado sem consumidor, e consertou o `CASCADE` que apagaria os autos    |
| [`segunda-analise-lacunas.md`](./segunda-analise-lacunas.md)         | Varredura adversarial contra o texto da IN: 20 achados, dos quais 17 seguem abertos — é o backlog do domínio |
| [`reconciliacao-api-existente.md`](./reconciliacao-api-existente.md) | O confronto do modelo com a API que já existia, e o que cada lado teve de ceder                              |

## Estado em 31/08/2026

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

Aberto:

- **Os 12 módulos.** Nenhum existe ainda. O schema está no banco, e nada em
  `src/` o consome. `NormativoModule` e `TerritorioModule` são os candidatos
  naturais para começar: não dependem dos outros, e o cache de parâmetros
  vigentes é consultado por todo o resto.
- **17 dos 20 achados** da segunda varredura — os quatro estruturais
  (requerimento antes do processo, manifestação da parte, destinatário da
  comunicação, instrumento e onerosidade) mudam o formato do modelo e devem
  ser decididos antes dos módulos que os tocam.
- **Fuso das colunas de tempo.** O domínio está em `timestamptz` e
  `users`/`sessions` em `TIMESTAMP(3)`. A checagem do LXC em 31/08 acrescentou
  um dado que fecha o cerco: o cluster de produção roda em `Etc/UTC`, então
  `timestamptz` **sozinho não resolve** — `dataCienciaEfetiva::date` continua
  devolvendo o dia seguinte para um ato das 23h30 em Boa Vista. E mudar o
  fuso do banco tem efeito colateral: `createdAt` de `users`/`sessions` é
  `TIMESTAMP(3)` com `DEFAULT CURRENT_TIMESTAMP`, cuja conversão usa o fuso da
  sessão — passaria a gravar hora local numa coluna que o Prisma lê como UTC,
  4 horas de defasagem silenciosa na auditoria. Recomendação: cluster em UTC,
  domínio em `timestamptz`, e `AT TIME ZONE 'America/Boa_Vista'` explícito nas
  poucas consultas que precisam de data local, confinado na camada de
  consulta. **Decisão pendente.**
- **Qual município rege a contagem de prazo** — o do imóvel ou o da sede do
  órgão. São respostas diferentes para quem tem imóvel no Cantá e residência
  em Manaus. **Decisão pendente.**
- **Dois pontos operacionais** levantados no `papeis-rbac.md` §8 e nunca
  confirmados com quem opera: se de fato só a DCI junta documento (Art. 7º), e
  quem é a chefia imediata de cada setor — sem essa lista, `gestor` não tem a
  quem ser atribuído e ninguém arquiva.
