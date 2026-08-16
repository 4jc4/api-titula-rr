# Runbook de deploy

Checklist para subir o `api-titula-rr` no app server (`20.50.2.223`), contra o
Postgres do LXC (`20.50.2.224`).

> **CD automático desde 16/08/2026.** Todo push aprovado pelo CI no `main`
> dispara sozinho o deploy em produção
> ([`cd.yml`](../.github/workflows/cd.yml), gatilho `workflow_run`), com
> rollback automático se o health check pós-deploy falhar (seção 5). Este
> runbook manual continua valendo para: a configuração inicial de um servidor
> novo (seção 1), o seed da conta break-glass (seção 3.3, que o CD não roda),
> um deploy fora do fluxo normal (`workflow_dispatch` no `cd.yml`, ou os
> passos abaixo à mão), e rollback além do que a automação cobre (seção 5).

A seção 1 é infraestrutura de uma vez só (ou quando algo muda). A seção 2 é
config/segredos — conferir a cada deploy, mesmo que raramente mude. A seção 3
é a sequência de deploy manual — o que o `cd.yml` automatiza a cada push no
`main`, útil de conhecer mesmo assim para rodar à mão quando precisar.

---

## 1. Pré-requisitos (uma vez só)

Confirme cada item antes do primeiro deploy. Pular um destes não quebra o
`docker compose up` — quebra silenciosamente depois, no pior momento.

- [ ] **Conta de serviço do AD criada pela TI**, com permissão de leitura em
      `memberOf` — vira `AD_BIND_DN`/`AD_BIND_PASSWORD`.
- [ ] **Grupos `TITULA_<PAPEL>` existem no AD**, exatamente com esse prefixo
      (contrato registrado em
      [`grupos-para-papeis.ts`](../src/modules/auth/grupos-para-papeis.ts)).
      Um grupo com nome errado não bloqueia login — só gera `warn` no log e
      ninguém daquele grupo recebe papel nenhum.
- [ ] **Rede Docker externa criada**, uma vez, fora do compose: `docker network create titula-rr-net`.
      É a mesma rede que o frontend usa — ver o comentário no
      [`docker-compose.yml`](../docker-compose.yml).
- [ ] **DNS/`extra_hosts` do EINSTEIN confirmado**: o compose fixa
      `EINSTEIN.intranet.iteraima.rr.gov.br` para `20.50.2.253` porque o
      container não tem IPv6 e o DNS público devolve 6to4. Se o IP do DC
      mudar, esse é o primeiro lugar a atualizar.
- [ ] **`certs/ad-ldaps.pem`** é a CA corporativa correta e ainda válida (o
      commit que a introduziu registra validade até 2036 — confirmar que não
      houve renovação/rotação da CA desde então).

---

## 2. Segredos

- [ ] **Rotacionar a senha do Postgres de produção.** Ela circulou em texto
      puro num arquivo de notas fora do repositório — trocar antes do
      primeiro deploy pós-diagnóstico, não depois. Atualizar `DATABASE_URL`
      no `.env` do servidor com a senha nova.
- [ ] **Preparar o `.env` real no servidor** (`20.50.2.223`, ao lado do
      `docker-compose.yml` — é o que `env_file: .env` do compose lê). Nunca
      commitado; usar [`.env.example`](../.env.example) como molde. Mínimo
      para produção:

| Variável                         | Valor em produção                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                       | `production` (a imagem já assume isso — não precisa declarar)                                                                                                                       |
| `DATABASE_URL`                   | string de conexão real, com a senha **rotacionada**                                                                                                                                 |
| `AUTH_VALIDATOR`                 | `ad` — **obrigatório**; com `fake` a app recusa subir (trava em [`auth.module.ts`](../src/modules/auth/auth.module.ts))                                                             |
| `AD_URL`                         | `ldaps://<FQDN-do-DC>` — FQDN, nunca IP (o certificado valida o nome)                                                                                                               |
| `AD_BASE_DN`, `AD_UPN_SUFFIX`    | conforme o domínio                                                                                                                                                                  |
| `AD_BIND_DN`, `AD_BIND_PASSWORD` | conta de serviço da seção 1                                                                                                                                                         |
| `AD_CA_PATH`                     | `certs/ad-ldaps.pem` (já embutido na imagem pelo Dockerfile)                                                                                                                        |
| `BREAK_GLASS_USER`               | ex.: `resgate.local`                                                                                                                                                                |
| `BREAK_GLASS_PASSWORD`           | senha forte, ≥16 caracteres — gerar com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`, guardar em cofre de senhas, nunca reutilizar no dia a dia |
| `CORS_ORIGIN`                    | **deixar ausente** — o Nginx serve API e front na mesma origem                                                                                                                      |

`PORT` não precisa ser definido (default 3000, e é o que o
`docker-compose.yml` espera).

---

## 3. Deploy

> O CD automático cobre 3.1 e 3.4 a cada push aprovado no `main`
> (`docker compose build`, `up -d`, health check com rollback) — **mas não
> 3.2**. O `cd.yml` não roda `prisma migrate deploy`; ver a pendência
> registrada no fim deste documento. Até isso ser resolvido, um push com
> migração pendente exige rodar 3.2 à mão, no servidor, antes (ou logo
> depois) do CD subir a imagem nova.

### 3.1 Build

```sh
cd /caminho/no/servidor/api-titula-rr
git pull
docker compose build
```

### 3.2 Migração — SEMPRE antes do `up`

```sh
docker compose run --rm api npx prisma migrate deploy
```

Roda dentro de um container temporário, com o `DATABASE_URL` do `.env`. Se
esse passo falhar, **não rode o `up`** — resolver a migração primeiro.

Verificado na prática (não só lido no comentário do Dockerfile) que o
`prisma` CLI funciona dentro da imagem final: `package.json` o lista em
`devDependencies`, mas ele sobrevive ao `npm prune --omit=dev` do Dockerfile
por uma dependência transitiva de `@prisma/client`/`@prisma/adapter-pg`. O
`tsx` da seção 3.3 **não** tem essa sorte — daí o passo seguinte ser
diferente.

### 3.3 Break-glass — só no primeiro deploy, ou pra trocar a senha

**Não roda dentro do container de produção.** `tsx` é `devDependency` — some
da imagem no `npm prune --omit=dev` do Dockerfile — e `prisma/seed.ts` fica
fora de `src/`, então `nest build` nunca o compila para `dist/`.
`docker compose run api npx tsx prisma/seed.ts` falharia (`tsx` não existe
ali dentro).

Rodar de um checkout completo (com devDependencies) que alcance o Postgres de
produção na rede — o próprio app server serve, já que é de lá que o container
acessa `20.50.2.224:5432`:

```sh
git clone <repo> /tmp/seed-run && cd /tmp/seed-run
npm ci
DATABASE_URL="<a mesma do .env de produção>" \
BREAK_GLASS_USER="<...>" \
BREAK_GLASS_PASSWORD="<...>" \
npx tsx prisma/seed.ts
rm -rf /tmp/seed-run
```

Sem isso, se o AD cair antes desse passo ter rodado alguma vez, não existe
nenhuma porta de entrada no sistema. Não precisa repetir todo deploy — só
quando a senha break-glass precisar trocar.

### 3.4 Subir

```sh
docker compose up -d
```

---

## 4. Verificação pós-deploy

- [ ] **Health responde `ok`** — `curl -s https://<host>/api/health | jq`.
      Espera-se `"status":"ok"`, `"database":"connected"`,
      `"directory":"reachable"`. Um `503` aqui (desde o PR #8) já significa
      banco inacessível — não esperar o Zabbix avisar.
- [ ] **Login break-glass funciona** (prova que a conta de emergência está
      viva, sem depender do AD):

```sh
curl -i -c /tmp/bg.txt -X POST https://<host>/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<BREAK_GLASS_USER>","password":"<BREAK_GLASS_PASSWORD>"}'
```

      Esperado: `200`, cookie `HttpOnly; Secure; SameSite=Strict`. Se o
      cookie não vier com `Secure`, o Nginx não está terminando TLS
      corretamente na frente da API — login por navegador vai falhar
      silenciosamente (o browser descarta cookie `Secure` sobre HTTP puro).

- [ ] **Login real via AD funciona**, com um usuário de teste que tenha grupo
      `TITULA_*`.
- [ ] **`docker compose ps`** mostra o container `healthy` (não só
      `running`) depois do `start_period` de 20s.
- [ ] **Logs sem erro inesperado** — `docker compose logs -f api`.

---

## 5. Rollback

**Automático (1 nível):** se o health check do `cd.yml` falhar logo após um
deploy, o próprio CD reverte sozinho — retagueia `titula-rr-api:rollback`
(snapshot tirado da imagem em produção, antes do build) de volta para
`:local`, sobe o container de novo e reconfere o health check. Não precisa
fazer nada; o job só fica marcado como falho para avisar que a versão nova
não foi ao ar.

**Manual, 2º nível:** o CD mantém duas gerações — `:rollback` (a imagem
imediatamente anterior) e `:rollback-2` (a anterior a essa). Se o rollback
automático também não subir saudável, ou se dois deploys ruins tiverem se
sucedido antes de alguém notar, dá pra voltar mais um nível à mão, direto no
app server:

```sh
cd /opt/titula-rr/api
docker tag titula-rr-api:rollback-2 titula-rr-api:local
docker compose up -d --no-deps api
curl -s http://127.0.0.1:3000/api/health | jq
```

**Manual, além de 2 níveis:** a partir daí não tem mais tag guardada — volta
pelo git mesmo:

```sh
docker compose down
git checkout <commit-anterior>
docker compose build
docker compose up -d
```

Migrações do Prisma não têm `down` automático neste projeto — uma migração
que precise ser desfeita é uma migração nova escrita à mão, não um
`prisma migrate reset` em produção (isso apaga o banco).

---

## 6. Pendências conhecidas

Registradas aqui para não se perderem, não porque são urgentes.

- [ ] **`cd.yml` não roda `prisma migrate deploy`.** Achado escrevendo este
      runbook (16/08/2026): o deploy automático builda e sobe a imagem nova,
      mas nunca migra o banco — diferente do runbook manual (seção 3.2),
      onde migrar **sempre** vem antes do `up`. Hoje isso é inofensivo porque
      nenhuma migração ficou pendente nos últimos deploys, mas o próximo PR
      que adicionar uma migração real vai subir código novo contra schema
      velho. Corrigir adicionando um passo `docker compose run --rm api npx
    prisma migrate deploy` em [`cd.yml`](../.github/workflows/cd.yml),
      entre "Build and deploy" e "Health check".

- [ ] **Nginx (`20.50.2.213`) duplica headers de segurança que o `helmet()`
      da API já envia.** Confirmado com `curl -i` direto em produção em
      16/08/2026 — a resposta trazia, cada um **duas vezes**:

  | Header                      | Valor do Helmet (API)                 | Valor do Nginx                                                |
  | --------------------------- | ------------------------------------- | ------------------------------------------------------------- |
  | `x-frame-options`           | `SAMEORIGIN`                          | `SAMEORIGIN` (igual, redundante)                              |
  | `x-content-type-options`    | `nosniff`                             | `nosniff` (igual, redundante)                                 |
  | `referrer-policy`           | `no-referrer`                         | `strict-origin-when-cross-origin` (**diferente**)             |
  | `strict-transport-security` | `max-age=31536000; includeSubDomains` | `max-age=15768000` (**diferente, e sem `includeSubDomains`**) |

  As duas últimas linhas são o motivo para tratar isto como bug, não só
  redundância: com o mesmo header repetido com valores diferentes, qual
  valor o navegador aplica é inconsistente entre eles — na prática, o Nginx
  está silenciosamente enfraquecendo o HSTS que a API pede (6 meses em vez
  de 1 ano, sem `includeSubDomains`) e trocando a política de referrer.
  Quando houver acesso a `20.50.2.213`: achar e remover, do vhost da API,
  as diretivas `add_header X-Frame-Options`, `add_header
X-Content-Type-Options`, `add_header Referrer-Policy` e `add_header
Strict-Transport-Security` (ou equivalentes) — deixar o `helmet()` ser a
  única fonte desses headers.

---

## Referência rápida

- Topologia e variáveis de rede: [`docker-compose.yml`](../docker-compose.yml)
- Build da imagem: [`Dockerfile`](../Dockerfile)
- Todas as variáveis de ambiente e suas regras:
  [`src/config/env.ts`](../src/config/env.ts)
- Este runbook é validado apenas manualmente — o CI (`docker-image` job em
  [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) builda e sobe a
  mesma imagem a cada PR, mas contra um AD e um `AUTH_VALIDATOR` falsos; não
  substitui a verificação da seção 4 num deploy real.
