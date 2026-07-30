import type { Papel } from '../../generated/prisma/client.js';

// -- Permissões do sistema ----------------------------------------------------
// Toda permissão existente no sistema é declarada AQUI. Um typo em qualquer
// outro lugar (matriz, @RequirePermission) não compila.
export const PERMISSOES_DISPONIVEIS = [
  'usuario:listar',
  'sessao:revogar',
  // as permissões de domínio (titulo:*, processo:*, ...) entram com os
  // respectivos módulos — sempre adicionadas aqui primeiro
] as const;

export type Permissao = (typeof PERMISSOES_DISPONIVEIS)[number];

// -- Matriz papel -> permissões ----------------------------------------------
// DECISÃO DE ARQUITETURA: a matriz vive em código, não no banco.
//   - erro de digitação não compila (`satisfies` cobra as 10 entradas e só
//     aceita permissões declaradas acima)
//   - mudar acesso é um commit revisado -> git é a trilha de auditoria
//   - o guard resolve em memória, sem consulta extra
// Papéis são exclusivos (1 por pessoa); cada linha é o conjunto COMPLETO
// do papel — não há herança. Sobreposição se expressa por reuso de
// constantes TS, nunca por curinga: o `administrador` enumera tudo
// explicitamente (permissão nova só entra nele por commit, nunca em silêncio).
export const MATRIZ_PERMISSOES = {
  atendimento: [],
  financeiro: [],
  titulacao: [],
  informatica: [],
  planejamento: [],
  governanca: [],
  presidencia: [],
  colaborador: [],
  gestor: ['usuario:listar'],
  administrador: ['usuario:listar', 'sessao:revogar'],
} as const satisfies Record<Papel, readonly Permissao[]>;

// União das permissões de todos os papéis do usuário (Papel[] é folga
// estrutural — com 1 papel, vira um lookup simples).
export function temPermissao(
  papeis: readonly Papel[],
  permissao: Permissao,
): boolean {
  return papeis.some((papel) =>
    (MATRIZ_PERMISSOES[papel] as readonly Permissao[]).includes(permissao),
  );
}
