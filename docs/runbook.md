# Runbook

Procedimentos de operação: o que fazer depois do deploy, quando algo quebra, e
nas tarefas que não são código. Para as máquinas, ver
[`infrastructure.md`](./infrastructure.md); para como o código sobe,
[`deployment.md`](./deployment.md).

## Verificação pós-deploy

- [ ] **Health responde `ok`** — `curl -s https://<host>/api/health | jq`.
      Esperado: `"status":"ok"`, `"database":"connected"`,
      `"directory":"reachable"`. Um `503` aqui já significa banco inacessível —
      não espere o Zabbix avisar.
- [ ] **Login break-glass funciona** — prova que a porta de emergência está
      viva, sem depender do AD:

  ```sh
  curl -i -c /tmp/bg.txt -X POST https://<host>/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"<BREAK_GLASS_USER>","password":"<BREAK_GLASS_PASSWORD>"}'
  ```

  Esperado: `200` e cookie `HttpOnly; Secure; SameSite=Strict`. **Se o cookie
  não vier com `Secure`**, o Nginx não está terminando TLS corretamente na
  frente da API — e o login pelo navegador vai falhar silenciosamente, porque o
  browser descarta cookie `Secure` sobre HTTP puro.

- [ ] **Login real via AD** com um usuário que tenha grupo `TITULA_*`.
- [ ] **`docker compose ps`** mostra `healthy`, não só `running`, depois do
      `start_period` de 20s.
- [ ] **Logs sem erro inesperado** — `docker compose logs -f api`.

Apague o `/tmp/bg.txt` depois: é um cookie de sessão válido.

## Rollback

**Automático (1º nível).** Se o health check falhar logo após o deploy, o
próprio CD reverte: retagueia `:rollback` para `:local`, sobe e reconfere. Não
há nada a fazer — o job fica marcado como falho de propósito, para avisar que a
versão nova não foi ao ar.

**Manual (2º nível).** O CD guarda duas gerações. Se o rollback automático
também não subir saudável, ou se dois deploys ruins se sucederam antes de
alguém notar:

```sh
cd /opt/titula-rr/api
docker tag titula-rr-api:rollback-2 titula-rr-api:local
docker compose up -d --no-deps api
curl -s http://127.0.0.1:3000/api/health | jq
```

**Além de dois níveis.** Não há mais tag guardada — volta pelo git:

```sh
cd /opt/titula-rr/api
docker compose down
git checkout <commit-anterior>
docker compose build
docker compose up -d
```

**Migrações não voltam.** Não há `down` automático neste projeto. Uma migração
que precise ser desfeita é uma migração nova, escrita à mão — nunca
`prisma migrate reset` em produção, que apaga o banco. Se o schema já mudou e o
rollback da imagem não basta, o caminho é restaurar o backup (abaixo).

## Break-glass

A conta `origem=LOCAL` é a única entrada quando o AD está fora no momento do
login. Ela não expira e não depende do DC.

**Semear ou trocar a senha.** Não roda dentro do container de produção: `tsx` é
`devDependency` e some no `npm prune --omit=dev`, e `prisma/seed.ts` fica fora
de `src/`, então o `nest build` nunca o compila. Rode de um checkout completo
que alcance o Postgres — o próprio app server serve:

```sh
git clone <repo> /tmp/seed-run && cd /tmp/seed-run
npm ci
DATABASE_URL="<a mesma do .env de produção>" \
BREAK_GLASS_USER="<...>" \
BREAK_GLASS_PASSWORD="<...>" \
npx tsx prisma/seed.ts
rm -rf /tmp/seed-run
```

Sem isso rodado **pelo menos uma vez**, se o AD cair não existe porta de entrada
nenhuma. Não precisa repetir a cada deploy — só quando a senha mudar.

## Derrubar as sessões de um usuário

Desligamento, conta comprometida, mudança punitiva de grupo. Com uma sessão de
`administrador`:

```sh
curl -s -X POST https://<host>/api/v1/admin/usuarios/<userId>/revogar-sessoes \
  -b /tmp/admin.txt | jq
```

A revogação vale **no request seguinte** do alvo — não há janela de token. O
`userId` sai de `GET /api/v1/admin/usuarios`.

Se o motivo for desligamento, o caminho definitivo é o AD: desabilitar a conta
lá faz o recheck (até 15 min) revogar as sessões sozinho e marcar
`isActive=false`.

## Backup e restauração

Roda sozinho às 02:00 UTC no LXC do banco, por systemd timer. `Persistent=true`
cobre o container estar desligado na hora.

**Rodar sob demanda** — antes de um merge que mexe em schema, por exemplo:

```sh
sudo systemctl start pg-backup.service
sudo ls -la /var/backups/postgres/
```

**Conferir que o timer está armado:**

```sh
systemctl list-timers pg-backup.timer --no-pager
```

**Testar a restauração** (refazer a cada mudança de versão do Postgres ou do
PostGIS — um backup não testado não é um backup):

```sh
sudo -u postgres createdb titularr_restore_test
sudo -u postgres pg_restore -d titularr_restore_test \
  /var/backups/postgres/titularr-$(date -u +%F).dump
sudo -u postgres psql -d titularr_restore_test -tAc \
  "select 'extensoes: ' || string_agg(extname, ', ') from pg_extension"
sudo -u postgres dropdb titularr_restore_test
```

Esperado: `extensoes: plpgsql, btree_gist, postgis`. O dump carrega a extensão
junto — mas um destino **sem o pacote** `postgresql-16-postgis-3` instalado não
restaura este arquivo.

**Restaurar de verdade**, com a API parada:

```sh
# no app server
cd /opt/titula-rr/api && docker compose stop api

# no LXC do banco
sudo -u postgres dropdb titularr
sudo -u postgres createdb -O titularr_app titularr
sudo -u postgres pg_restore -d titularr /var/backups/postgres/titularr-<data>.dump

# de volta ao app server
docker compose start api && curl -s http://127.0.0.1:3000/api/health | jq
```

O `pg_dumpall --globals-only` do mesmo dia existe para o caso de o papel
`titularr_app` também precisar ser recriado.

Limite conhecido: os arquivos ficam no mesmo disco do banco. Cobrem erro humano
e corrupção lógica, **não** a perda do LXC — para isso, backup do Proxmox
(container 113) ou cópia noturna para outro host.

## Quando o AD cai

Não é incidente de aplicação. O comportamento esperado:

| Situação                                          | O que acontece                                         |
| ------------------------------------------------- | ------------------------------------------------------ |
| Sessão ativa, dentro de 4 h da última verificação | continua funcionando; log em `warn`                    |
| Sessão ativa, além de 4 h                         | passa a negar; log em `error`                          |
| Login novo pelo AD                                | `503` — indisponibilidade, não credencial inválida     |
| Login break-glass                                 | funciona normalmente                                   |
| `/api/health`                                     | `status: degraded`, `directory: unreachable`, HTTP 200 |

`degraded` fica em 200 de propósito: sessões ativas e break-glass continuam, e
não é motivo para reiniciar o container. Só `down` (banco inacessível) devolve 503.

## Diagnóstico rápido

| Sintoma                                       | Causa provável                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `P1000: authentication failed` em dev         | outro Postgres na porta. O compose pode subir "Healthy" sem publicar a porta — pare o outro container e **recrie** (`down` e `up`), não reinicie |
| `directory: unreachable` no health            | DC fora, DNS/IPv6 do EINSTEIN, ou CA trocada                                                                                                     |
| Login por navegador falha, mas o `curl` passa | cookie `Secure` descartado: TLS não está terminando no Nginx                                                                                     |
| `Can't reach database server at base`         | `docker run --env-file` com aspas na `DATABASE_URL` — use `docker compose run`                                                                   |
| Erro 500 com `reqId`                          | `docker compose logs api \| grep <reqId>` — o erro completo está lá, e só lá                                                                     |
| `permission denied to create extension`       | as extensões não estão criadas e o papel da app não é superusuário — ver `infrastructure.md`                                                     |

Todo erro da API traz um `reqId` no corpo. Peça-o ao usuário: é a chave que
liga o que ele viu ao que o log guardou.

## Pendências conhecidas

Registradas aqui para não se perderem, não porque são urgentes.

- [ ] **O Nginx duplica headers de segurança que o `helmet()` já envia**,
      confirmado com `curl -i` em 16/08/2026. Dois deles vêm com valores
      diferentes, e aí qual o navegador aplica é inconsistente:

  | Header                      | Helmet (API)                          | Nginx                                             |
  | --------------------------- | ------------------------------------- | ------------------------------------------------- |
  | `x-frame-options`           | `SAMEORIGIN`                          | `SAMEORIGIN` (redundante)                         |
  | `x-content-type-options`    | `nosniff`                             | `nosniff` (redundante)                            |
  | `referrer-policy`           | `no-referrer`                         | `strict-origin-when-cross-origin` (**diferente**) |
  | `strict-transport-security` | `max-age=31536000; includeSubDomains` | `max-age=15768000` (**mais fraco**)               |

  Na prática o Nginx está enfraquecendo o HSTS que a API pede. Quando houver
  acesso a `20.50.2.213`: remover do vhost os `add_header` correspondentes e
  deixar o `helmet()` ser a fonte única.

- [ ] **Rotacionar a senha do Postgres de produção** — ver
      [`deployment.md`](./deployment.md).

- [ ] **Três testes da Fase D nunca executados** — os que exigem comandos no DC
      (trocar grupos `TITULA_*`, `Disable-ADAccount`). São exatamente os que
      provam a revogação por decisão do AD; hoje esse caminho está coberto só
      por mock.
