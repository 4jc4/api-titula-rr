# Segunda varredura de lacunas — modelo do núcleo processual

Revisão adversarial do modelo de 29 models contra o texto da IN 002/2026, artigo por artigo, procurando o que ainda não tem lugar no schema. Também revisa o que já foi entregue, à procura de defeitos.

**Vinte achados**: 4 estruturais, 10 aditivos, 3 defeitos no que entreguei (um já corrigido) e 3 omissões conscientes que precisam ficar registradas em vez de corrigidas.

O resumo honesto: o modelo cobre bem o que a IN manda **guardar**, e cobre mal o que a IN manda **acontecer** entre o protocolo e a autuação, e entre o Iteraima e o interessado na direção de volta.

---

## A. Estruturais — mudam o formato do modelo

### A1. O requerimento existe antes do processo

O **Art. 49, I** é explícito na ordem: a DCI _recebe_ o requerimento, _realiza os procedimentos de admissibilidade_ nos termos dos Anexos VII a IX, e **"não havendo pendência documental, autuará o processo"**. A autuação é consequência da admissibilidade, não pré-requisito dela.

O modelo faz o contrário. `Processo.numero_sei` é `NOT NULL UNIQUE` e `Requerimento` depende de `Processo`. Para registrar um pedido, é preciso já ter número SEI — ou seja, já ter autuado.

Isso quebra em dois pontos concretos:

- O cidadão protocola pelo Portal (Art. 5º) e o pedido fica em triagem. Nesse intervalo não há processo, e não há onde guardar o pedido.
- O parágrafo único do Art. 49, I prevê o pedido que **não** passa na admissibilidade: pendência documental, notificação para complementar, e encaminhamento à DIPRE se o requerente não atender. Nada disso gera processo autuado — mas tudo isso precisa ser registrado, inclusive a notificação.

Hoje, para representar esse fluxo, a única saída seria autuar processos SEI que talvez nunca existam.

**Duas saídas.** (a) Tornar `numeroSei` nullable, com a fase `PROTOCOLO` significando "recebido, não autuado", e um CHECK exigindo o número a partir de `ADMISSIBILIDADE`. (b) Criar uma entidade `SolicitacaoProtocolo` anterior, que vira processo ao ser autuada.

A opção (a) é a mais econômica: mantém uma entidade só, o índice parcial de duplicidade continua funcionando, e a transição vira um `UPDATE`. A (b) é mais fiel ao domínio, mas duplica pessoa, imóvel e documentos em duas entidades e obriga a migrar tudo na autuação.

**Recomendo (a)**, com o CHECK amarrando número e fase.

### A2. Instrumento de regularização e onerosidade não existem no processo

O **Art. 49, V** manda o processo à DIPRE/CONSULT _"quanto ao instrumento de regularização fundiária adequado"_, e o **VI** registra que **"definido o instrumento, o processo retornará à Presidência para conhecimento e decisão"**. O instrumento é, portanto, um atributo do processo decidido em fase intermediária — dentro do núcleo, não na titulação.

Os instrumentos possíveis aparecem espalhados pela IN: Título Definitivo (Art. 48, 51, 64), Autorização de Ocupação (Art. 64, Anexo XII) e Contrato de Promessa de Compra e Venda (Art. 48). E o **Anexo X, etapa 1** menciona a _"transformação de processo de alienação não onerosa em onerosa"_ — ou seja, a onerosidade é um atributo mutável, com taxa própria para a mudança.

Sem `instrumento` e `onerosidade` no processo:

- não há como saber qual rito de cobrança aplicar (Art. 48 manda ritos diferentes para TD e CPCV);
- a "transformação de não onerosa em onerosa" não tem o que transformar;
- o Art. 75 (cessionários do desintrusamento, regularização _onerosa_ pelo VTN mínimo) não tem onde marcar sua exceção.

São dois campos, mas mudam o significado do processo.

### A3. A comunicação não sabe para quem foi

`Comunicacao` liga-se ao processo e assume, implicitamente, que o destinatário é o interessado. A IN não permite essa suposição:

- **Art. 6º, §7º** lista _"recebimento de notificações"_ como poder específico que pode ser outorgado ao procurador — logo, o procurador é destinatário legítimo, e só se tiver esse poder;
- **Art. 69, §1º** diz _"O Interessado, procurador ou representante legal assinará termo de anuência"_ — três destinatários possíveis, cada um com seu termo;
- **Art. 62, 65 e 67** notificam "o requerente"; o **Art. 43** notifica as partes em conflito, que são interessados de **processos diferentes**.

Falta `destinatario_pessoa_id`. Sem ele não dá para responder duas perguntas que decidem validade: _quem_ foi intimado, e o termo de anuência _dessa pessoa_ estava vigente na data da expedição? A validade da intimação eletrônica depende exatamente disso.

### A4. Não há como registrar que a parte se manifestou

Toda `Comunicacao` do modelo é de saída. A IN prevê pelo menos quatro entradas na direção contrária:

- **Art. 7º, parágrafo único** — peticionamento intercorrente por advogados, partes e procuradores;
- **Art. 6º, §8º** — revogação de mandato, que o interessado deve comunicar _"formalmente ao Iteraima mediante comunicação escrita"_;
- **Art. 54, VI** — os autos voltam ao setor demandante _"após a manifestação da parte ou o decurso do prazo"_;
- **Art. 74, parágrafo único** — _"quando o intimado não apresentar defesa"_, o Iteraima decide de forma motivada com base nos elementos dos autos.

Essa última é a mais séria. O Art. 74 **veda os efeitos da revelia** — o silêncio não presume nada. Logo, a distinção entre "respondeu" e "não respondeu" não é formalidade: é o que determina se o processo segue com defesa ou sem ela, e o servidor precisa registrar a diferença.

Hoje o modelo só tem `Comunicacao.encerrada_em`, que não diz _por que_ encerrou. Falta uma entidade de manifestação/petição do interessado, ligada à comunicação que a provocou (quando houver) e com a data que permite comparar com `dataFimPrazo`.

---

## B. Aditivos — campos e entidades que faltam

### B1. Os poderes do procurador não são registrados

O **Art. 6º, §7º** obriga o instrumento de mandato a discriminar _"de forma clara e expressa"_ os poderes, e enumera quatro: **abertura de processo; recebimento de notificações; protocolar requerimentos; assinatura e recebimento de documento de regularização fundiária**.

`ParteProcesso` tem `mandatoValidoAte`, mas não os poderes. Consequência prática: um procurador com poder apenas de protocolar poderia, pelo sistema, assinar o recebimento do título. A IN separou os quatro justamente para impedir isso.

São quatro booleanos ou um array de enum — pequeno, mas é uma regra de autorização, não um detalhe cadastral.

### B2. A habilitação do responsável técnico não existe

O **Art. 12, §1º** exige que a carta-imagem venha _"acompanhada da respectiva Anotação de Responsabilidade Técnica (ART)"_ e seja validada pelo Iteraima. O **Anexo VI** pede, no relatório de marcos, o **Responsável Técnico, seu CREA ou CFT, e o código INCRA do RT credenciado**.

`PapelParte` tem `RESPONSAVEL_TECNICO`, mas `Pessoa` não tem CREA/CFT nem código INCRA, e a ART não é modelada em lugar nenhum. Como o Art. 12 vale para todo imóvel acima de 4 módulos fiscais, isso é instrução processual — núcleo, não fase futura.

Mínimo: campos de habilitação em `Pessoa` (ou uma `HabilitacaoProfissional` com validade) e o número da ART em `DocumentoProcesso`, já que a ART acompanha uma peça específica.

### B3. Não há onde fazer a pesquisa de outorga

O **Anexo X, etapa 1** lista _"pesquisa de outorga de documentos"_ entre as tarefas da DCI na abertura. O **Art. 49, IX, "a"** repete na emissão: _"realizar pesquisa de outorga e constatar se o interessado está dentro do limite constitucional de 2.500 hectares"_.

Para somar áreas já outorgadas seria preciso um cadastro de outorgas anteriores — inclusive as feitas antes do sistema existir, e as feitas por outros órgãos (o INCRA aparece nos Arts. 66 e 67). Não há nada disso no modelo.

Enquanto não houver, a pesquisa de outorga é manual e o limite de 2.500 ha não é verificável pelo sistema. Vale registrar que a própria IN trata esse limite de forma imprecisa (ver item 3.4 do levantamento de inconsistências), mas isso não dispensa o cadastro.

### B4. Renda e hipossuficiência ficam só como anexo

O **Anexo VII, item 9** exige comprovação de renda com regras distintas por categoria (autônomo, servidor público, iniciativa privada, hipossuficiente). O **Anexo V** estrutura a renda familiar por membro — nome, CPF e valor. O **Anexo IV** é a declaração de hipossuficiência nos termos da **Lei 7.115/1983**, e tem efeito processual concreto: dispensa o requerente de custear a contratação do profissional de georreferenciamento.

No modelo, tudo isso seria apenas `DocumentoProcesso` com um tipo. O que falta não é o arquivo — é o **deferimento**: não há onde gravar que a hipossuficiência foi reconhecida, quem reconheceu, e que por isso o georreferenciamento corre por conta do Estado.

Mínimo: um campo de deferimento no processo. Completo: `RendaFamiliarDeclarada` com os membros, se o Iteraima quiser analisar renda no sistema em vez de no papel.

### B5. Não há lotação de servidor

O guard do `TramitacaoModule` precisa responder "este servidor pode receber processo neste setor?". Hoje a única informação disponível é o papel vindo do AD, e `Setor.papel_rbac` tenta fazer a ponte — mas a ponte é frágil: a **DSF não tem papel algum**, e `colaborador`, `gestor` e `administrador` não correspondem a setor nenhum.

Falta a lotação: qual servidor trabalha em qual setor, desde quando. É uma tabela pequena e resolve o guard sem depender de o AD ter um grupo por setor.

### B6. Anulação por fraude não é uma situação possível

O **Art. 73** determina que, demonstrada fraude, _"o processo será anulado e arquivado, sem prejuízo das demais sanções cíveis e penais aplicáveis"_.

`SituacaoProcesso` tem `ARQUIVADO` e `INDEFERIDO`. Anulação é juridicamente distinta das duas: não é mérito rejeitado nem encerramento administrativo, é o reconhecimento de que o ato não deveria ter existido — com desdobramentos penais. Registrar como `ARQUIVADO` apaga exatamente a informação que importa.

Falta o valor `ANULADO` no enum, e o registro do fundamento.

### B7. O chamamento à ordem não tem registro

O **Art. 79** cria uma prerrogativa exclusiva do Presidente — _"chamar o feito à ordem"_ — e um dever do servidor: _"solicitá-la formalmente à Presidência"_.

São dois atos com autores distintos, e nenhum tem lugar no modelo. `TipoEventoProcesso` não contempla nem a solicitação nem o chamamento. É correção de rumo processual: sem registro, não há como auditar por que um processo voltou fases.

### B8. Solicitar notificação não é o mesmo que expedir

O **Art. 54** descreve as etapas: **I** — instauração _"mediante encaminhamento, pelo setor técnico competente, da solicitação de notificação à Câmara"_; **II** — expedição do ato notificatório. São momentos separados, e entre eles a Câmara faz o controle de formalidade que o **Art. 53, parágrafo único** lhe atribui.

`Comunicacao.expedida_em` é `NOT NULL` com default `now()`. Não existe o estado "solicitada, ainda não expedida" — que é justamente onde a Câmara atua. Falta `solicitada_em`, com `expedidaEm` passando a nullable.

### B9. Certidões não têm tratamento próprio

A IN prevê pelo menos cinco certidões distintas: de tramitação (**Art. 9º**), de relacionamento (**Art. 16, II**), do ato de exclusão da base cartográfica (**Art. 68**), de reativação no desarquivamento (**Art. 56, IV, "a"**) e de pagamento (**Art. 49, VIII**).

Todas caberiam em `DocumentoProcesso` com um tipo — e talvez seja suficiente. Mas certidão é documento que o órgão **emite** e que circula fora dos autos: costuma ter numeração própria, validade e código de verificação de autenticidade. Vale decidir conscientemente se é um `TipoDocumento` ou uma entidade com numeração — não deixar cair no genérico por omissão.

### B10. Peça técnica substituída fica indistinguível da nova

Os **Arts. 62, 65 e 67**, parágrafos únicos, mandam o requerente _"apresentar nova peça técnica (planta e memorial descritivo), excluindo a área sobreposta"_. A peça antiga não deixa de existir nos autos — ela é o que documenta a área originalmente pretendida.

`DocumentoProcesso` não tem `substitui_documento_id`. Depois de duas retificações, três plantas convivem sem ordem nem indicação de qual está valendo. É um campo, e evita o erro de análise sobre a peça errada.

---

## C. Defeitos no que já foi entregue

### C1. `adicionar_dias_uteis` podia entrar em laço infinito — **corrigido**

A função avançava um dia por vez até consumir os dias úteis, sem teto. Com um calendário mal semeado — por exemplo, um `INSERT` de intervalo errado que marcasse todo dia como feriado — o `WHILE` nunca terminaria, prendendo a conexão até o timeout.

Corrigido com teto de 1.830 dias corridos (cinco anos, acima de qualquer prazo desta IN) e `RAISE EXCEPTION` nomeando o calendário como causa provável. Testado: o caso normal continua funcionando, e um calendário patológico agora falha com mensagem clara em vez de travar.

### C2. `Processo.setor_atual_id` é uma sexta denormalização não documentada

O documento de modelo lista cinco denormalizações deliberadas e justifica cada uma. `setorAtualId` é uma sexta: é derivável da última `Tramitacao` com `concluido_em IS NULL`, e pode divergir dela se alguém atualizar uma sem a outra.

Ou entra na tabela de denormalizações com justificativa (é consulta de listagem, cara de derivar em toda página de processos), ou sai do modelo. Deixar sem menção é a única opção ruim — porque um leitor do schema não tem como saber que existe uma invariante entre duas colunas.

**Recomendo manter e documentar**, com a atualização das duas sempre na mesma transação do `TramitacaoModule`.

### C3. `e_dia_util` aplica feriados de Roraima por omissão

A função faz `COALESCE((SELECT uf FROM municipio WHERE id = p_municipio_id), 'RR')`. Quando o município é nulo, aplica silenciosamente os feriados estaduais de RR.

É defensável — o órgão é de Roraima — mas há uma pergunta não respondida: **qual município rege o prazo?** Não é o do endereço do interessado, que pode morar em outro estado. Candidatos: o do imóvel, ou o da sede do órgão (Boa Vista). São respostas diferentes para um interessado com imóvel no Cantá e residência em Manaus.

Enquanto não for decidido, o `PrazoService` vai receber `municipioId` de quem chamar, e cada chamador pode escolher diferente. Precisa de decisão explícita e de um default no serviço, não na função SQL.

---

## D. Omissões conscientes — registrar, não corrigir agora

### D1. Suspensão e interrupção de prazo

O modelo trata prazo como início mais dias úteis. Não há suspensão. A IN não prevê hipóteses expressas, mas a Lei 418/2004 e a prática administrativa preveem — e o **Art. 44, §2º** menciona processos _"sobrestados"_, o que na prática suspende prazos. Cabe quando o `ComunicacaoModule` for implementado; hoje seria especulação.

### D2. Histórico de alteração de `Pessoa`

Correção de CPF, mudança de estado civil e retificação de nome não deixam rastro. `ProcessoEvento` cobre processos, não pessoas. Para um cadastro que fundamenta título de propriedade, isso é relevante — mas é decisão de política de auditoria, não do núcleo processual.

### D3. Detecção de processo paralisado

O **Art. 80, §1º** manda encaminhar à DIPRE os processos _"paralisados por falta de manifestação ou interesse do requerente"_. A data da última movimentação é derivável de `Tramitacao` e `ProcessoEvento`, mas a consulta é cara em varredura periódica. Se virar rotina diária, vale um campo mantido pelo `AuditoriaModule`.

---

## Prioridade sugerida

| #   | Achado                          | Impacto                                       | Esforço           |
| --- | ------------------------------- | --------------------------------------------- | ----------------- |
| A1  | Requerimento antes do processo  | Bloqueia o Portal Cidadão e a admissibilidade | Médio             |
| A4  | Manifestação da parte           | Sem ela, Art. 74 não é aplicável              | Médio             |
| A3  | Destinatário da comunicação     | Validade da intimação                         | Baixo             |
| A2  | Instrumento e onerosidade       | Define o rito de cobrança                     | Baixo             |
| B1  | Poderes do procurador           | Regra de autorização                          | Baixo             |
| B6  | Situação `ANULADO`              | Art. 73                                       | Baixo             |
| B8  | Solicitação vs expedição        | Competência da Câmara                         | Baixo             |
| B5  | Lotação de servidor             | Guard de tramitação                           | Baixo             |
| B2  | Habilitação do RT e ART         | Art. 12 §1º                                   | Médio             |
| B10 | Substituição de peça técnica    | Rastreabilidade                               | Baixo             |
| B4  | Deferimento de hipossuficiência | Quem paga o georreferenciamento               | Baixo             |
| C2  | Documentar `setorAtualId`       | Clareza do schema                             | Trivial           |
| C3  | Decidir o município do prazo    | Correção de prazos                            | Trivial + decisão |
| B7  | Chamamento à ordem              | Auditoria                                     | Trivial           |
| B9  | Certidões                       | Decisão de design                             | Baixo             |
| B3  | Pesquisa de outorga             | Limite constitucional                         | Alto              |

**A1 e A4 são as que valem atenção antes de escrever código.** As duas mudam o formato do que já existe; as demais são campos que entram sem reorganizar nada.

O caminho mais curto: A1, A2, A3, A4 e B1, B5, B6, B8 numa única migração — todas tocam `processos`, `comunicacoes` e `partes_processo`, e juntas fecham o que impede as fases 6 e 10 de rodar. B2, B4 e B10 podem esperar as fases 7 e 3. B3 é a única que depende de dado que não está no Iteraima hoje.
