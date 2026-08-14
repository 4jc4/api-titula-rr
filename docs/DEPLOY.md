# Runbook de deploy manual

Checklist para subir o `api-titula-rr` no app server (`20.50.2.223`), contra o
Postgres do LXC (`20.50.2.224`). Sem CD automatizado — todo passo aqui é
manual, nesta ordem.

A seção 1 é infraestrutura de uma vez só (ou quando algo muda). A seção 2 é
config/segredos — conferir a cada deploy, mesmo que raramente mude. A seção 3
é a sequência que roda **todo deploy**, sem exceção.

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

## Referência rápida

- Topologia e variáveis de rede: [`docker-compose.yml`](../docker-compose.yml)
- Build da imagem: [`Dockerfile`](../Dockerfile)
- Todas as variáveis de ambiente e suas regras:
  [`src/config/env.ts`](../src/config/env.ts)
- Este runbook é validado apenas manualmente — o CI (`docker-image` job em
  [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) builda e sobe a
  mesma imagem a cada PR, mas contra um AD e um `AUTH_VALIDATOR` falsos; não
  substitui a verificação da seção 4 num deploy real.
