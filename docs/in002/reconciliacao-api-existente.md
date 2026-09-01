# Reconciliação com a API existente

Leitura do repositório real em `/Users/cardoso/Projects/titula-rr/api-titula-rr` (branch `main`, HEAD `de1c920`) e confronto com o modelo de 29 entidades desenhado nas rodadas anteriores.

**Nada foi escrito no seu repositório.** Este documento lista o que muda no modelo para caber no projeto, e o que o projeto precisa ganhar. A convenção de nomes já foi decidida e aplicada; duas decisões no fim seguem abertas.

> **Nota de 31/08/2026.** Este é o texto original de 25/08, preservado como
> registro do raciocínio. Quase tudo o que ele pede foi feito desde então, e a
> seção 4 — riscos de ambiente — envelheceu mal: ela afirma que produção não
> tem PostGIS, e a verificação no próprio servidor mostrou que tem. Os blocos
> marcados **ATUALIZAÇÃO** dizem onde cada coisa parou; o quadro completo está
> em [`README.md`](./README.md).

---

## 1. O que já existe

Um projeto maduro, não um esqueleto. NestJS 11 ESM, Node ≥ 24, Prisma 7 com driver adapter (`@prisma/adapter-pg`), 2 models, 3 enums, 2 migrações, ~40 arquivos de código com testes unitários colocados e e2e contra Postgres real.

**Autenticação completa e em produção.** Sessão opaca (SHA-256 do token em `sessions.id`, cookie httpOnly), TTL deslizante de 8h com teto absoluto de 7 dias, dois guards globais em ordem (`SessionGuard` → `PermissionGuard`), fail-closed por padrão com `@Public()` como escape. AD via LDAPS em dois pontos com identidades distintas — bind do próprio usuário no login, conta de serviço `svc-titula` no recheck de 15 min com fail-open de 4h. Break-glass local com argon2 e CHECK no banco. `AUTH_VALIDATOR=fake` troca tudo por fakes, e as factories **lançam no boot** se `NODE_ENV=production` sem `ad`.

**RBAC em código**, exatamente como eu supunha: `MATRIZ_PERMISSOES` como `satisfies Record<Papel, readonly Permissao[]>` em `permissions.ts`, com `PERMISSOES_DISPONIVEIS` como fonte única. O comentário lá já reserva o lugar: _"as permissões de domínio (titulo:\*, processo:\*, ...) entram com os respectivos módulos — sempre adicionadas aqui primeiro"_.

**Contrato HTTP fechado.** Prefixo `api` + versionamento URI (`/api/v1`), `configureApp()` compartilhado entre `main.ts` e o e2e para não divergirem, `@ZodResponse` em toda resposta, `ProblemDetailsFilter` transformando tudo em RFC 7807, throttler global, helmet, pino com redact de cookie.

**CI/CD real.** Cinco jobs, e2e contra `imresamu/postgis:17-3.5`, imagem de produção construída e testada de verdade. CD em runner self-hosted na intranet, com `prisma migrate deploy`, health check e rollback automático em duas gerações.

`PrismaModule` é `@Global()` — os módulos novos não precisam importá-lo.

---

## 2. Divergências do que modelei

### 2.1 Convenção de nomes — DECIDIDA: camelCase

O schema real usa **o padrão do Prisma sem `@map` em campo**: tabelas via `@@map` (`users`, `sessions`), colunas em **camelCase**, que o Postgres guarda entre aspas — `"passwordHash"`, `"adVerifiedAt"`, `"absoluteExpiresAt"`, `"userId"`. Os tipos enum ficam em PascalCase: `"Papel"`, `"OrigemConta"`, `"MotivoRevogacao"`.

Eu havia modelado tudo em snake_case: tabelas `processo`, `documento_processo`; colunas `area_declarada_ha`, `data_ciencia_efetiva`; tipos enum `tipo_pessoa`, `fase_processo`.

O cabeçalho do seu schema define a convenção de idioma — _"domínio em português, infra técnica em inglês"_ — e nisso o modelo já está certo. O que diverge é o **caixa**.

Meu argumento original para snake_case foi o SQL cru do PostGIS. Ele enfraquece agora que vi o projeto: o raw SQL fica confinado ao `GeoService`, e `perimetro` é palavra única, que não precisa de aspas em nenhum dos dois padrões. O custo real do camelCase é menor do que eu estimei — restrito a colunas compostas dentro de um único arquivo.

**Decidido em 25/08/2026: seguir a casa.** Consistência num repositório de um desenvolvedor só vale mais que a economia de aspas em cinco consultas. Na prática: `@@map("processos")`, `@@map("pessoas")`, `@@map("imoveis")`, `@@map("documentos_processo")` — plural, em português — nenhum `@map` de campo, e tipos enum em PascalCase (`"TipoPessoa"`, `"FaseProcesso"`), como `"Papel"` e `"OrigemConta"`.

**Já aplicado** ao `schema.prisma`, à migração, ao seed e aos três scripts de verificação, com o resultado reconferido contra o banco: 29 models ↔ 29 tabelas, 23 enums ↔ 23 tipos.

O custo a conhecer: em `$queryRaw`, `"areaCalculadaHa"` sem aspas dá erro em tempo de execução, não de compilação. Mitigação já prevista — todo raw SQL mora no `GeoModule`, com testes e2e contra Postgres real, que é onde o erro apareceria.

### 2.2 O bloco `datasource` que escrevi estava errado — corrigido

O seu é minimalista de propósito:

```prisma
datasource db {
  provider = "postgresql"
}
```

A URL vem de `prisma.config.ts` via `env('DATABASE_URL')`, e o `PrismaService` monta o `PrismaPg` com ela. Eu acrescentei `url = env("DATABASE_URL")`, `previewFeatures = ["postgresqlExtensions"]` e `extensions = [postgis, btree_gist]`.

Os três saíram. O `url` é redundante e pode conflitar com o config. E o preview de extensões faria o Prisma **gerenciar** as extensões — enquanto a sua migração `20260729143053` já criou o PostGIS à mão, de propósito, com o comentário _"as tabelas de domínio com geometria virão depois"_. Ligar o preview agora geraria drift contra uma extensão que o Prisma não criou.

`btree_gist` entra como o PostGIS entrou: uma linha na migração escrita à mão.

### 2.3 `TIMESTAMP(3)` vs `timestamptz` — vale reabrir

Suas colunas de tempo usam o default do Prisma, `TIMESTAMP(3)`, **sem fuso**. Eu usei `@db.Timestamptz(6)` nas do domínio.

Para `sessions` isso é indiferente — TTL é aritmética de instantes e o Prisma sempre grava UTC. Para o domínio processual, não é. Roraima é UTC−4, e o cenário concreto:

> Um documento é juntado às 23h30 de 09/07 em Boa Vista. O Postgres guarda `2026-07-10 03:30` sem fuso. Qualquer `data_juntada::date` — num relatório, numa contagem de prazo, num filtro por dia — devolve **10/07**. O documento foi juntado no dia 9.

Com `timestamptz`, o cast respeita o fuso da sessão e devolve 09/07.

Isso alcança poucos campos, mas justamente os que carregam efeito jurídico: `dataCienciaEfetiva` (Art. 71, III), `expedidaEm`, `dataJuntada`, `enviadaEm`/`confirmadaEm`. Os prazos em si são `DATE` e não sofrem.

Duas saídas coerentes: manter `TIMESTAMP(3)` em tudo pela uniformidade e nunca fazer cast para data no SQL (só na aplicação, com fuso explícito), ou usar `timestamptz` no domínio e documentar por quê. **Recomendo a segunda** — a regra "nunca faça cast" é o tipo de disciplina que sobrevive dois meses.

### 2.4 As cinco colunas de servidor agora podem virar FK

`users.id` é `TEXT` com `@default(uuid(7))`. Minhas cinco colunas de servidor responsável (`juntadoPorId`, `servidorRecebId`, `criadoPorId`, `chefiaAprovouId`, `usuarioId`, mais `emitidoPorId` e `confirmadoPorId` do financeiro) foram deixadas como `TEXT` sem FK exatamente porque eu não sabia o tipo. Agora sei — são sete `ALTER TABLE ... REFERENCES "users"("id")`, e o modelo ganha integridade referencial onde hoje tem texto solto.

`ON DELETE` deve ser `SET NULL` ou `RESTRICT`, nunca `CASCADE`: apagar um servidor não pode apagar os autos que ele movimentou.

### 2.5 `Papel` ganha `cidadao`, e isso quebra a compilação de propósito

Adicionar `cidadao` ao enum `Papel` faz o `satisfies Record<Papel, readonly Permissao[]>` falhar até a matriz ganhar a linha. É o comportamento desejado — o próprio comentário do arquivo diz que o `administrador` enumera tudo explicitamente para que "permissão nova só entre nele por commit, nunca em silêncio".

Um ponto que só aparece lendo o código: `grupos-para-papeis.ts` tem como contrato que grupos do AD se chamam `TITULA_<PAPEL>`. O cidadão **não tem grupo no AD** — ele vem do `PessoaAcesso` (gov.br ou local). Então ou a função ganha uma exceção explícita para `cidadao`, ou o caminho do cidadão nunca a atravessa. A segunda é mais limpa: o `CidadaoCredentialValidator` atribui o papel diretamente, sem passar por grupos.

### 2.6 `users.cpf` e `pessoas.cpf` são coisas diferentes

Os dois são `UNIQUE`. Um servidor que também é interessado num processo existirá nas duas tabelas, com o mesmo CPF. Isso **não é duplicação a corrigir**: `users` é quem _opera_ o sistema (identidade do AD, sessão, papel); `pessoas` é quem _é parte_ no processo (qualificação, endereço, declarações). Fundi-las ligaria o ciclo de vida de uma conta de rede ao de um requerente — e o requerente não tem conta de rede.

Vale registrar isso no schema, senão alguém "conserta" daqui a um ano.

### 2.7 A migração precisa seguir o padrão da casa

Sua segunda migração foi criada com `--create-only` (o arquivo começa com `-- This is an empty migration.`) e preenchida à mão. É exatamente o padrão para o que eu produzi. O caminho:

1. `npx prisma migrate dev --name in002_nucleo_processual --create-only`
2. Substituir o SQL gerado pelo da migração validada, mantendo os blocos que o Prisma criou para tabelas e enums e acrescentando extensões, geometria, coluna gerada, EXCLUDE, índices parciais e funções.

Se eu emitir uma migração inteira escrita à mão, o Prisma vai considerar o schema fora de sincronia na próxima vez. Melhor gerar e editar.

---

## 3. O que o projeto precisa ganhar

| Item                                            | Onde                     | Motivo                                             |
| ----------------------------------------------- | ------------------------ | -------------------------------------------------- |
| `btree_gist`                                    | nova migração            | EXCLUDE de vigências                               |
| 12 permissões de domínio                        | `permissions.ts`         | O arquivo já reserva o lugar                       |
| `cidadao` em `Papel`                            | `schema.prisma` + matriz | Portal Cidadão (Art. 5º)                           |
| Exceção do `cidadao` em `grupos-para-papeis.ts` | auth                     | Não existe grupo AD para cidadão                   |
| `CidadaoCredentialValidator`                    | `auth/validators/`       | Segundo validator atrás da interface existente     |
| 12 módulos de domínio                           | `src/modules/`           | Núcleo processual                                  |
| Testes e2e das constraints                      | `test/`                  | Os `verifica_*.sql` viram e2e contra Postgres real |

Os três scripts de verificação que escrevi (`verifica_regras.sql`, `verifica_lacunas.sql`, `verifica_financeiro.sql`) provam constraints do banco. No seu projeto isso tem lugar próprio: e2e contra o Postgres real, no padrão de `test/auth.e2e-spec.ts`. É onde eles devem terminar.

---

## 4. Riscos de ambiente — o quadro piorou

Eu já tinha apontado a divergência dev/prod. Lendo o CI, ela é maior do que eu supunha:

- `docker-compose.dev.yml` → `imresamu/postgis:17-3.5`
- CI, job de e2e → `imresamu/postgis:17-3.5`
- CI, job de imagem → `imresamu/postgis:17-3.5`
- **Produção (`20.50.2.224`) → PostgreSQL 16.13, sem PostGIS**

Ou seja, **nenhum dos três ambientes que validam o código roda a versão de produção**, e produção não tem a extensão que a migração exige. Enquanto o schema tinha só `users` e `sessions` isso não custava nada — a migração 2 faz `CREATE EXTENSION IF NOT EXISTS postgis` e falharia silenciosamente… não, falharia ruidosamente, mas ninguém tentou ainda porque não há tabela com geometria.

No momento em que a migração do núcleo processual entrar no `prisma migrate deploy` do CD, ela **falha em produção** — e o rollback automático do seu CD restaura a imagem, mas não desfaz uma migração parcialmente aplicada.

Duas providências antes de qualquer código de domínio:

1. **PostGIS no LXC de produção**, na versão que casa com o PG 16 instalado.
2. **Alinhar dev e CI para a major de produção** (`imresamu/postgis:16-3.4`) ou subir produção para 17. Validar em 17 e implantar em 16 é apostar que nada mudou entre majors — e entre PostGIS 3.4 e 3.5 há mudanças de comportamento.

Minha migração foi validada em **PG 16 + PostGIS 3.4.2**, que é o alvo de produção — não o que seu CI roda hoje.

Terceiro item, menor: o backup do LXC continua ausente, e agora passa a precisar cobrir a extensão, não só os dados. `pg_dump` de um banco com PostGIS não restaura num destino sem a extensão instalada.

> **ATUALIZAÇÃO — 31/08/2026.** Esta seção estava errada no ponto principal, e
> a correção veio de olhar a máquina em vez do registro. O LXC `20.50.2.224`
> **já tinha** `postgresql-16-postgis-3` na versão **3.4.2**, com a extensão
> criada no banco `titularr` — a mesma versão contra a qual a migração foi
> validada. Faltava apenas `btree_gist`, criado no mesmo dia.
>
> O que a seção acertou foi a divergência dev/CI: os três ambientes rodavam
> `imresamu/postgis:17-3.5`, e passaram a rodar `16-3.4` no commit `8144b03`.
>
> O terceiro item — backup — deixou de ser pendência em 31/08: `pg_dump`
> diário por systemd timer, com `pg_dumpall --globals-only` junto e
> restauração testada num destino limpo (voltou com `plpgsql`, `btree_gist` e
> `postgis`). Ver [`runbook.md`](../runbook.md).
>
> Um detalhe que esta seção não previu e que só apareceu no servidor:
> `CREATE EXTENSION postgis` **exige superusuário** — PostGIS não é uma
> extensão _trusted_ — e o papel da aplicação, corretamente, não é. Se as
> extensões não estivessem criadas de antemão, o `migrate deploy` do CD
> falharia por permissão mesmo com o pacote instalado.

---

## 5. Observações de higiene

- O repositório está em `main` com `certs/ad-ldaps.pem` modificado e não commitado. Como o `CLAUDE.md` diz para nunca commitar direto em `main`, vale resolver antes de abrir a branch do domínio.
- `.agents/skills` e `.claude/skills` existem no repositório — não os inspecionei, mas se houver skill de projeto descrevendo convenções, ela deve ter precedência sobre o que este documento recomenda.

---

## 6. Decisões pendentes

1. ~~**Convenção de nomes**~~ — **DECIDIDO (25/08/2026): camelCase, a convenção da casa.** Schema, migração, seed e scripts de verificação já convertidos: colunas em camelCase sem `@map` de campo, tabelas em plural português via `@@map`, enums em PascalCase. O bloco `datasource` foi alinhado ao do projeto (só `provider`).

2. **Fuso nas colunas de tempo** — ainda aberto. O modelo está com `timestamptz` no domínio, contra o `TIMESTAMP(3)` do `users`/`sessions`. Mantive assim porque o modo de falha é uma data errada em prazo legal (documento juntado 23h30 de 09/07 em Boa Vista vira 10/07 num `::date`), mas é um find/replace se você preferir uniformidade.

3. **Qual município rege a contagem de prazo** — ainda aberto. O do imóvel ou o da sede do órgão? São respostas diferentes para quem tem imóvel no Cantá e residência em Manaus.

> **ATUALIZAÇÃO — 31/08/2026.**
>
> **(2) Fuso** segue aberto, mas com um dado a mais que muda a recomendação: o
> cluster de produção roda em `Etc/UTC`. Isso significa que `timestamptz`
> sozinho **não** resolve o cast para data local, e que mudar o fuso do banco
> teria efeito colateral em `users`/`sessions` — `createdAt` é `TIMESTAMP(3)`
> com `DEFAULT CURRENT_TIMESTAMP`, cuja conversão usa o fuso da sessão.
> Recomendação atual: cluster em UTC, domínio em `timestamptz`, e
> `AT TIME ZONE 'America/Boa_Vista'` explícito onde a data local importar.

> **ATUALIZAÇÃO — 01/09/2026. (2) e (3) FECHADOS.**
>
> **(2) Fuso:** adotada a recomendação acima, com uma diferença — a conversão
> não fica solta nas consultas, e sim numa função `data_local(timestamptz)`,
> para que exista um nome a procurar (`grep data_local`) e um lugar só para
> mudar. `users`/`sessions` permanecem em `TIMESTAMP(3)`.
>
> **(3) Município do prazo:** a sede do órgão. Ver o bloco em
> [`segunda-analise-lacunas.md`](./segunda-analise-lacunas.md) §C3.
>
> **(3) Município do prazo** segue aberto, sem novidade.
>
> Das quatro linhas da seção 2 e das sete da seção 3, seguem em aberto apenas
> os 12 módulos de domínio e o `CidadaoCredentialValidator`. As FKs de
> servidor (2.4) entraram em `d6e4523`; o `cidadao` no enum e a exceção em
> `gruposParaPapeis` (2.5), em `2252393`; os testes das constraints, em
> `1d9cc2f`.
