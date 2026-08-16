# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`api-titula-rr` is the backend for **Titula RR**, the land-titling
(regularização fundiária) system for the Roraima state government (Brazil).
NestJS 11 (TypeScript, ESM) + Prisma 7 over PostgreSQL/PostGIS, deployed
entirely inside the government's intranet — no public cloud. Identity comes
from the government's Active Directory; the runner, the database, and the
production host are all on the same private network.

## Commands

### Development

- `npm run start:dev` — watch mode
- `npm run start:debug` — watch mode + inspector
- `npm run build` — `nest build`, outputs to `dist/`
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
  Postgres+PostGIS, not mocks. The script already exports `NODE_ENV=test`,
  `AUTH_VALIDATOR=fake`, and a local `DATABASE_URL` pointing at a
  `titularr_test` database (different from the dev database below) — start
  `docker-compose.dev.yml` first and apply migrations to `titularr_test`
  before running.

### Database (Prisma)

- Local dev DB: `docker compose -f docker-compose.dev.yml up -d`
  (Postgres+PostGIS on `:5432`, user `cardoso`/`iteraima`, db `titularr`).
- Migrations are **manual only** in this project — never `prisma db push`.
  New migration: `npx prisma migrate dev --name <nome>`. Apply in
  CI/CD/production: `npx prisma migrate deploy`.
- `prisma.config.ts` requires `DATABASE_URL` to be set even for commands
  that touch no database (e.g. `prisma generate`, which runs automatically
  via `postinstall`) — export a dummy value if running Prisma commands
  standalone.
- Break-glass account seed (local/argon2, outside the AD):
  `DATABASE_URL=... BREAK_GLASS_USER=... BREAK_GLASS_PASSWORD=... npx tsx prisma/seed.ts`.

### Docker (production image)

- `docker build -t titula-rr-api:local .` — multi-stage; the CI
  `docker-image` job builds this exact image and boots a real container to
  hit `/api/health`, so a broken `CMD` path breaks there, not in production.

## Architecture

### Request path & auth

This is the part that needs several files read together to piece together.
Every request passes through two global guards, registered via `APP_GUARD`
in `src/modules/auth/auth.module.ts`, in this order: `SessionGuard` →
`PermissionGuard`. `SessionGuard` is fail-closed by default — every route
requires a valid session unless decorated `@Public()`.

Session validity is decided **against Postgres**, never against the Active
Directory, on the hot path: the `session` cookie carries an opaque 256-bit
token; the `Session` table stores only `SHA-256(token)`
(`session.service.ts`), with a sliding 8h idle TTL and a 7-day absolute
ceiling (`auth.constants.ts`).

The AD is touched in exactly two places, with two different bind identities:

- **Login** (`validators/ad.validator.ts`) binds with the user's own
  credentials — that bind _is_ the password check.
- **Periodic recheck** (`validators/ad-directory.checker.ts`, driven by
  `ad-recheck.service.ts`, invoked from inside `SessionGuard`) binds with a
  service account — no user password involved — every
  `AD_RECHECK_INTERVAL_MS` (15 min). If the DC is unreachable it fails open
  for up to `AD_FAIL_OPEN_TTL_MS` (4h) before denying.

`AUTH_VALIDATOR=fake` (dev/CI) swaps both of the above for in-memory/DB
fakes; the DI factories in `auth.module.ts` **throw at boot** if
`NODE_ENV=production` and `AUTH_VALIDATOR` isn't `ad` — production cannot
silently start with fake auth.

Break-glass: users with `origem=LOCAL` (see `prisma/schema.prisma`) never
touch the AD at all, at login or recheck — `local.validator.ts` checks an
argon2 hash in Postgres. This is the only way in in the event the AD is down
at login time.

### Authorization

The RBAC matrix lives in code, not the database:
`src/modules/auth/permissions.ts` — `MATRIZ_PERMISSOES` is a
`satisfies Record<Papel, readonly Permissao[]>`, so a typo or a missing role
fails to compile. `PermissionGuard` reads `@RequirePermission(...)` metadata
and is fail-closed (no user or no match → 403). AD group membership maps to
`Papel` via the pure, unit-tested function in `grupos-para-papeis.ts`
(contract: AD groups are named `TITULA_<PAPEL>`).

### HTTP contract

Global prefix `api` + URI versioning (`/api/v1/...`), set in
`src/configure-app.ts` — shared between `main.ts` and the e2e bootstrap
deliberately, so they can't drift apart. Routes that must survive version
bumps (`/api/health`) use `VERSION_NEUTRAL`. Every response DTO uses
`@ZodResponse` (nestjs-zod): one annotation drives the TS type, the runtime
serialization (strips fields not in the schema), and the OpenAPI doc. Every
error funnels through `ProblemDetailsFilter`
(`src/common/problem-details.filter.ts`) into RFC 7807 — throw a Nest
`HttpException`/subclass rather than adding a route-local exception filter.

### CI/CD

- `.github/workflows/ci.yml`: 5 jobs on every push/PR to `main` — lint,
  typecheck+build, unit tests, e2e (real Postgres+PostGIS service
  container), and `docker-image` (builds the production image and boots a
  real container to hit `/api/health`).
- `.github/workflows/cd.yml`: deploys automatically via `workflow_run` when
  CI succeeds on `main` (also accepts `workflow_dispatch` for manual runs).
  Runs on a **self-hosted runner inside the government intranet** — the
  only way to reach the production Postgres and the AD over LDAPS.
  Sequence: snapshot the current image (keeps 2 rollback generations,
  `:rollback` + `:rollback-2`) → build → `prisma migrate deploy` →
  `docker compose up` → health check → automatic rollback to `:rollback` if
  the health check fails.
- Full manual runbook, server prerequisites, and the secrets checklist:
  `docs/DEPLOY.md`.

## Conventions worth knowing before editing

- Comments explain **why**, not what. Match that density and voice when
  touching a file that already has it — especially `prisma/schema.prisma`,
  `auth.module.ts`, and `session.service.ts`.
- Commit to a branch, never directly to `main`. PRs are squash-merged (the
  PR title becomes the commit message, and is lint-checked by
  `pr-title.yml` against Conventional Commits).
- A backtick inside a `git commit -m "..."` double-quoted string gets
  shell-substituted before it reaches git. Use `git commit -F <file>` for
  any message that needs inline code.
