import { Papel } from '../../generated/prisma/client.js';

// CONTRATO COM A TI: os grupos no AD chamam-se TITULA_<PAPEL>
// (TITULA_FINANCEIRO, TITULA_TITULACAO, ...). Mudou o nome lá, muda aqui.
export const PREFIXO_GRUPO = 'TITULA_';

export interface ResultadoMapeamento {
  papeis: Papel[];
  // Grupos TITULA_* cujo sufixo NÃO é um papel conhecido (typo da TI ao
  // criar o grupo). O chamador loga warn — não é motivo de bloqueio.
  desconhecidos: string[];
}

// FUNÇÃO PURA: recebe os DNs do memberOf, devolve papéis + anomalias.
// Sem LDAP, sem logger, sem banco — 100% testável por unidade.
// Regra de negócio embutida: grupo fora do prefixo é ignorado em silêncio
// (VPN_USERS etc. não são assunto nosso); sufixo desconhecido é anomalia
// reportada; papel duplicado é deduplicado.
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
    if (codigo in Papel) {
      papeis.add(Papel[codigo as keyof typeof Papel]);
    } else {
      desconhecidos.push(cn);
    }
  }

  return { papeis: [...papeis], desconhecidos };
}
