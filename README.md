# api-titula-rr

Backend do **Titula RR**, sistema de regularização fundiária do governo do
Estado de Roraima. NestJS 11 (TypeScript, ESM) + Prisma 7 sobre
PostgreSQL/PostGIS, rodando inteiramente dentro da intranet do governo — sem
nuvem pública. A identidade dos usuários vem do Active Directory
corporativo; runner de CI/CD, banco e host de produção estão todos na mesma
rede privada.

Guia completo de arquitetura (fluxo de autenticação, RBAC, contrato HTTP,
convenções): [`CLAUDE.md`](./CLAUDE.md). Runbook de deploy manual, rollback
e checklist de secrets: [`docs/DEPLOY.md`](./docs/DEPLOY.md).

## Stack

- **NestJS 11** (TypeScript, ESM) + **Prisma 7** (`@prisma/adapter-pg`) sobre
  **PostgreSQL 17 + PostGIS**
- **nestjs-zod**: Zod como fonte única do contrato HTTP — valida entrada,
  serializa saída e gera o OpenAPI (`/api/docs`) que o front consome via
  [orval](https://orval.dev)
- **ldapts**: bind LDAPS contra o Active Directory (login e reverificação
  periódica)
- **nestjs-pino**: log estruturado, com redação automática de
  cookie/token/`set-cookie`
- Sessão opaca em cookie `httpOnly` (sem JWT) — validada contra o Postgres a
  cada request; ver `SessionGuard`/`SessionService` em `CLAUDE.md`

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
docker compose -f docker-compose.dev.yml up -d   # Postgres+PostGIS em :5432
npm install
npx prisma migrate deploy                        # aplica as migrations existentes
npm run start:dev                                 # watch mode, http://localhost:3000/api
```

Documentação interativa (Swagger): `http://localhost:3000/api/docs`.

## Comandos

| Comando                                          | O que faz                                                      |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `npm run start:dev`                              | API em watch mode                                              |
| `npm run start:debug`                            | watch mode + inspector                                         |
| `npm run build`                                  | `nest build` → `dist/`                                         |
| `npm run lint`                                   | eslint `--fix` em `src`/`apps`/`libs`/`test`                   |
| `npm run format`                                 | prettier em `src`/`test`                                       |
| `npm test`                                       | testes unitários (`*.spec.ts`, colocados junto do código)      |
| `npm run test:watch` / `test:cov` / `test:debug` | variações do unitário                                          |
| `npm run test:e2e`                               | testes e2e (`test/*.e2e-spec.ts`) contra Postgres+PostGIS real |

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

## Docker (imagem de produção)

```bash
docker build -t titula-rr-api:local .
```

Build multi-stage; a mesma imagem é buildada no CI (`docker-image` job),
que sobe um container real e confere `/api/health` — um `CMD` quebrado no
Dockerfile quebra ali, não em produção.

## Testes e2e

Contra Postgres+PostGIS real, não mocks. O script já exporta
`NODE_ENV=test`, `AUTH_VALIDATOR=fake` e um `DATABASE_URL` local apontando
para `titularr_test` (banco diferente do de dev, `titularr`) — suba o
`docker-compose.dev.yml` e aplique as migrations nesse banco antes:

```bash
DATABASE_URL=postgresql://cardoso:iteraima@localhost:5432/titularr_test npx prisma migrate deploy
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
  se falhar. Detalhes completos: [`docs/DEPLOY.md`](./docs/DEPLOY.md).

Commit sempre em branch — nunca direto em `main`. PRs são squash-merged (o
título do PR vira a mensagem do commit, validado por Conventional Commits
em `pr-title.yml`).
