# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`api-titula-rr` is the backend for **Titula RR**, the land-titling
(regularização fundiária) system for the Roraima state government (Brazil).
NestJS 11 (TypeScript, ESM) + Prisma 7 over PostgreSQL 16 + PostGIS 3.4,
deployed entirely inside the government's intranet — no public cloud. Identity
comes from the government's Active Directory; the runner, the database, and the
production host are all on the same private network.

## Commands

### Development

- `npm run start:dev` — watch mode
- `npm run start:debug` — watch mode + inspector
- `npm run build` — `nest build`, outputs to `dist/`
- `npm run openapi:generate` — rebuilds and writes `openapi/openapi.json`,
  which is **committed**. CI regenerates it and fails when the versioned file
  is stale, so a change to any response shape shows up as a diff in the PR.
- `npm run lint` — eslint `--fix` over `src`/`apps`/`libs`/`test`
- `npm run format` — prettier over `src`/`test`

### Tests

- `npm test` — unit tests (`*.spec.ts`, colocated with the code in `src/`).
  Requires `NODE_OPTIONS=--experimental-vm-modules` (already set by the
  script — ESM + `ts-jest`).
- Single test: `NODE_OPTIONS=--experimental-vm-modules npx jest <path-or-name-fragment>`,
  e.g. `npx jest grupos-para-papeis`.
- `npm run test:watch` / `npm run test:cov` / `npm run test:debug`
- `npm run test:e2e` — `*.e2e-spec.ts` in `test/`, against a **real**
  Postgres+PostGIS, not mocks. Five suites, 53 tests, run serially
  (`--runInBand`): they share one database and `auth.e2e-spec` wipes `users` in
  its `beforeAll`. The script already exports `NODE_ENV=test`,
  `AUTH_VALIDATOR=fake` and a local `DATABASE_URL` pointing at `titularr_test`
  — start `docker-compose.dev.yml` first and apply migrations to that database.

`auth.e2e-spec` boots the Nest app. The four `dominio-*` suites verify
constraints that live in the database and talk to `pg` **directly**, without
Nest: the driver hands back the SQLSTATE and the constraint _name_, which is
what each test asserts. Shared helper: `test/helpers/postgres.ts`.

### Database (Prisma)

- Local dev DB: `docker compose -f docker-compose.dev.yml up -d`
  (Postgres+PostGIS on **`:5433`** — the host port is per-project on this
  machine, see the comment in the compose file; user `cardoso`/`iteraima`, db
  `titularr`).
- Migrations are **manual only** — never `prisma db push`. New migration:
  `npx prisma migrate dev --name <nome> --create-only`, then write the SQL. The
  domain migrations are hand-written because Prisma expresses none of what they
  contain: EXCLUDE constraints, partial indexes, composite CHECKs, PL/pgSQL
  functions, PostGIS types. Apply in CI/CD/production:
  `npx prisma migrate deploy`.
- `prisma.config.ts` requires `DATABASE_URL` to be set even for commands that
  touch no database (e.g. `prisma generate`, which runs via `postinstall`) —
  export a dummy value if running Prisma commands standalone.
- **Extensions must already exist in production before `migrate deploy`**:
  `CREATE EXTENSION postgis` requires superuser and the application role is not
  one. See `docs/infrastructure.md`.
- Break-glass seed: `DATABASE_URL=... BREAK_GLASS_USER=... BREAK_GLASS_PASSWORD=... npx tsx prisma/seed.ts`.

### Docker (production image)

- `docker build -t titula-rr-api:local .` — multi-stage; the CI `docker-image`
  job builds this exact image and boots a real container to hit `/api/health`,
  so a broken `CMD` path breaks there, not in production.

## Architecture

Full narrative, with the reasoning behind each decision:
**`docs/architecture.md`**. What you need before touching code:

**Every request passes two global guards**, registered via `APP_GUARD` in
`src/modules/auth/auth.module.ts`, in this order: `SessionGuard` →
`PermissionGuard`. `SessionGuard` is fail-closed — every route requires a valid
session unless decorated `@Public()`.

**Session validity is decided against Postgres**, never against the AD, on the
hot path: the `session` cookie carries an opaque 256-bit token, and the
`Session` table stores only `SHA-256(token)`. Sliding 8h idle TTL, 7-day
absolute ceiling (`auth.constants.ts`). Revocation takes effect on the next
request — there is no access-token window.

**The AD is touched in exactly two places**, with two bind identities: login
binds with the user's own credentials (that bind _is_ the password check), and
the periodic recheck (every 15 min, from inside `SessionGuard`) binds with the
`svc-titula` service account. If the DC is unreachable the recheck fails open
for up to 4h, then denies. Users with `origem=LOCAL` (break-glass) never touch
the AD at all.

`AUTH_VALIDATOR=fake` swaps both for in-memory/DB fakes; the DI factories
**throw at boot** if `NODE_ENV=production` and `AUTH_VALIDATOR` isn't `ad`.

**The RBAC matrix lives in code**: `src/modules/auth/permissions.ts` —
`MATRIZ_PERMISSOES` is a `satisfies Record<Papel, readonly Permissao[]>`, so a
typo or a missing role fails to compile. `PERMISSOES_DISPONIVEIS` is the single
source; a new permission goes there first. Two rules in that matrix are easy to
break by accident:

- **`gestor` is a level, not an identity.** Art. 80 needs the supervisor told
  apart from the analyst _inside the same sector_, so `papeis` legitimately
  holds `['governanca', 'gestor']` and `temPermissao()` unions them.
  `processo:arquivar` exists only on the `gestor` line.
- **`cidadao` never comes from the AD** — no `TITULA_CIDADAO` group exists; the
  Portal role comes from `PessoaAcesso` (gov.br), and `gruposParaPapeis`
  reports that group name as an anomaly. The guard knows nothing about row
  scope, so `processo:ler` for a citizen MUST be narrowed to their own dossier
  by the service layer.

**HTTP contract**: global prefix `api` + URI versioning (`/api/v1/...`), set in
`src/configure-app.ts` — shared between `main.ts` and the e2e bootstrap
deliberately, so they can't drift apart. Routes that must survive version bumps
(`/api/health`) use `VERSION_NEUTRAL`. Every response DTO uses `@ZodResponse`
with an explicit `status`: one annotation drives the TS type, the runtime
serialization (strips fields not in the schema) and the OpenAPI the front's
orval consumes. Every error funnels through `ProblemDetailsFilter` into RFC
7807 — throw a Nest `HttpException` subclass rather than adding a route-local
filter.

**Domain model**: `prisma/schema.prisma` holds authentication (2 models, in
production) and the IN 002/2026 land-titling core (29 models, 23 enums) — the
latter has no module consuming it yet. Much of the Instrução Normativa lives in
the database: 47 CHECKs, 5 EXCLUDE constraints, 11 partial indexes, 4
business-day functions, each with an e2e test. Naming: domain in Portuguese,
infrastructure in English; tables pluralized via `@@map`, columns in camelCase
with no field-level `@map`, enum types in PascalCase.

## Documentation map

| File                     | What it holds                                                                     |
| ------------------------ | --------------------------------------------------------------------------------- |
| `docs/architecture.md`   | How the API works inside, and why each non-obvious decision was made              |
| `docs/infrastructure.md` | The machines: app server, database LXC, AD, Nginx, ports                          |
| `docs/deployment.md`     | CI, CD, manual deploy, secrets checklist                                          |
| `docs/runbook.md`        | Post-deploy checks, rollback, break-glass, backup, diagnostics                    |
| `docs/in002/`            | Domain modelling rounds — dated analyses; `README.md` there has the current state |

## Conventions worth knowing before editing

- Comments explain **why**, not what. Match that density and voice when
  touching a file that already has it — especially `prisma/schema.prisma`,
  `auth.module.ts` and `session.service.ts`.
- Tests assert **names**: constraint names in the `dominio-*` suites, route
  paths through the `API`/`HEALTH` constants in `auth.e2e-spec`. Keep it that
  way — a renamed constraint should break a test, loudly.
- Never suppress a lint rule in tests. Type the mock's signature instead; the
  `corpo<T>()` helper in `auth.e2e-spec` exists for exactly that.
- The `docs/in002/*.md` files are **dated analyses, not living spec**. Don't
  rewrite them when reality changes — add an `ATUALIZAÇÃO` block and update
  `docs/in002/README.md`, which carries the present.
- Commit to a branch, never directly to `main`. PRs are squash-merged (the PR
  title becomes the commit message, lint-checked by `pr-title.yml` against
  Conventional Commits).
- A backtick inside a `git commit -m "..."` double-quoted string gets
  shell-substituted before it reaches git. Use `git commit -F <file>` for any
  message that needs inline code.
