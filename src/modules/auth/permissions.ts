import type { Papel } from '../../generated/prisma/client.js';

// -- Permissões do sistema ----------------------------------------------------
// Toda permissão existente no sistema é declarada AQUI. Um typo em qualquer
// outro lugar (matriz, @RequirePermission) não compila.
//
// O recorte é o núcleo processual da IN 002/2026: cada linha existe porque
// um artigo atribui aquele ato a alguém. Os atos do Capítulo VIII (emissão
// do instrumento, VTN, parcelas, cláusulas resolutivas) entram com o módulo
// próprio — e entram aqui primeiro.
export const PERMISSOES_DISPONIVEIS = [
  // -- sistema ---------------------------------------------------------------
  'usuario:listar',
  'sessao:revogar',
  'parametro:ler',
  'parametro:editar',

  // -- processo --------------------------------------------------------------
  'processo:criar', // Art. 5º
  'processo:ler',
  'processo:admissibilidade', // Art. 49, I
  'processo:autuar', // Art. 7º — exclusivo da DCI
  'processo:relacionar', // Arts. 13-15
  'processo:sobrestar',
  'processo:decidir', // deferir/indeferir — Arts. 45 e 59
  'processo:arquivar', // Art. 80 — só a chefia imediata
  'processo:desarquivar', // Art. 56, IV
  'processo:anular', // Art. 73 — fraude
  'processo:avocar', // Arts. 60 e 79 — privativo do Presidente

  // -- partes e imóvel -------------------------------------------------------
  'pessoa:ler',
  'pessoa:editar',
  'imovel:ler',
  'imovel:editar',
  'geometria:editar', // perímetro — só a DIGOF

  // -- documentos ------------------------------------------------------------
  'documento:ler',
  'documento:juntar', // Art. 7º — vedado aos demais setores
  'documento:peticionar', // Art. 7º pu — intercorrente, pela parte

  // -- tramitação ------------------------------------------------------------
  'tramitacao:enviar',
  'tramitacao:receber',

  // -- comunicação -----------------------------------------------------------
  'comunicacao:solicitar', // Art. 54, I — o setor técnico pede
  'comunicacao:expedir', // Arts. 52-53 — só a Câmara expede
  'comunicacao:certificar', // Art. 53, III

  // -- financeiro ------------------------------------------------------------
  'debito:emitir', // Anexo X, etapas 1 e 7
  'debito:confirmar', // Art. 56, II — GEORF/CER
  'debito:cancelar',
] as const;

export type Permissao = (typeof PERMISSOES_DISPONIVEIS)[number];

// -- Matriz papel -> permissões ----------------------------------------------
// DECISÃO DE ARQUITETURA: a matriz vive em código, não no banco.
//   - erro de digitação não compila (`satisfies` cobra as 12 entradas e só
//     aceita permissões declaradas acima)
//   - mudar acesso é um commit revisado -> git é a trilha de auditoria
//   - o guard resolve em memória, sem consulta extra
//
// Cada linha é o conjunto COMPLETO do papel — não há herança nem curinga: o
// `administrador` enumera tudo explicitamente (permissão nova só entra nele
// por commit, nunca em silêncio).
//
// A soma acontece no ARRAY do usuário, não na matriz: `gestor` é nível de
// chefia (Art. 80) e se combina com um papel de setor — ['governanca',
// 'gestor'] tem a união das duas linhas, via temPermissao().
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
  // Ato próprio só no Cap. VIII (Art. 49, IX). No núcleo, leitura.
  titulacao: [
    'processo:ler',
    'pessoa:ler',
    'imovel:ler',
    'documento:ler',
    'tramitacao:enviar',
    'tramitacao:receber',
    'parametro:ler',
  ],
  // Ato próprio só no Cap. VIII (Art. 49, XI). No núcleo, leitura.
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
  // Só a chefia imediata autoriza o arquivamento (Art. 80).
  gestor: ['processo:arquivar'],
  // `usuario:listar` mora aqui, e não em `gestor`: chefia imediata é
  // autoridade sobre processo, não sobre contas.
  administrador: [
    'usuario:listar',
    'sessao:revogar',
    'parametro:ler',
    'parametro:editar',
  ],
  // ESCOPADAS AO PRÓPRIO DOSSIÊ. O PermissionGuard responde sim/não sobre a
  // permissão e NÃO sabe de escopo de linha: 'processo:ler' aqui significa
  // "os processos em que sou interessado, cônjuge ou parte", e garantir isso
  // é obrigação do filtro no ProcessoService, não deste arquivo. Sem esse
  // filtro, a linha abaixo abre o acervo inteiro para qualquer requerente.
  cidadao: [
    'processo:criar',
    'processo:ler',
    'documento:ler',
    'documento:peticionar',
  ],
} as const satisfies Record<Papel, readonly Permissao[]>;

// União das permissões de todos os papéis do usuário. O array costuma ter um
// papel de setor e, na chefia, mais o `gestor` — é aqui que a soma do Art. 80
// acontece.
export function temPermissao(
  papeis: readonly Papel[],
  permissao: Permissao,
): boolean {
  return papeis.some((papel) =>
    (MATRIZ_PERMISSOES[papel] as readonly Permissao[]).includes(permissao),
  );
}
