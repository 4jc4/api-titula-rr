# Infraestrutura

As máquinas onde o `api-titula-rr` roda, e o que cada uma precisa ter. Tudo
dentro da intranet `intranet.iteraima.rr.gov.br` — nenhum componente em nuvem
pública.

Levantado e conferido em 31/08/2026. Onde este documento diverge da máquina, a
máquina tem razão: confira antes de agir.

## Topologia

| Host                                  | Papel                                          |
| ------------------------------------- | ---------------------------------------------- |
| `20.50.2.223`                         | App server — container `titula-rr-api`         |
| `20.50.2.224`                         | LXC do banco — PostgreSQL 16 + PostGIS         |
| `20.50.2.213`                         | Nginx — TLS e vhost público da API e do front  |
| `20.50.2.253` (`EINSTEIN`)            | Controlador de domínio — AD e LDAPS            |
| runner self-hosted (`titula-rr-prod`) | Executa o CD; é o único que alcança banco e AD |

```
navegador → Nginx (20.50.2.213) → :3000 do app server (20.50.2.223)
                                        ├── LDAPS 636 → EINSTEIN (20.50.2.253)
                                        └── 5432     → LXC do banco (20.50.2.224)
```

## App server — `20.50.2.223`

- Deploy em `/opt/titula-rr/api`: clone autocontido com `Dockerfile`,
  `docker-compose.yml` e o `.env` (`chmod 600`, nunca versionado).
- Compose com `name: titula-rr-api`, publicando `3000:3000`.
- Rede Docker **externa** `titula-rr-net`, criada uma vez fora do compose
  (`docker network create titula-rr-net`) e compartilhada com o frontend. Hoje
  API e web não conversam entre si — o navegador fala com o Nginx, que fala com
  cada um —, mas se o Next passar a buscar dados em server component, alcança a
  API por `http://titula-rr-api:3000/api/v1/...` sem reorganizar nada.
- `extra_hosts` fixa `EINSTEIN.intranet.iteraima.rr.gov.br` em `20.50.2.253`: o
  DNS do domínio devolve IPv6 6to4 para o DC, o container não tem IPv6, e o
  LDAPS falharia. O FQDN é obrigatório — o certificado valida o nome, não o IP.
  **Se o IP do DC mudar, é o primeiro lugar a atualizar.**
- Logs em `json-file` com rotação (`max-size: 10m`, `max-file: 5`).
- **Os diretórios de deploy pertencem ao grupo `titula-deploy`, com escrita de
  grupo e `setgid`** (`drwxrwsr-x nti titula-deploy`). O runner roda como
  `gh-runner`, que é membro desse grupo; o `setgid` faz todo arquivo novo
  herdar o grupo, senão o próximo deploy encontra arquivos que ele mesmo não
  consegue substituir. `/opt/titula-rr/web` ficou fora dessa convenção até
  01/09/2026 e o CD do frontend falhava no `rsync` com `Permission denied` —
  se um deploy quebrar assim, é aqui que se olha primeiro.
- `.env` em `640` (`nti:titula-deploy`), nunca legível por outros usuários da
  máquina.

## Banco — LXC `20.50.2.224`

| Item         | Estado                                                                          |
| ------------ | ------------------------------------------------------------------------------- |
| Sistema      | Ubuntu 24.04 LTS · 2 vCPU · 2 GB RAM · 20 GB (17 GB livres)                     |
| PostgreSQL   | 16.13 (`16.13-0ubuntu0.24.04.1`), cluster `16/main` em `/data/postgres/16/main` |
| PostGIS      | 3.4.2 (`postgresql-16-postgis-3`), criado no banco `titularr`                   |
| `btree_gist` | criado em 31/08/2026 — vem no próprio pacote `postgresql-16`, sem contrib       |
| Banco        | `titularr`, UTF8 com ICU `pt-BR`, dono `titularr_app`                           |
| Papéis       | `postgres` (superusuário) e `titularr_app` — **sem** atributos, como deve ser   |
| `timezone`   | `Etc/UTC`                                                                       |
| Acesso       | uma linha no `pg_hba.conf` (abaixo)                                             |

```
host    titularr    titularr_app    20.50.2.223/32    scram-sha-256
```

Replicação restrita ao loopback; `listen_addresses = *` não incomoda porque o
portão de verdade é o `pg_hba`. A conexão é `host`, não `hostssl`: o tráfego
entre app server e banco atravessa a VLAN em claro. O scram não expõe a senha,
mas os dados das consultas sim — decisão consciente numa rede privada, revisível
com certificado no cluster e `sslmode=require` na URL.

### As extensões precisam existir antes do primeiro deploy

A migração do núcleo processual declara `postgis` e `btree_gist` com
`IF NOT EXISTS`, mas `CREATE EXTENSION postgis` **exige superusuário** — PostGIS
não é uma extensão _trusted_ — e `titularr_app` não é um, nem deve ser. Com as
duas já criadas (é o caso desde 31/08/2026), as linhas viram no-op e o
`migrate deploy` passa com o papel comum.

Se algum dia for preciso recriar o ambiente:

```bash
apt-get install -y postgresql-16-postgis-3 postgresql-16-postgis-3-scripts
sudo -u postgres psql -d titularr \
  -c "CREATE EXTENSION IF NOT EXISTS postgis" \
  -c "CREATE EXTENSION IF NOT EXISTS btree_gist"
```

### Backup

`pg_dump` diário às 02:00 UTC por systemd timer. Os procedimentos — rodar sob
demanda, restaurar, testar — estão no [`runbook.md`](./runbook.md).

## Active Directory — `EINSTEIN` (`20.50.2.253`)

- **LDAPS na 636**, já ativo sem configuração adicional no DC. O certificado é
  o wildcard `*.intranet.iteraima.rr.gov.br` (vence 28/05/2028), emitido pela CA
  corporativa `intranet-EINSTEIN-CA` (vence 18/05/2036).
- `certs/ad-ldaps.pem` no repositório é a **raiz da CA**, não um certificado
  autoassinado — é ela que o pinning valida. Renovação ou rotação da CA exige
  atualizar esse arquivo.
- O wildcard **não renova sozinho** (o template `WebServer` do AD CS não tem
  auto-inscrição e o subject vai na requisição), e vale em dois lugares: o
  Nginx do proxy e o store do DC. O workflow `Invariantes de produção` falha
  quando restarem menos de 45 dias — é o único aviso que existe.
- **Grupos `TITULA_<PAPEL>`** em `OU=Aplicacoes` (o domínio não tinha OU de
  grupos; o precedente eram as OUs `internet` e `Openfire`). Contrato registrado
  em [`grupos-para-papeis.ts`](../src/modules/auth/grupos-para-papeis.ts): mudou
  o nome lá, muda ali. Um grupo com nome errado não bloqueia login — gera `warn`
  e ninguém daquele grupo recebe papel.
  - `cidadao` **não tem grupo**: vem do `PessoaAcesso` (gov.br).
  - Pendente com a TI: criar `TITULA_SERVICOS_FUNDIARIOS`, `TITULA_NOTIFICACAO`
    e `TITULA_PRESIDENTE`; remover `TITULA_COLABORADOR` e `TITULA_INFORMATICA`
    depois de migrar quem estiver neles.
- **Conta de serviço `svc-titula`** em `OU=Aplicacoes` (UPN
  `svc-titula@intranet.iteraima.rr.gov.br`, sem grupos, `PasswordNeverExpires`),
  usada só na reverificação. Senha no cofre da TI e em `AD_BIND_PASSWORD`.
- No macOS, o FQDN do DC pode não resolver pelo `getaddrinfo` mesmo com
  `nslookup` funcionando — usar `/etc/hosts` ou `/etc/resolver/<domínio>`.

## Nginx — `20.50.2.213`

Termina TLS e roteia `/api` para o app server. Como a aplicação responde no
mesmo path que o cliente pede (prefixo `api` embutido), o `proxy_pass` fica
**sem barra final** — nenhuma reescrita, o que evita a classe de bug do
incidente do `regulariza`.

Dois cuidados:

- O cookie de sessão é `Secure` em produção. Se o Nginx não estiver terminando
  TLS corretamente, o navegador descarta o cookie e o login falha
  silenciosamente.
- **Headers de segurança:** o snippet `snippets/security-headers.conf` é
  compartilhado com GLPI, Portainer e SSI. No vhost do titula ele fica **dentro
  do `location /`**, não no nível `server`. Assim o frontend Next — que não
  emite esses headers sozinho — continua coberto pelo Nginx, enquanto em
  `/api/` o `helmet()` é a fonte única. Não mova o include de volta para o
  `server`: o `/api/` passa a herdá-lo e os headers voltam a duplicar. Também
  não edite o snippet para "corrigir" os valores — ele serve três sistemas que
  não têm `helmet()` para repor nada.

## Runner de CI/CD

O CD roda num runner **self-hosted** com os labels `self-hosted` e
`titula-rr-prod`, dentro da intranet — é o único que alcança o Postgres de
produção e o AD via LDAPS. O CI (lint, typecheck, testes, imagem) roda em
runners hospedados do GitHub, porque não precisa de nada da rede interna.

## Portas

| Origem             | Destino             | Porta | Para quê                    |
| ------------------ | ------------------- | ----- | --------------------------- |
| navegador          | Nginx `20.50.2.213` | 443   | HTTPS                       |
| Nginx              | app server          | 3000  | proxy para a API            |
| app server         | LXC do banco        | 5432  | PostgreSQL (scram, sem TLS) |
| app server         | `EINSTEIN`          | 636   | LDAPS                       |
| Zabbix/monitoração | app server          | 3000  | `GET /api/health`           |

Em desenvolvimento o Postgres local publica na **5433** do host — a máquina de
desenvolvimento roda o banco de mais de um projeto, e porta por projeto evita o
revezamento. Ver o comentário no `docker-compose.dev.yml`.
