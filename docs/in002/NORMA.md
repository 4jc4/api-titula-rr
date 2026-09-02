# IN 002/2026 — a norma, no repositório

Até 02/09/2026 este diretório continha seis documentos que **citavam** a IN
002/2026 sem que a norma estivesse aqui. Toda citação era, na prática, uma
citação de citação: ninguém conseguia reabrir o texto e conferir a redação sem
sair do repositório. Para um sistema cujo requisito **é** a norma, isso é um
risco estrutural — a análise podia estar certa, e não havia como saber.

A partir daqui, está.

## Os dois arquivos

| Arquivo                                | O que é                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`IN-002-2026.pdf`](./IN-002-2026.pdf) | **A fonte.** Recorte da edição nº 5166 do Diário Oficial do Estado de Roraima, de 18/05/2026, páginas 404–419 |
| [`IN-002-2026.txt`](./IN-002-2026.txt) | **Derivado.** A camada de texto do PDF, sem a diagramação do DOE — existe para ser lida por `grep`            |

O `.txt` é gerado, não editado à mão. Para refazê-lo:

```bash
python3 docs/in002/extrai-texto.py \
        docs/in002/IN-002-2026.pdf \
        docs/in002/IN-002-2026.txt
```

O script recorta o PDF a partir do cabeçalho da IN — antes dela vem o fim de uma
portaria da mesma edição — e remove os fragmentos da arte da Imprensa Oficial,
que a camada de texto espalha por todas as páginas, às vezes empurrados para a
margem direita da mesma linha em que a norma termina uma frase.

Ele falha, em vez de gravar, se o resultado não tiver exatamente **89 artigos**
ou se o preâmbulo tiver sido mutilado. As duas asserções não são decorativas: a
primeira versão do script removia a expressão `DO ESTADO DE RORAIMA` sem olhar o
contexto e apagava o trecho do preâmbulo que qualifica o Presidente do Instituto.

## Como conferir uma citação

```bash
# um artigo e seus parágrafos
grep -A6 '^\s*Art\. 71\.' docs/in002/IN-002-2026.txt

# onde a norma trata de um assunto
grep -n -i 'termo de anuência' docs/in002/IN-002-2026.txt
```

Para o texto com a paginação oficial — que é o que se cita em ofício —, vale o
PDF; o `.txt` não preserva quebra de página.

## Mapa da norma

| Bloco         | Artigos | Assunto                                             |
| ------------- | ------- | --------------------------------------------------- |
| Capítulo I    | 1–4     | Disposições gerais                                  |
| Capítulo II   | 5–12    | **Do requerimento e da instrução processual**       |
| Capítulo III  | 13–15   | Do relacionamento dos processos                     |
| Capítulo IV   | 16–20   | Da análise das sobreposições                        |
| — Seção I     | 21–29   | Produtos de representação cartográfica              |
| — Seção II    | 30–31   | Demais análises técnicas                            |
| Capítulo V    | 32–36   | Do georreferenciamento                              |
| Capítulo VI   | 37–38   | Da vistoria                                         |
| — Seção I     | 39–40   | Coleta de coordenadas em conflito e sobreposição    |
| — Seção II    | 41–42   | Conteúdo do laudo de vistoria                       |
| Capítulo VII  | 43–46   | Fluxograma para solução de conflitos fundiários     |
| Capítulo VIII | 47–49   | **Fluxograma do pedido de regularização fundiária** |
| Capítulo IX   | 50–51   | Convalidações e cancelamento de título definitivo   |
| Capítulo X    | 52–54   | **Da Câmara de Notificação**                        |
| Capítulo XI   | 55–58   | Do desarquivamento de processos                     |
| Capítulo XII  | 59–89   | Disposições finais e transitórias                   |

Treze anexos seguem os artigos. Os que o modelo usa:

| Anexo         | O que traz                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------- |
| VII, VIII, IX | As três listas de admissibilidade, por faixa de módulo fiscal (até 1; de 1 a 4; acima de 4) |
| X             | O fluxograma do pedido, setor por setor                                                     |
| XI            | O rito de cobrança de TD e CPCV                                                             |
| XII           | O rito de pagamento à vista                                                                 |

Os Capítulos II, VIII e X estão em negrito porque são os que os quatro achados
estruturais abertos em [`segunda-analise-lacunas.md`](./segunda-analise-lacunas.md)
tocam.

## Rodada de conferência — 02/09/2026

Com a norma em mãos, as citações que sustentam os quatro achados estruturais
foram confrontadas com o texto. **As quatro conferem.** O que a análise atribui
à IN está na IN, em geral literalmente:

| Achado | Citação conferida                                                     | Resultado                                                               |
| ------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A1     | Art. 49, I — _"não havendo pendência documental, autuará o processo"_ | Literal. O parágrafo único, com a bifurcação digital/presencial, também |
| A2     | Art. 49, V e VI — instrumento definido pela DIPRE/CONSULT             | Literal                                                                 |
| A3     | Art. 6º, §7º e Art. 69, §1º — mandato e termo de anuência             | Literal, inclusive a enumeração dos quatro poderes e o §8º da revogação |
| A4     | Art. 74 e parágrafo único — vedação da revelia                        | Literal, e mais forte do que a análise diz (ver abaixo)                 |

Duas correções saíram da conferência:

**1. O processo existe desde o protocolo.** A análise escreve, ao justificar A1,
que enquanto o pedido está em triagem _"não há processo"_. O Art. 5º diz o
contrário, com todas as letras: _"O processo de regularização fundiária rural
inicia-se com o protocolo de requerimento padrão"_. O que não existe ainda não é
o processo — é a **autuação**, e com ela o número SEI. O Anexo VII fecha a
distinção do outro lado: _"A falta da documentação disposta nesta Instrução
Normativa impede a **instauração** do processo"_.

Isso não enfraquece A1; decide-o. Das duas saídas que a análise propõe, a (b) —
criar uma entidade `SolicitacaoProtocolo` anterior ao processo — passa a
contrariar o Art. 5º, porque modelaria como "ainda não é processo" justamente o
que a norma chama de processo desde o protocolo. Fica a (a): `numeroSei`
_nullable_, com `CHECK` exigindo-o a partir da autuação.

**2. O silêncio obriga a decidir.** O parágrafo único do Art. 74 não se limita a
afastar os efeitos da revelia: _"Quando o intimado não apresentar defesa, o
Iteraima **deverá** enfrentar o mérito administrativo e decidir sobre o
deferimento ou indeferimento (…) de forma motivada"_. Para o modelo, a diferença
importa — não basta poder distinguir "respondeu" de "não respondeu"; a ausência
de manifestação, uma vez vencido o prazo, é um **fato gerador de dever**, e o
sistema precisa saber apontar os processos em que esse dever está pendente.

## O que a norma já respondia sozinha

Ficou registrado em `papeis-rbac.md` §8 que restavam pontos "a confirmar com
quem opera". Um deles a norma responde: **existe, sim, um estado entre o
protocolo e a autuação.** O Art. 49, I manda a DCI receber o requerimento,
aplicar a admissibilidade dos Anexos VII a IX e só então autuar; o parágrafo
único trata o caminho em que a admissibilidade falha, e separa o protocolo
digital — em que o requerente é notificado para complementar — do presencial, que
vai direto à DIPRE. Não é decisão de produto: é rito.

Segue dependendo de gente, e não do texto, quem é a **chefia imediata de cada
setor** — sem essa lista o `gestor` não tem a quem ser atribuído e ninguém
arquiva (Art. 80).
