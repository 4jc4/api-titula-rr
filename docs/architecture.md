# Arquitetura

Como o `api-titula-rr` é construído por dentro, e por que cada decisão não
óbvia foi tomada. Para as máquinas onde isso roda, ver
[`infrastructure.md`](./infrastructure.md); para como o código chega lá,
[`deployment.md`](./deployment.md).

## O terreno

A API roda inteiramente dentro da intranet do governo do Estado de Roraima —
sem nuvem pública. Isso não é detalhe de hospedagem: é a premissa que explica
quase tudo abaixo. A identidade dos usuários vem do Active Directory
corporativo, o runner de CI/CD vive na mesma rede privada, e a indisponibilidade
do controlador de domínio é um evento operacional normal, não uma catástrofe
remota — daí a existência de uma porta de entrada que não depende dele.

Três princípios se repetem no código:

1. **Fail-closed por padrão.** Toda rota exige sessão; a exceção é explícita
   (`@Public()`). Sem papel, sem acesso.
2. **Decisão de acesso contra o banco, não contra o AD**, no caminho quente.
   Revogar vale imediatamente, porque não existe token com validade própria.
3. **Regra que não pode ser contornada mora no banco.** CHECK, EXCLUDE e
   índices parciais valem para qualquer caminho de escrita, inclusive um
   `psql` de madrugada.

## O caminho de um request

```
helmet · cookie-parser · trust proxy      (configure-app.ts)
   ↓
AppThrottlerGuard        limite por IP; desligado em NODE_ENV=test
   ↓
SessionGuard             cookie → SHA-256 → sessão no Postgres → recheck no AD
   ↓                     fail-closed: sem @Public(), sem sessão, 401
PermissionGuard          lê @RequirePermission e consulta a matriz em memória
   ↓
ZodValidationPipe        valida body e query pelo schema do DTO
   ↓
handler
   ↓
ZodSerializerInterceptor corta da resposta tudo que não está no schema
   ↓
ProblemDetailsFilter     qualquer exceção vira RFC 7807 com reqId
```

O `configureApp()` ([`src/configure-app.ts`](../src/configure-app.ts)) é
compartilhado entre o bootstrap de produção e o dos testes e2e **de
propósito**. Em 12/08/2026 o e2e configurava a app por conta própria, e uma
divergência no `main.ts` passou despercebida: os testes verdes, a aplicação
real subindo sem prefixo. Se você precisar mexer em prefixo, versionamento,
cookie-parser ou CORS, é lá — nunca nos dois lugares.

## Autenticação

### A sessão

Token opaco de 256 bits (`randomBytes(32)`), entregue em cookie `httpOnly`,
`Secure` em produção, `SameSite=Strict`, `Path=/`. O banco guarda **apenas**
`SHA-256(token)` como `Session.id` — o token em si nunca é persistido.

| Parâmetro           | Valor   | Por quê                                                                    |
| ------------------- | ------- | -------------------------------------------------------------------------- |
| `IDLE_TTL`          | 8 h     | janela deslizante de inatividade                                           |
| `RENEW_THRESHOLD`   | 50 %    | só escreve no banco quando resta menos que isso — evita UPDATE por request |
| `ABSOLUTE_TTL`      | 7 dias  | teto desde o login, nunca renovado: nenhuma sessão vive para sempre        |
| `AD_RECHECK`        | 15 min  | de quanto em quanto o guard reconfere a conta no AD                        |
| `AD_FAIL_OPEN_TTL`  | 4 h     | por quanto tempo a última verificação continua valendo com o DC fora       |
| retenção da limpeza | 30 dias | sessões mortas ficam para auditoria antes do job apagar                    |

Revogação é **soft** (`revokedAt` + motivo) para a auditoria saber quando e por
quê. Um job `@Cron` às 3h apaga o que morreu há mais de 30 dias — a tabela não
pode crescer para sempre.

### As duas conversas com o AD

O AD é tocado em exatamente dois lugares, com identidades diferentes:

- **Login** ([`validators/ad.validator.ts`](../src/modules/auth/validators/ad.validator.ts)):
  bind com a credencial do **próprio usuário**. Esse bind _é_ a verificação de
  senha, e traz junto as políticas do AD (bloqueio, expiração, GPO). Senha
  vazia é recusada antes do bind: o AD trataria como bind anônimo e
  responderia sucesso.
- **Reverificação** ([`validators/ad-directory.checker.ts`](../src/modules/auth/validators/ad-directory.checker.ts)),
  dirigida pelo [`ad-recheck.service.ts`](../src/modules/auth/ad-recheck.service.ts)
  e chamada de dentro do `SessionGuard`: bind com a conta de serviço
  `svc-titula`, sem senha de usuário. O filtro exclui o bit `ACCOUNTDISABLE`,
  então conta desligada simplesmente não retorna.

O username vem do cliente e nunca entra cru num filtro LDAP — é escapado
conforme a RFC 4515.

### Degradação quando o DC cai

Indisponibilidade **não é** decisão de acesso: o `DirectoryChecker` nunca
lança, devolve o estado `indisponivel`, e quem decide o que fazer é a política
no `AdRecheckService`:

- dentro do teto de 4 h desde a última verificação boa: mantém a sessão viva e
  loga `warn`;
- além do teto: nega e loga `error`;
- `inativo` (desligamento ou perda de todos os grupos `TITULA_*`): revoga
  todas as sessões do usuário na hora.

Várias requisições simultâneas do mesmo usuário compartilham **uma** verificação
em voo (mapa de dedupe), em vez de abrirem N conexões LDAP.

### Break-glass

Contas com `origem=LOCAL` nunca tocam o AD — nem no login, nem no recheck.
Validam contra um hash argon2 no Postgres. É a única entrada quando o DC está
fora no momento do login, e é permanente, não temporária. Uma invariante no
banco garante a coerência:

```sql
CHECK ((origem = 'LOCAL') = ("passwordHash" IS NOT NULL))
```

### A trava de produção

As factories do `AuthModule` **lançam no boot** se `NODE_ENV=production` e
`AUTH_VALIDATOR` não for `ad`. Não existe caminho em que uma configuração
esquecida suba produção com autenticação falsa.

## Autorização

A matriz vive em código, não no banco
([`permissions.ts`](../src/modules/auth/permissions.ts)):
`MATRIZ_PERMISSOES` é um `satisfies Record<Papel, readonly Permissao[]>`. Três
consequências: um typo não compila, mudar acesso é um commit revisado (o git
vira a trilha de auditoria), e o guard resolve em memória sem consulta extra.
`PERMISSOES_DISPONIVEIS` é a fonte única — permissão nova entra ali primeiro.

Os 12 papéis saíram de um teste só: **um papel só existe se houver ato que só
ele pode praticar** na IN 002/2026. O raciocínio de cada um está em
[`in002/papeis-rbac.md`](./in002/papeis-rbac.md).

Duas regras dessa matriz são fáceis de quebrar sem perceber:

- **`gestor` é nível, não identidade.** O Art. 80 exige distinguir a chefia
  imediata do analista _dentro do mesmo setor_, então `papeis` legitimamente
  guarda dois valores — `['governanca', 'gestor']` — e `temPermissao()` faz a
  união. `processo:arquivar` só existe na linha do `gestor`: papel de setor
  sozinho não arquiva.
- **`cidadao` não vem do AD.** Não existe grupo `TITULA_CIDADAO`; o papel do
  Portal vem do `PessoaAcesso` (gov.br), e `gruposParaPapeis` reporta esse nome
  de grupo como anomalia em vez de conceder o papel. E o guard responde sim/não
  sobre a permissão, **sem saber de escopo de linha**: `processo:ler` para o
  cidadão significa "os processos em que sou parte", e garantir isso é
  obrigação do filtro no serviço. Sem esse filtro, a permissão abre o acervo
  inteiro.

## Contrato HTTP

Prefixo global `api` + versionamento por URI com default `v1`. O `HealthController`
é `VERSION_NEUTRAL` e fica em `/api/health`, fora da versão: monitoramento,
healthcheck de container e orquestração não podem quebrar quando a API lançar
uma v2. Pelo mesmo motivo ele é `@SkipThrottle()` — infraestrutura de
monitoramento nunca deve tomar 429.

Zod é a fonte única do contrato, via `nestjs-zod`. Uma anotação `@ZodResponse`
governa três coisas ao mesmo tempo: o tipo TypeScript, a serialização em
runtime (é o que impede `cpf` e `passwordHash` de vazarem) e o OpenAPI. **Regra
do projeto: endpoint sem schema é invisível para o orval**, que gera o cliente
do front a partir de `/api/docs-json`. O `status` precisa ser explícito no
`@ZodResponse` — sem ele, a resposta vira `default` no documento.

O contrato resultante é **versionado**: `openapi/openapi.json` é gerado por
`npm run openapi:generate` e commitado, e o CI regenera e falha se o arquivo
estiver defasado. O documento é montado por `criarDocumentoOpenApi()`
([`src/openapi.ts`](../src/openapi.ts)), compartilhado entre o bootstrap e o
script — pelo mesmo motivo do `configureApp()`. O ganho não é ter o arquivo: é
que mudar a forma de uma resposta passa a ser um diff que se vê na revisão, em
vez de algo que aparece no dia em que o cliente gerado pelo orval não compila
mais.

Todo erro sai como `application/problem+json` (RFC 7807) com o `reqId` do
request. Erro não tratado loga tudo internamente e devolve só "informe o reqId
ao suporte" — o front trata um formato só.

## Persistência

Prisma 7 com driver adapter (`@prisma/adapter-pg`). O bloco `datasource` tem
apenas `provider`; a URL vem do `prisma.config.ts` e o `PrismaService` monta o
`PrismaPg`. `PrismaModule` é `@Global()`, então módulos novos não precisam
importá-lo.

**Migrações são manuais** — nunca `prisma db push`. As do domínio são escritas
à mão porque o Prisma não expressa nada do que elas contêm: EXCLUDE
constraints, índices parciais, CHECKs compostos, funções PL/pgSQL e tipos
PostGIS operáveis. O fluxo é `prisma migrate dev --create-only` e então
substituir o SQL.

**Tempo é `timestamptz`, e data local é função.** O cluster de produção roda
em `Etc/UTC`, então `::date` sobre um `timestamptz` adianta em um dia todo ato
praticado depois das 20h em Boa Vista — que num prazo processual é a diferença
entre tempestivo e intempestivo. A conversão passa por `data_local()`
(`IMMUTABLE`, porque `timezone(text, timestamptz)` não lê o fuso da sessão), e
`::date` sobre `timestamptz` é proibido no `CLAUDE.md`. `users` e `sessions`
seguem em `TIMESTAMP(3)` de propósito: mudar o fuso do cluster faria o
`DEFAULT CURRENT_TIMESTAMP` dessas tabelas gravar hora local numa coluna que o
Prisma lê como UTC — quatro horas de defasagem silenciosa na auditoria de
acesso, que é onde o erro custa mais caro.

Duas consequências operacionais que moram fora deste repositório:

- as extensões `postgis` e `btree_gist` precisam existir no banco **antes** do
  primeiro `migrate deploy` — `CREATE EXTENSION postgis` exige superusuário e o
  papel da aplicação não é um. Ver [`infrastructure.md`](./infrastructure.md).
- o alvo é PostgreSQL 16 + PostGIS 3.4, e dev e CI rodam a mesma dupla. Validar
  numa major e implantar em outra, com tipos geométricos no meio, é aposta.

## O modelo de domínio

`prisma/schema.prisma` tem duas metades: autenticação (2 models, em produção) e
o núcleo processual da IN 002/2026 (29 models, 23 enums) — este ainda sem
nenhum módulo que o consuma. Boa parte da Instrução Normativa está em DDL: 47
CHECK, 5 EXCLUDE de vigência, 11 índices parciais e seis funções PL/pgSQL —
`pascoa`, `gerar_feriados_moveis`, `e_dia_util`, `adicionar_dias_uteis`,
`municipio_sede` e `data_local`. Cada uma dessas regras tem teste e2e.

**O prazo segue o calendário da sede do órgão.** `adicionar_dias_uteis` sem
município resolve por `municipios."sedeOrgao"` — Boa Vista —, e não pelo
município do imóvel: o prazo existe para a parte praticar ato perante o
ITERAIMA, e se a sede está fechada ninguém protocola. É a lógica do feriado
forense, que segue o juízo e não o domicílio da parte. Um índice parcial único
garante no máximo uma sede, e a ausência de sede é **erro** (`22000`), não um
default improvisado. O parâmetro continua disponível para o dia em que um ato
praticado em campo — vistoria, entrega por agente local, edital afixado na
prefeitura — precisar do calendário de lá. A diferença é medível: cinco dias
úteis a partir de 03/07/2026 vencem em 13/07 pela sede e em 10/07 pelo Cantá.

Convenção: domínio em português, infraestrutura em inglês; tabelas em plural
via `@@map`, colunas em camelCase sem `@map` de campo (ficam entre aspas no
Postgres), tipos enum em PascalCase. SQL cru com geometria deve ficar confinado
ao futuro `GeoModule` — em `$queryRaw`, esquecer as aspas de `"areaCalculadaHa"`
falha em runtime, não em compilação.

Os documentos de modelagem e o estado de cada frente: [`in002/`](./in002/).

## Observabilidade

`nestjs-pino` com um `reqId` por request, que aparece em todo log e no corpo
dos Problem Details. JSON puro em produção; `pino-pretty` em dev; **silencioso
em teste**, senão 53 e2e enterram a saída do jest.

`redact` cobre `cookie`, `authorization` e `set-cookie`: log com token é
credencial vazada em disco. E `autoLogging.ignore` pula `/api/health`, senão o
Zabbix batendo de minuto em minuto produz ~1440 linhas por dia de ruído.

## Testes

- **Unitários**, colocados junto do código em `src/`. Cobrem a política
  (fail-open, recheck, matriz, mapeamento de grupos) com mocks tipados — a
  regra do projeto é tipar a assinatura do mock, nunca suprimir a regra do
  lint.
- **e2e**, cinco suítes em `test/`, contra Postgres+PostGIS real, em série
  (`--runInBand`), porque compartilham o banco e o `auth.e2e-spec` limpa
  `users` no `beforeAll`.
  - `auth.e2e-spec` sobe a aplicação inteira: versionamento, headers, sessão,
    RBAC, revogação.
  - as quatro `dominio-*` verificam as constraints do banco e falam com o `pg`
    **direto**, sem o Nest: o driver devolve o SQLSTATE e o _nome_ da
    constraint, que é o que cada teste afirma. Helper comum em
    `test/helpers/postgres.ts`.

Vários e2e existem para travar decisões, não caminhos felizes: o health fora da
versão, o health **não** respondendo sob `/api/v1`, nada respondendo sem
prefixo, o 403 vindo antes do 404 (prova que o guard barra antes do handler).

## Decisões que parecem estranhas e não são

- **Desligamento gracioso registrado à mão**, em vez de
  `app.enableShutdownHooks()`: o helper do Nest liga os sinais a um `close()`
  que corre em paralelo com o flush do pino, e o processo pode morrer antes do
  último log sair (nestjs/nest#15978).
- **`@Throttle` mais apertado no `/auth/login`** (5/min contra o teto global de
  30): cada tentativa faz um bind LDAP com a senha informada, então sem limite
  o endpoint é vetor de **bloqueio de conta no AD por terceiro**, não só de
  brute force local.
- **`contentSecurityPolicy: false` no helmet**: o Swagger UI é servido pela
  própria API e a CSP padrão quebra os assets dele. O resto dos headers segue
  ativo.
- **CORS ausente por padrão**: navegador e API vivem na mesma origem atrás do
  Nginx. `CORS_ORIGIN` existe para o dia em que isso mudar, sem precisar de
  código.
- **`forRoutes: [{ path: '*path' }]` no logger**: com Express 5, o `'*'` cru
  não é mais suportado e dispara warn a cada boot.
