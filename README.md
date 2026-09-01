# api-titula-rr

Backend do **Titula RR**, sistema de regularização fundiária do governo do
Estado de Roraima. NestJS 11 (TypeScript, ESM) + Prisma 7 sobre
PostgreSQL/PostGIS, rodando inteiramente dentro da intranet do governo — sem
nuvem pública. A identidade dos usuários vem do Active Directory
corporativo; runner de CI/CD, banco e host de produção estão todos na mesma
rede privada.

## Documentação

| Arquivo                                              | O que responde                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| [`docs/architecture.md`](./docs/architecture.md)     | Como a API funciona por dentro, e por que cada decisão não óbvia foi tomada |
| [`docs/infrastructure.md`](./docs/infrastructure.md) | As máquinas: app server, LXC do banco, AD, Nginx, portas                    |
| [`docs/deployment.md`](./docs/deployment.md)         | CI, CD, deploy manual, checklist de segredos                                |
| [`docs/runbook.md`](./docs/runbook.md)               | Verificação pós-deploy, rollback, break-glass, backup, diagnóstico          |
| [`docs/in002/`](./docs/in002/)                       | A modelagem do domínio — rodadas datadas; o `README.md` de lá tem o estado  |
| [`CLAUDE.md`](./CLAUDE.md)                           | Guia para agentes de IA trabalhando neste repositório                       |

## Stack

- **NestJS 11** (TypeScript, ESM) + **Prisma 7** (`@prisma/adapter-pg`) sobre
  **PostgreSQL 16 + PostGIS 3.4** — a mesma versão de produção, em dev e no CI
- **nestjs-zod**: Zod como fonte única do contrato HTTP — valida entrada,
  serializa saída e gera o OpenAPI (`/api/docs`) que o front consome via
  [orval](https://orval.dev)
- **ldapts**: bind LDAPS contra o Active Directory (login e reverificação
  periódica)
- **nestjs-pino**: log estruturado, com redação automática de
  cookie/token/`set-cookie`
- Sessão opaca em cookie `httpOnly` (sem JWT) — validada contra o Postgres a
  cada request; ver `SessionGuard`/`SessionService` em `CLAUDE.md`

## Modelo de domínio

O schema tem duas metades. A de **autenticação** (2 models) está em produção
desde agosto. A do **núcleo processual da IN 002/2026** — 29 models, 23 enums,
com geometria em SIRGAS 2000 (EPSG:4674) — está no banco, mas ainda sem módulo
que a consuma: o que existe hoje é o `schema.prisma`, a migração e os testes
das regras.

Boa parte das regras da Instrução Normativa vive no **banco**, não no código,
porque são invariantes que nenhum serviço pode contornar: 47 CHECK, 5 EXCLUDE
de vigência, 11 índices parciais (a vedação de processo duplicado do Art. 5º pu
e a tramitação única do Art. 78, entre eles) e 4 funções de contagem de prazo
em dias úteis. Por isso as migrações são escritas à mão — o Prisma não expressa
nada disso — e por isso cada uma dessas regras tem teste e2e próprio.

Convenção de nomes: domínio em português, infraestrutura em inglês; tabelas em
plural via `@@map` (`processos`, `documentos_processo`), colunas em camelCase
sem `@map` (ficam entre aspas no Postgres), tipos enum em PascalCase.

O raciocínio por trás do modelo — o recorte, o que foi cortado e o que ficou
anotado — está em [`docs/in002/`](./docs/in002/).

## Requisitos

- Node.js **>= 24** (`engines` no `package.json`, `engine-strict=true` no
  `.npmrc`)
- Docker + Docker Compose (Postgres+PostGIS local)

## Configuração

```bash
cp .env.example .env
```

Preencha pelo menos `DATABASE_URL`. Com `AUTH_VALIDATOR=fake` (padrão), o
login não toca o Active Directory — usa usuários fixos definidos em
`src/modules/auth/validators/fake-ad.validator.ts` (`dev.gestor`,
`dev.titulacao`, `dev.admin`, `dev.semgrupo`, todos com senha `dev`). Para
apontar para um AD real, defina `AUTH_VALIDATOR=ad` e as variáveis
`AD_*` — ver comentários no próprio `.env.example`.

Em produção, o boot **recusa subir** com `AUTH_VALIDATOR` diferente de `ad`
(trava no factory do `AuthModule`) — não tem como uma config esquecida subir
com autenticação falsa.

## Rodando localmente

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres+PostGIS em :5433
npm install
npx prisma migrate deploy                        # aplica as migrations existentes
npm run start:dev                                 # watch mode, http://localhost:3000/api
```

Documentação interativa (Swagger): `http://localhost:3000/api/docs`.

## Comandos

| Comando                                          | O que faz                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `npm run start:dev`                              | API em watch mode                                                 |
| `npm run start:debug`                            | watch mode + inspector                                            |
| `npm run build`                                  | `nest build` → `dist/`                                            |
| `npm run lint`                                   | eslint `--fix` em `src`/`apps`/`libs`/`test`                      |
| `npm run format`                                 | prettier em `src`/`test`                                          |
| `npm test`                                       | testes unitários (`*.spec.ts`, colocados junto do código)         |
| `npm run test:watch` / `test:cov` / `test:debug` | variações do unitário                                             |
| `npm run test:e2e`                               | e2e (`test/*.e2e-spec.ts`) contra Postgres+PostGIS real, em série |

## Banco de dados (Prisma)

Migrations são **manuais** neste projeto — nunca `prisma db push`.

```bash
npx prisma migrate dev --name <nome>     # nova migration, em dev
npx prisma migrate deploy                # aplica em CI/CD/produção
```

`prisma.config.ts` exige `DATABASE_URL` mesmo para comandos que não tocam
banco nenhum (ex.: `prisma generate`, que roda no `postinstall`) — exporte
um valor qualquer se for rodar comandos Prisma isolados.

Seed da conta break-glass (local/argon2, fora do AD — porta de entrada se o
AD estiver fora do ar):

```bash
DATABASE_URL=... BREAK_GLASS_USER=... BREAK_GLASS_PASSWORD=... npx tsx prisma/seed.ts
```

Seed do calendário de prazos — **nesta ordem**, porque o de feriados procura
Boa Vista pelo código IBGE para pendurar os feriados municipais nela, e é ela
que carrega a marca de sede do órgão:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/seed/municipios.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/seed/feriados.sql
```

Sem sede cadastrada, `adicionar_dias_uteis` **falha** com SQLSTATE `22000` em
vez de improvisar um calendário — ver [`docs/runbook.md`](./docs/runbook.md).

## Docker (imagem de produção)

```bash
docker build -t titula-rr-api:local .
```

Build multi-stage; a mesma imagem é buildada no CI (`docker-image` job),
que sobe um container real e confere `/api/health` — um `CMD` quebrado no
Dockerfile quebra ali, não em produção.

## Testes e2e

Cinco suítes, 57 testes, contra Postgres+PostGIS real — não mocks.

`auth.e2e-spec` sobe a aplicação e exercita sessão, RBAC e versionamento. As
quatro suítes `dominio-*` verificam as regras que vivem no banco e por isso
falam com o `pg` **direto**, sem passar pelo Nest: o driver devolve o SQLSTATE
e o nome da constraint, que é o que cada teste afirma. O helper comum está em
`test/helpers/postgres.ts`.

Rodam em série (`--runInBand`): compartilham o mesmo banco, e o `auth.e2e-spec`
limpa a tabela `users` no `beforeAll`.

O script já exporta
`NODE_ENV=test`, `AUTH_VALIDATOR=fake` e um `DATABASE_URL` local apontando
para `titularr_test` (banco diferente do de dev, `titularr`) — suba o
`docker-compose.dev.yml` e aplique as migrations nesse banco antes:

```bash
DATABASE_URL=postgresql://cardoso:iteraima@localhost:5433/titularr_test npx prisma migrate deploy
npm run test:e2e
```

## CI/CD

- **CI** (`.github/workflows/ci.yml`): lint, typecheck+build, testes
  unitários, e2e (Postgres+PostGIS real em service container) e
  `docker-image` (builda a imagem de produção e bate `/api/health` num
  container real) — em todo push/PR para `main`.
- **CD** (`.github/workflows/cd.yml`): dispara automaticamente quando o CI
  passa em `main`, num runner self-hosted dentro da intranet (é o único que
  alcança o Postgres de produção e o AD via LDAPS). `prisma migrate deploy`
  roda antes do `up`; health check com rollback automático (2 gerações)
  se falhar. Detalhes completos: [`docs/deployment.md`](./docs/deployment.md).

- **Invariantes de produção** (`.github/workflows/invariantes.yml`): de hora
  em hora no mesmo runner, confere o que nenhum teste do repositório alcança
  porque não mora no git — headers de segurança do vhost, ausência do Swagger,
  `/api/health` reportando banco e diretório, e a validade do certificado da CA
  interna com 45 dias de folga. Compartilha o `concurrency` do CD: nunca mede
  produção no meio de um deploy.

> **O merge é o deploy.** É nele que as migrações pendentes entram no banco de
> produção. Antes de um merge que mexe em schema, vale disparar o backup à mão
> — ver [`docs/runbook.md`](./docs/runbook.md).

Commit sempre em branch — nunca direto em `main`. PRs são squash-merged (o
título do PR vira a mensagem do commit, validado por Conventional Commits
em `pr-title.yml`).
