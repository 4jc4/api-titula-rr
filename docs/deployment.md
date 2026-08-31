# Deploy

Como o código chega em produção. Para as máquinas, ver
[`infrastructure.md`](./infrastructure.md); para o que fazer quando algo dá
errado depois, [`runbook.md`](./runbook.md).

**Desde 16/08/2026 o deploy é automático.** Todo push aprovado pelo CI no
`main` dispara o CD. As instruções manuais da seção 4 continuam valendo para o
primeiro deploy de um servidor novo, para depuração direto na máquina, e para
`workflow_dispatch`.

## 1. Integração contínua

[`ci.yml`](../.github/workflows/ci.yml) roda em todo push e PR para o `main`,
em cinco jobs:

| Job                   | O que faz                                                                            |
| --------------------- | ------------------------------------------------------------------------------------ |
| `lint`                | `eslint --max-warnings=0` (sem `--fix`: o lint-staged já corrigiu o que dava)        |
| `typecheck-and-build` | `tsc --noEmit` e `nest build`                                                        |
| `unit-tests`          | os `*.spec.ts` de `src/`                                                             |
| `e2e-tests`           | as cinco suítes contra `imresamu/postgis:16-3.4` de serviço, na porta 5433           |
| `docker-image`        | builda a **imagem de produção** de verdade, sobe o container e bate em `/api/health` |

O `docker-image` é o que mais paga: um `CMD` errado no Dockerfile quebra ali, e
não em produção. Ele sobe com `NODE_ENV=production` e uma config de AD falsa mas
válida (`dc.example.invalid`, domínio reservado pela RFC 2606) — porque a app
**recusa subir** em produção sem `AUTH_VALIDATOR=ad`.

O título do PR é validado à parte, contra Conventional Commits
([`pr-title.yml`](../.github/workflows/pr-title.yml)): PRs são squash-merged, e
o título vira a mensagem do commit no `main`.

## 2. Entrega contínua

[`cd.yml`](../.github/workflows/cd.yml) dispara por `workflow_run` quando o CI
termina com sucesso no `main`, num runner self-hosted dentro da intranet.
`workflow_dispatch` continua disponível para redeploy manual.

Sequência:

1. **Checkout do `head_sha`** que o CI aprovou — não do HEAD do `main` no
   momento em que o CD roda, que pode já ter avançado.
2. **Validação do ambiente**: diretório de deploy, `.env` presente, docker vivo.
3. **Sync** dos arquivos com `rsync --delete`, preservando `.env`, `.git/`,
   `node_modules/` e `dist/`.
4. **Snapshot**: `:rollback` vira `:rollback-2`, e a imagem em produção vira
   `:rollback`. Duas gerações.
5. **Build** da imagem.
6. **Migração** — `prisma migrate deploy`, **sempre antes do `up`**. O container
   antigo continua no ar enquanto isso roda: uma migração que falhe aqui para o
   job sem derrubar produção.
7. **`docker compose up -d --no-deps api`**.
8. **Health check** — até 30 tentativas em `/api/health`.
9. **Rollback automático** se o health check falhar: retagueia `:rollback` para
   `:local`, sobe de novo e reconfere. O job continua marcado como falho, porque
   a versão nova não foi ao ar.

> **O merge é o deploy.** É no merge que as migrações pendentes entram no banco
> de produção, sem ninguém assistindo. Antes de um merge que mexe em schema,
> vale disparar o backup à mão (ver [`runbook.md`](./runbook.md)) e ter um ponto
> de restauração de minutos atrás.

## 3. Antes do primeiro deploy

Conferir cada item. Pular um destes não quebra o `docker compose up` — quebra
silenciosamente depois, no pior momento. O detalhe de cada um está em
[`infrastructure.md`](./infrastructure.md).

- [ ] Conta de serviço do AD criada, com leitura em `memberOf`.
- [ ] Grupos `TITULA_<PAPEL>` existem no AD, exatamente com esse prefixo.
- [ ] Rede Docker externa criada: `docker network create titula-rr-net`.
- [ ] `extra_hosts` do EINSTEIN conferido (o IP do DC muda? é o primeiro lugar).
- [ ] `certs/ad-ldaps.pem` é a CA corporativa correta e ainda válida.
- [x] Extensões `postgis` e `btree_gist` criadas no banco (31/08/2026).
- [x] Backup diário ativo no LXC, com restauração testada (31/08/2026).

### Segredos

- [ ] **Rotacionar a senha do Postgres de produção.** Ela circulou em texto puro
      num arquivo de notas fora do repositório — trocar antes do próximo deploy,
      não depois, e atualizar a `DATABASE_URL` do `.env`.
- [ ] **`.env` no servidor**, ao lado do `docker-compose.yml` (é o que
      `env_file:` lê), `chmod 600`, nunca commitado. Molde em
      [`.env.example`](../.env.example).

| Variável                         | Valor em produção                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                       | `production` — já vem da imagem, não precisa declarar                                                                                    |
| `DATABASE_URL`                   | string real, com a senha rotacionada                                                                                                     |
| `AUTH_VALIDATOR`                 | `ad` — **obrigatório**; com `fake` a app recusa subir                                                                                    |
| `AD_URL`                         | `ldaps://<FQDN>` — FQDN, nunca IP                                                                                                        |
| `AD_BASE_DN`, `AD_UPN_SUFFIX`    | conforme o domínio                                                                                                                       |
| `AD_BIND_DN`, `AD_BIND_PASSWORD` | a conta de serviço `svc-titula`                                                                                                          |
| `AD_CA_PATH`                     | `certs/ad-ldaps.pem` (já embutido na imagem)                                                                                             |
| `BREAK_GLASS_USER`               | ex.: `resgate.local`                                                                                                                     |
| `BREAK_GLASS_PASSWORD`           | ≥16 caracteres, em cofre, nunca reutilizada — gerar com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CORS_ORIGIN`                    | **ausente** — Nginx serve API e front na mesma origem                                                                                    |

`PORT` não precisa ser definido (default 3000, que é o que o compose espera).

## 4. Deploy manual

Só fora do fluxo automático.

```sh
cd /opt/titula-rr/api
git pull
docker compose build
docker compose run --rm api npx prisma migrate deploy   # SEMPRE antes do up
docker compose up -d
```

Se a migração falhar, **não rode o `up`** — resolva a migração primeiro.

Detalhe verificado na prática, e não deduzido do Dockerfile: o `prisma` CLI
funciona dentro da imagem final. Ele está em `devDependencies`, mas sobrevive ao
`npm prune --omit=dev` por uma dependência transitiva de
`@prisma/client`/`@prisma/adapter-pg`. O `tsx` **não** tem essa sorte — por isso
o seed do break-glass não roda dentro do container (ver
[`runbook.md`](./runbook.md)).

### Duas armadilhas já pagas

- **Nunca `docker run --env-file`** com valores entre aspas: ele não as remove
  (ao contrário do `env_file` do compose) e a `DATABASE_URL` chega deformada. O
  erro típico é `Can't reach database server at base`. Use `docker compose run`.
- **O CMD é `node dist/src/main.js`**, não `dist/main.js`: como `prisma.config.ts`
  e `prisma/seed.ts` ficam na raiz, o `rootDir` efetivo é a raiz e o `dist`
  espelha a estrutura.

## 5. Verificação e rollback

Estão no [`runbook.md`](./runbook.md) — são procedimentos de operação, e a hora
de precisar deles raramente é a hora do deploy.
