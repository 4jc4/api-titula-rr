"""Extrai o texto da IN 002/2026 do PDF do Diário Oficial, sem a diagramação.

O PDF é um recorte da edição nº 5166 do DOE-RR (18/05/2026). A camada de texto
traz, em toda página, fragmentos da arte da Imprensa Oficial — às vezes em linha
própria, às vezes empurrados para a margem direita da mesma linha em que a norma
termina uma frase. Este script recorta a partir do cabeçalho da IN e remove esses
fragmentos.

Cuidado deliberado: expressões como "DO ESTADO DE RORAIMA" e "OFICIAL" também
ocorrem no texto legítimo (o preâmbulo qualifica o Presidente do "Instituto de
Terras e Colonização do Estado de Roraima"). Por isso os fragmentos em caixa alta
só são removidos quando aparecem na margem — precedidos de 8 espaços ou mais —
ou sozinhos na linha. As asserções no fim do arquivo existem para pegar
exatamente esse tipo de erro: elas falham se o preâmbulo for mutilado.

Uso: python3 limpa-in.py <entrada.pdf> <saida.txt>
"""
import re, subprocess, sys

pdf, destino = sys.argv[1], sys.argv[2]
bruto = subprocess.run(
    ['pdftotext', '-layout', pdf, '-'],
    check=True, capture_output=True, text=True,
).stdout.splitlines()

# Antes da IN vem o fim de uma portaria de licença médica da mesma edição.
inicio = next(i for i, l in enumerate(bruto)
              if 'INSTRUÇÃO NORMATIVA Nº 002 DE 2026' in l)
linhas = bruto[inicio:]

# Fragmentos que nunca ocorrem no texto da norma: removidos onde quer que estejam.
LIVRE = [re.compile(p) for p in [
    r'Releitura e modernização da marca da Imprensa Oficial do Estado de Roraima',
    r'Diário Oficial do Estado de Roraima - www\.imprensaoficial\.rr\.gov\.br',
    r'Edição N°:\s*5166\s+Boa Vista-RR,.*?Página \d+ de 438',
    r'A proposta traz a representação',
    r'Esses\s+elementos\s+unidos,',
    r'Traz\s+também,\s+subjetivamente\s+os',
]]

# Fragmentos ambíguos: só valem como ruído na margem ou sozinhos na linha.
AMBIGUO = ['DO ESTADO DE RORAIMA', 'IMPRENSA', 'OFICIAL', '1944',
           'Cilindro', 'Guilhotina', 'Sumário', 'Papel', 'Zero', 'Um']
MARGEM = [re.compile(r'\s{8,}' + re.escape(f) + r'(?=\s|$)') for f in AMBIGUO]
SOZINHO = re.compile(r'^\s*(' + '|'.join(re.escape(f) for f in AMBIGUO) + r')\s*$')

saida, vazias = [], 0
for l in linhas:
    if SOZINHO.match(l):
        continue
    for p in LIVRE + MARGEM:
        l = p.sub('', l)
    l = l.rstrip()
    if l.strip():
        vazias = 0
        saida.append(l)
    else:
        vazias += 1
        if vazias == 1:
            saida.append('')

texto = '\n'.join(saida).strip() + '\n'

artigos = len(re.findall(r'(?m)^\s*Art\.\s*\d+', texto))
problemas = []
if artigos != 89:
    problemas.append(f'esperados 89 artigos, encontrados {artigos}')
if 'INSTITUTO DE TERRAS E COLONIZAÇÃO DO ESTADO DE RORAIMA – ITERAIMA' not in texto:
    problemas.append('o preâmbulo foi mutilado pela limpeza')
sobra = [p.pattern for p in LIVRE if p.search(texto)]
if sobra:
    problemas.append(f'ruído remanescente: {sobra}')
if problemas:
    sys.exit('\n'.join(problemas))

with open(destino, 'w', encoding='utf-8') as f:
    f.write(texto)
print(f'{destino}: {len(saida)} linhas, {artigos} artigos, preâmbulo íntegro')
