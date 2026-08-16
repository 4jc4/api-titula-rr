export const SESSION_COOKIE = 'session';
export const IDLE_TTL_MS = 8 * 60 * 60 * 1000; // 8h de inatividade
export const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // teto de 7 dias
export const RENEW_THRESHOLD = 0.5; // renova quando restar < 50% do IDLE_TTL
export const AD_RECHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 min
export const AD_FAIL_OPEN_TTL_MS = 4 * 60 * 60 * 1000; // 4h sem contato com o DC

// Retenção de sessões mortas (expiradas ou revogadas) antes do job de
// limpeza apagar — não some na hora: dá margem pra auditoria/suporte
// consultarem "essa sessão existiu e foi revogada quando/por quê" por um
// tempo, sem deixar a tabela crescer pra sempre.
export const SESSION_CLEANUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
