# Papéis do `api-titula-rr` — o conjunto mínimo

Os dez papéis atuais foram herdados do sistema `regulariza`: dez tipos de usuário que viraram dez grupos do AD, sem passar pelo texto da IN. Este documento aplica um teste único:

> **Um papel só existe se houver ato que só ele pode praticar.**

Sem ato exclusivo, o papel sai. Não há papel "por precaução", "para consulta" ou "porque já existe no AD".

**Resultado: 12 papéis.** Saem dois, entram quatro.

> **Implementado em 31/08/2026** (commit `2252393`): o enum, as 31 permissões
> e a matriz das seções 6 e 7 estão em `prisma/schema.prisma` e
> `src/modules/auth/permissions.ts`, com a migração que recria o tipo no banco
> e testes para a união do Art. 80 e para a recusa do `TITULA_CIDADAO`.
> Seguem por confirmar com quem opera os dois pontos da seção 8.

---

## 1. O corte

| Papel atual       | Veredito             | Motivo                                                                                |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `atendimento`     | fica                 | DCI — autuação e juntada são **competência exclusiva** (Art. 7º)                      |
| `governanca`      | fica                 | DIGOF — análise de sobreposição e cartografia (Arts. 14-31)                           |
| `financeiro`      | fica                 | DIRAD/GEORF-CER — confirmação de pagamento (Art. 56, II)                              |
| `titulacao`       | fica                 | DIGEF — confecciona o documento e prenota no livro fundiário (Art. 49, IX)            |
| `planejamento`    | fica                 | DIPLAN — certificação no SIGEF e atualização no SNCR (Art. 49, XI)                    |
| `presidencia`     | fica                 | DIPRE — decide admissibilidade do desarquivamento (Art. 56, III) e o mérito (Art. 45) |
| `gestor`          | fica, **redefinido** | passa a significar chefia imediata do Art. 80 — e some com o papel de setor           |
| `administrador`   | fica                 | administração do sistema: usuários, sessões, parâmetros                               |
| **`colaborador`** | **sai**              | nenhum ato em nenhum artigo da IN                                                     |
| **`informatica`** | **sai**              | nenhum ato processual; o que faz já é `administrador`                                 |

**Por que `colaborador` sai.** Era o papel de "ler sem agir". Mas quem não pratica ato processual não precisa de conta no sistema — precisa de uma certidão, que o Art. 9º já disciplina. E quem precisa consultar por dever de ofício pertence a algum setor, e o papel do setor já dá leitura. Um papel só de leitura vira o destino padrão de toda conta que ninguém sabe classificar.

**Por que `informatica` sai.** Não há ato de TI na IN. O que a TI faz — criar usuário, revogar sessão, ajustar parâmetro — é exatamente `administrador`. Dois papéis para o mesmo conjunto convidam ao erro de atribuição, e o menos privilegiado dos dois acaba usado como "administrador de segunda", que não é conceito nenhum.

---

## 2. Os quatro que entram

### `servicos_fundiarios` — a DSF

O buraco maior do conjunto atual. A Diretoria de Serviços Fundiários aparece nas etapas **3, 6 e 13** do Anexo X — o setor mais recorrente do fluxograma — e emite o parecer técnico conclusivo do Art. 29 da Lei 976/2014 (Art. 49, III), realiza vistoria, apura o VTN e emite o parecer de baixa das cláusulas resolutivas. Nenhum dos dez papéis a cobre.

### `notificacao` — a Câmara de Notificação

O Art. 52 institui a Câmara para _"centralização, controle, expedição e acompanhamento de todas as notificações"_. Exclusividade por desenho — sem papel próprio, `comunicacao:expedir` teria de ir para todos os setores, que é o oposto do capítulo.

Limitada pelo parágrafo único do Art. 53: atuação restrita à **análise formal**, sem adentrar o mérito. Expede e certifica; não decide.

### `presidente` — a autoridade, não a diretoria

A IN reserva atos ao Presidente **pessoalmente**: chamar o feito à ordem (Art. 79, _"exclusivamente"_), avocar para dirimir conflito (Art. 60), anular por fraude (Art. 73), excluir da base cartográfica (Arts. 59, 61 e 62), decidir dúvidas de aplicação e casos não previstos (Arts. 3º e 81).

Um analista da DIPRE instruindo e o Presidente decidindo não podem compartilhar conjunto de permissões.

### `cidadao` — o Portal

Art. 5º. Não tem grupo no AD nem deveria ter — vem do `PessoaAcesso` via gov.br.

---

## 3. Os que eu tinha proposto e agora corto

Na versão anterior propus quinze papéis (e escrevi "treze" no texto — erro de contagem que este documento corrige). Três não sobrevivem ao próprio teste:

**`arquivo`** — o Art. 56, IV atribui o desarquivamento à Divisão de Arquivo, mas a DCI já é quem recebe o pedido e cobra a taxa (Art. 56, I). São dois incisos do mesmo fluxo, e num instituto do porte do Iteraima dificilmente há equipe dedicada só a isso. `processo:desarquivar` vai para `atendimento`. Se existir de fato uma Divisão de Arquivo com pessoal próprio, promove-se depois — é uma linha no enum e um grupo no AD.

**`colaborador`** e **`informatica`** — pelos motivos da seção 1. Eu os havia mantido "com significado documentado", que é outra forma de dizer que não achei coragem de cortar.

**`ouvidoria`** continua fora: seu peso está no Capítulo VII, e entra com o módulo de conflito agrário.

---

## 4. `gestor` deixa de ser identidade e vira nível

O Art. 80 é explícito: _"É vedado ao servidor o encaminhamento de processos ao arquivo sem a prévia e expressa decisão de arquivamento da chefia imediata."_

Isso exige distinguir chefe de analista **dentro do mesmo setor**. Com papel único, o chefe da DIGOF escolhe entre `governanca` (e perde a autoridade de arquivar) ou `gestor` (e perde as permissões de sobreposição). Nenhuma das duas descreve a pessoa.

A saída já está no schema: `papeis` é `Papel[]`, e o comentário o chama de _"folga estrutural"_. A IN acabou de dar o motivo para usá-lo. `['governanca', 'gestor']` passa a ser combinação válida, e `temPermissao()` já faz a união.

Duas consequências:

- `gruposParaPapeis` para de emitir warn para dois grupos, mas passa a validar a **forma** da combinação: exatamente um papel de setor, opcionalmente `gestor`.
- `usuario:listar` sai de `gestor` e vai para `administrador`, onde sempre pertenceu. Chefia imediata é autoridade sobre processo, não sobre contas.

---

## 5. `cidadao` exige escopo de linha — e o guard atual não tem

Todas as permissões do cidadão são escopadas ao próprio dossiê. `processo:ler` para um servidor significa "qualquer processo"; para o cidadão significa "aqueles em que sou interessado, cônjuge ou parte".

O `PermissionGuard` responde sim/não sobre a permissão. **Não sabe de escopo de linha.** Conceder `processo:ler` ao `cidadao` sem um segundo mecanismo abre o acervo inteiro para qualquer requerente.

Isso precisa de um filtro obrigatório no `ProcessoService` quando o principal vem do `PessoaAcesso`. Não é detalhe de implementação — é a diferença entre um portal e um vazamento. E `cidadao` nunca se combina com papel interno: a validação da forma do array precisa proibir isso explicitamente.

---

## 6. O enum

```prisma
// Papéis derivados dos atos que a IN 002/2026 atribui com exclusividade.
// REGRA: um papel de setor por pessoa, opcionalmente somado a `gestor`
// (chefia imediata do Art. 80). `cidadao` nunca combina com nenhum outro.
// Grupos do AD: TITULA_<PAPEL>, exceto `cidadao`, que vem do PessoaAcesso.
enum Papel {
  // -- Setores do fluxo do Anexo X ------------------------------------------
  atendimento          // DCI/Protocolo — Arts. 5º, 7º, 49 I, 56 I; etapa 1
  governanca           // DIGOF (+Geoprocessamento, GG) — Arts. 14-31; etapas 2 e 4
  servicos_fundiarios  // DSF/GET — Arts. 18 I, 49 III/VII/XV; etapas 3, 6 e 13
  financeiro           // DIRAD/GEORF-CER — Arts. 49 VIII/XII, 56 II; etapas 7 e 11
  titulacao            // DIGEF — Art. 49 IX; etapa 8
  planejamento         // DIPLAN — Art. 49 XI; etapa 10
  presidencia          // DIPRE/CONSULT/SECEX — Arts. 45, 49 V/X, 56 III; etapas 5, 9 e 14
  notificacao          // Câmara de Notificação — Arts. 52-54

  // -- Autoridade -----------------------------------------------------------
  presidente           // atos privativos — Arts. 3º, 59-62, 73, 79, 81
  gestor               // chefia imediata do Art. 80 — SOMA-SE a um papel de setor

  // -- Sistema --------------------------------------------------------------
  administrador        // contas, sessões e parâmetros normativos

  // -- Externo --------------------------------------------------------------
  cidadao              // Portal — Art. 5º; NUNCA combina com outro papel
}
```

`titulacao` e `planejamento` ficam com leitura no núcleo processual: o ato de cada um (Art. 49, IX e XI) acontece depois da decisão, no Capítulo VIII. Diferente de `colaborador` e `informatica`, eles **têm** ato na IN — só não nesta fase.

---

## 7. Permissões e matriz

```ts
export const PERMISSOES_DISPONIVEIS = [
  'usuario:listar',
  'sessao:revogar',

  'processo:criar', // Art. 5º
  'processo:ler',
  'processo:admissibilidade', // Art. 49 I
  'processo:autuar', // Art. 7º — exclusivo da DCI
  'processo:relacionar', // Arts. 13-15
  'processo:sobrestar',
  'processo:decidir', // deferir/indeferir — Arts. 45, 59
  'processo:arquivar', // Art. 80 — só a chefia imediata
  'processo:desarquivar', // Art. 56 IV
  'processo:anular', // Art. 73 — fraude
  'processo:avocar', // Arts. 60 e 79 — privativo do Presidente

  'pessoa:ler',
  'pessoa:editar',
  'imovel:ler',
  'imovel:editar',
  'geometria:editar', // perímetro — só DIGOF

  'documento:ler',
  'documento:juntar', // Art. 7º — vedado a outros setores
  'documento:peticionar', // Art. 7º pu — intercorrente, pela parte

  'tramitacao:enviar',
  'tramitacao:receber',

  'comunicacao:solicitar', // Art. 54 I — setor técnico
  'comunicacao:expedir', // Arts. 52-53 — só a Câmara
  'comunicacao:certificar', // Art. 53 III

  'debito:emitir', // Anexo X, etapas 1 e 7
  'debito:confirmar', // Art. 56 II — GEORF/CER
  'debito:cancelar',

  'parametro:ler',
  'parametro:editar',
] as const;
```

```ts
export const MATRIZ_PERMISSOES = {
  // Único setor que autua e junta (Art. 7º): todo parecer técnico produzido
  // pela DIGOF ou pela DSF passa pela DCI para entrar nos autos.
  atendimento: [
    'processo:criar',
    'processo:ler',
    'processo:admissibilidade',
    'processo:autuar',
    'processo:relacionar',
    'processo:desarquivar',
    'pessoa:ler',
    'pessoa:editar',
    'imovel:ler',
    'imovel:editar',
    'documento:ler',
    'documento:juntar',
    'tramitacao:enviar',
    'tramitacao:receber',
    'comunicacao:solicitar',
    'debito:emitir',
    'parametro:ler',
  ],
  governanca: [
    'processo:ler',
    'processo:relacionar',
    'imovel:ler',
    'imovel:editar',
    'geometria:editar',
    'documento:ler',
    'tramitacao:enviar',
    'tramitacao:receber',
    'comunicacao:solicitar',
    'parametro:ler',
  ],
  servicos_fundiarios: [
    'processo:ler',
    'pessoa:ler',
    'imovel:ler',
    'documento:ler',
    'tramitacao:enviar',
    'tramitacao:receber',
    'comunicacao:solicitar',
    'parametro:ler',
  ],
  financeiro: [
    'processo:ler',
    'documento:ler',
    'tramitacao:enviar',
    'tramitacao:receber',
    'debito:emitir',
    'debito:confirmar',
    'debito:cancelar',
    'parametro:ler',
  ],
  // Ato próprio só no Cap. VIII (Art. 49 IX). No núcleo, leitura.
  titulacao: [
    'processo:ler',
    'pessoa:ler',
    'imovel:ler',
    'documento:ler',
    'tramitacao:enviar',
    'tramitacao:receber',
    'parametro:ler',
  ],
  // Ato próprio só no Cap. VIII (Art. 49 XI). No núcleo, leitura.
  planejamento: [
    'processo:ler',
    'imovel:ler',
    'documento:ler',
    'tramitacao:enviar',
    'tramitacao:receber',
    'parametro:ler',
  ],
  presidencia: [
    'processo:ler',
    'processo:decidir',
    'processo:sobrestar',
    'documento:ler',
    'tramitacao:enviar',
    'tramitacao:receber',
    'comunicacao:solicitar',
    'parametro:ler',
    'parametro:editar',
  ],
  // Art. 53 pu: análise FORMAL apenas — expede e certifica, não decide.
  notificacao: [
    'processo:ler',
    'comunicacao:expedir',
    'comunicacao:certificar',
    'tramitacao:enviar',
    'tramitacao:receber',
  ],
  presidente: [
    'processo:ler',
    'processo:decidir',
    'processo:sobrestar',
    'processo:arquivar',
    'processo:anular',
    'processo:avocar',
    'documento:ler',
    'tramitacao:enviar',
    'tramitacao:receber',
    'comunicacao:solicitar',
    'parametro:ler',
    'parametro:editar',
  ],
  // NÃO substitui o papel de setor — soma-se a ele no array `papeis`.
  // Só a chefia imediata autoriza arquivamento (Art. 80).
  gestor: ['processo:arquivar'],
  administrador: [
    'usuario:listar',
    'sessao:revogar',
    'parametro:ler',
    'parametro:editar',
    // + as demais, enumeradas: permissão nova entra por commit, nunca em silêncio
  ],
  // ESCOPADAS AO PRÓPRIO DOSSIÊ. O PermissionGuard não aplica escopo de
  // linha — o filtro é obrigatório no ProcessoService. Ver seção 5.
  cidadao: [
    'processo:criar',
    'processo:ler',
    'documento:ler',
    'documento:peticionar',
  ],
} as const satisfies Record<Papel, readonly Permissao[]>;
```

---

## 8. O que muda no AD

**Criar três grupos:** `TITULA_SERVICOS_FUNDIARIOS`, `TITULA_NOTIFICACAO`, `TITULA_PRESIDENTE`.

**Remover dois:** `TITULA_COLABORADOR` e `TITULA_INFORMATICA` — antes, migrar quem estiver neles para o grupo do setor correspondente ou para `TITULA_ADMINISTRADOR`.

**`cidadao` não vira grupo.** Vem do `PessoaAcesso`; o `CidadaoCredentialValidator` atribui o papel sem passar por `gruposParaPapeis`.

Dois pontos operacionais valem confirmar antes de codificar:

1. **O gargalo do Art. 7º.** Só `atendimento` junta documento. Se na prática cada setor junta o próprio parecer, ou o artigo comporta leitura mais estreita, ou a norma está sendo descumprida — vale perguntar à DCI antes de a regra virar guard.
2. **Quem é chefia imediata.** `gestor` só faz sentido se houver uma lista real de chefes por setor. Sem isso, ninguém arquiva.
