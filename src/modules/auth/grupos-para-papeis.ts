import { Papel } from '../../generated/prisma/client.js';

// CONTRATO COM A TI: os grupos no AD chamam-se TITULA_<PAPEL>
// (TITULA_FINANCEIRO, TITULA_TITULACAO, ...). Mudou o nome lá, muda aqui.
export const PREFIXO_GRUPO = 'TITULA_';

// Papéis que NÃO se provisionam por grupo do AD. Hoje só `cidadao`: ele vem
// do PessoaAcesso (gov.br) e é atribuído pelo validator do Portal, sem passar
// por aqui. Um grupo TITULA_CIDADAO no AD é erro de provisionamento — daria
// acesso de requerente a uma conta interna —, então cai em `desconhecidos`
// para virar warn, nunca papel.
const PAPEIS_FORA_DO_AD: ReadonlySet<string> = new Set<string>([Papel.cidadao]);

export interface ResultadoMapeamento {
  papeis: Papel[];
  // Grupos TITULA_* cujo sufixo NÃO é um papel conhecido (typo da TI ao
  // criar o grupo). O chamador loga warn — não é motivo de bloqueio.
  desconhecidos: string[];
}

// FUNÇÃO PURA: recebe os DNs do memberOf, devolve papéis + anomalias.
// Sem LDAP, sem logger, sem banco — 100% testável por unidade.
// Regra de negócio embutida: grupo fora do prefixo é ignorado em silêncio
// (VPN_USERS etc. não são assunto nosso); sufixo desconhecido — ou papel que
// não se provisiona pelo AD — é anomalia reportada; papel duplicado é
// deduplicado. A FORMA da combinação (um papel de setor, opcionalmente com
// `gestor`) não é validada aqui: quem decide o que fazer com um array
// estranho é o chamador.
export function gruposParaPapeis(
  memberOf: readonly string[],
): ResultadoMapeamento {
  const papeis = new Set<Papel>();
  const desconhecidos: string[] = [];

  for (const dn of memberOf) {
    // DN típico: "CN=TITULA_FINANCEIRO,OU=Grupos,DC=intranet,DC=iteraima,..."
    const cn = /^CN=([^,]+)/i.exec(dn)?.[1];
    if (!cn) continue; // DN malformado — não é grupo, ignora

    if (!cn.toUpperCase().startsWith(PREFIXO_GRUPO)) continue; // não é nosso

    const codigo = cn.slice(PREFIXO_GRUPO.length).toLowerCase();
    if (codigo in Papel && !PAPEIS_FORA_DO_AD.has(codigo)) {
      papeis.add(Papel[codigo as keyof typeof Papel]);
    } else {
      desconhecidos.push(cn);
    }
  }

  return { papeis: [...papeis], desconhecidos };
}
