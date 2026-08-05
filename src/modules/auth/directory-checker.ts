import type { Papel } from '../../generated/prisma/client.js';

// Resultado da reverificação. Três estados DISTINTOS de propósito:
//   ativo        -> a conta existe, está habilitada; papeis = os atuais
//   inativo      -> conta desabilitada, removida, ou sem grupo TITULA_*
//                   (decisão do AD -> revogar sessões)
//   indisponivel -> não deu para perguntar ao DC (fail-open com teto)
export type StatusDiretorio =
  | { estado: 'ativo'; papeis: Papel[] }
  | { estado: 'inativo' }
  | { estado: 'indisponivel' };

export interface DirectoryChecker {
  // NUNCA lança: indisponibilidade é um estado de retorno, não exceção.
  verificar(username: string): Promise<StatusDiretorio>;
}

export const DIRECTORY_CHECKER = Symbol('DIRECTORY_CHECKER');
