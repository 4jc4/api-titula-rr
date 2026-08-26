# Pente fino — refinamento do modelo

Revisão do que **eu mesmo** acrescentei ao longo das rodadas, com o mesmo teste que aplicamos aos papéis:

> **Coluna, enum ou índice sem consumidor não existe.**

Nas rodadas anteriores eu só somei. Cada "fechar lacuna" acrescentou estrutura, e nada nunca foi removido. Esta passagem corta o que não se sustenta e conserta dois riscos reais.

**Resultado: 29 models (inalterado), 25 → 23 enums, 46 → 45 CHECK, 12 → 11 índices parciais, 2 índices e 4 colunas a menos.** E os autos deixaram de ser apagáveis.

---

## 1. O risco que mais importava

### Um `delete` no processo levava os autos junto

Eu tinha posto `ON DELETE CASCADE` em onze chaves estrangeiras apontando para `processos`: requerimento, partes, declaração, documentos, tramitações, relacionamentos, comunicações, arquivamento, débitos e eventos.

Isso significa que um `prisma.processo.delete({ where: { id } })` — uma linha, num serviço, num dia ruim — apagaria silenciosamente todo o dossiê: documentos, intimações com prova de ciência, histórico de tramitação, débitos pagos. Sem erro, sem log de exceção.

**Autos de processo administrativo são acervo público.** Não se apagam: arquivam-se (Art. 80) ou anulam-se (Art. 73), e as duas coisas já são situações no modelo.

As onze passaram para `ON DELETE RESTRICT`. Agora o `delete` falha alto:

```
ERROR: update or delete on table "processo" violates foreign key constraint
       "documento_processo_processo_id_fkey" on table "documento_processo"
DETAIL: Key (id)=(1) is still referenced from table "documento_processo".
```

Os `CASCADE` que ficaram são todos internos a um agregado, onde o filho não faz sentido sem o pai: cobertura vegetal e confrontações caem com a declaração, tentativas de entrega caem com a comunicação, endereços e credenciais caem com a pessoa. E a pessoa, por sua vez, está protegida por `RESTRICT` a partir do processo.

---

## 2. O que foi cortado

### `storage_backend` — coluna vira configuração

Eu tinha criado um enum de três valores e uma coluna em toda linha de `documentos_processo` para dizer onde o binário vive. Mas o backend é decisão de **deploy**, não fato por documento: enquanto houver um só, é uma constante replicada em cada linha.

Se um dia houver migração entre backends, é um `ALTER TABLE` mais um backfill — e aí a coluna terá motivo. Adicionei antecipando um problema que não existe. O backend vai para a configuração do `StorageService`.

E `SEI` como backend era pior ainda: documento "no SEI" é uma referência externa, sem `storageKey` nem hash local. Shape diferente, não valor de enum.

### Senha local do cidadão — só gov.br

Eu tinha dado ao `pessoas_acesso` duas origens: `GOVBR` e `LOCAL`, com `senha_hash` em argon2 "para contingência".

Contingência de quê? Manter senha de requerente significa assumir fluxo de recuperação, política de bloqueio, notificação de vazamento e o passivo de LGPD de guardar credencial de dezenas de milhares de cidadãos — exatamente o que o gov.br existe para evitar. E o "break-glass" faz sentido para servidor, porque sem ele a Administração para; se o Portal cair, o cidadão protocola presencialmente na DCI, como o Art. 5º já prevê.

Foram embora: o enum `OrigemAcesso`, a coluna `senha_hash` e o CHECK que as amarrava. `govbrSubject` virou `NOT NULL UNIQUE`.

### Três chaves de parâmetro que nunca mudam

`SRID_OFICIAL`, `CASAS_DECIMAIS_AREA` e `LIMITE_CONSTITUCIONAL_HECTARES` estavam em `ChaveParametro`, versionadas por vigência.

Mas SIRGAS 2000 e as quatro casas decimais estão escritos no Art. 23, e 2.500 hectares está na Constituição. Parametrizar o que só muda por emenda constitucional é cerimônia. São constantes de código, e o `LIMITE_CONSTITUCIONAL_HECTARES` sequer tem consumidor — a pesquisa de outorga que o usaria não existe (achado B3 da segunda análise).

`ChaveParametro` foi de nove para seis chaves, todas com consumidor real.

### A coluna gerada de área

`imoveis.area_calculada_ha` era `GENERATED ALWAYS AS (ROUND((ST_Area(perimetro::geography)/10000)::numeric, 4)) STORED`.

Funcionava, mas era armadilha: coluna gerada numa tabela que o Prisma escreve devolve erro `428C9` se alguém a passar em `create` ou `update`, e o Prisma não impede isso em tempo de compilação. Eu tinha "resolvido" com um comentário pedindo para nunca passá-la — que é a forma mais frágil de garantia que existe.

E o custo/benefício não fechava: coluna `STORED` paga escrita e disco para servir uma conferência pontual. Virou expressão no `GeoService`:

```sql
SELECT ROUND((ST_Area(perimetro::geography)/10000)::numeric, 4)
  FROM imovel WHERE id = $1;
```

Mesmo resultado, sem armadilha, sem drift. As três áreas viraram duas colunas (declarada e certificada) mais um cálculo.

### A trilha de auditoria fazia escrituração dupla

`TipoEventoProcesso` tinha onze valores. Sete deles registravam fatos que **já têm tabela própria com data e autor**: `JUNTADA_DOCUMENTO` duplicava `documentos_processo."dataJuntada"`, `MUDANCA_SETOR` duplicava `tramitacoes`, `COMUNICACAO_EXPEDIDA` duplicava `comunicacoes."expedidaEm"`, `ARQUIVAMENTO` e `DESARQUIVAMENTO` duplicavam `arquivamentos`, `RELACIONAMENTO` duplicava `processos_relacionamentos."criadoEm"`, `ABERTURA` duplicava `processos."dataAbertura"`.

Duas fontes para o mesmo fato divergem — é questão de quando, não de se. Um relatório lê a trilha, outro lê a tabela, e os dois dão números diferentes.

O enum ficou com cinco valores, todos sem outro lugar onde morar: `MUDANCA_FASE`, `MUDANCA_SITUACAO`, `DECISAO`, `DESPACHO`, `OBSERVACAO`.

### Redundâncias menores

- **`enderecos.principal`** — havia dois mecanismos para a mesma coisa: `tipo` (RESIDENCIAL/CORRESPONDENCIA) e um booleano `principal`. O tipo já discrimina; o booleano só criava estados incoerentes (dois principais, nenhum principal).
- **`declaracoes_qualificacao."areaReservaLegalHa"`** — a RL também está por tipo de cobertura em `coberturas_vegetais`. O total é a soma; guardá-lo de novo é o mesmo número em dois lugares.
- **`feriados.ponto_facultativo`** — ponto facultativo não suspende prazo, e `e_dia_util` já o ignorava. Coluna que ninguém lê, com seed que ninguém preenche.
- **Índice GIN em `processos_eventos.dados`** — GIN sobre `jsonb` custa caro na escrita e não havia nenhuma consulta filtrando por conteúdo do payload.
- **Índice GiST em `glebas.perimetro`** — Roraima tem algumas dezenas de glebas. Índice espacial em tabela desse tamanho nunca é escolhido pelo planner; é custo de escrita puro.

---

## 3. A melhoria de consulta

`ix_processo_setor` era `(setor_atual_id)`. Mas a consulta que a aplicação vai fazer o dia inteiro não é "processos no setor X" — é **"processos no meu setor que ainda estão em trâmite"**. Virou `(setor_atual_id, situacao)`, que serve as duas.

---

## 4. Ficam anotados, sem mexer agora

**`SituacaoProcesso.EM_CONFLITO` mistura dois eixos.** Um processo em conflito continua em trâmite — conflito é condição transitória, não etapa do ciclo de vida. Com o valor no enum, um processo não pode estar simultaneamente `SOBRESTADO` e `EM_CONFLITO`, o que a realidade permite. O correto seria derivar de `processos_relacionamentos` com motivo `SOBREPOSICAO` não resolvido. Deixo como está porque a alternativa é uma consulta em toda listagem, e a decisão fica melhor tomada junto com o módulo de conflito (Cap. VII).

**A documentação está drifting.** São seis documentos com contagens que mudaram a cada rodada — e eu já errei uma delas (escrevi "treze papéis" num enum de quinze). Três são referência viva (`modelo-dominio`, `modulos-api`, `papeis-rbac`) e três são achados datados (`inconsistencias`, `segunda-analise-lacunas`, `reconciliacao-api-existente`, mais este). Vale marcar os datados como tal e deixar os números vivos num único lugar — de preferência gerados do banco, não digitados.

---

## 5. Estado após o pente fino

Migração e seed reaplicados do zero contra PostgreSQL 16 + PostGIS 3.4.2, e as três suítes de verificação reexecutadas — todas passando, incluindo um teste novo que prova o `RESTRICT`.

|                     | Antes | Depois                                                                                                                 |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| Models              | 29    | 29                                                                                                                     |
| Enums               | 25    | **23**                                                                                                                 |
| CHECK nomeados      | 46    | **45**                                                                                                                 |
| Índices parciais    | 12    | **11**                                                                                                                 |
| EXCLUDE             | 5     | 5                                                                                                                      |
| Chaves estrangeiras | 46    | 46 (11 agora `RESTRICT` para `processos`)                                                                              |
| Funções PL/pgSQL    | 4     | 4                                                                                                                      |
| Colunas removidas   | —     | `storage_backend`, `senha_hash`, `principal`, `areaReservaLegalHa`, `ponto_facultativo`, `origem`, `area_calculada_ha` |
| Índices removidos   | —     | GIN em `processos_eventos.dados`, GiST em `glebas.perimetro`                                                           |
