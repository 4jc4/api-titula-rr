export const SESSION_COOKIE = 'session';
export const IDLE_TTL_MS = 8 * 60 * 60 * 1000; // 8h de inatividade
export const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // teto de 7 dias
export const RENEW_THRESHOLD = 0.5; // renova quando restar < 50% do IDLE_TTL
export const AD_RECHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 min
export const AD_FAIL_OPEN_TTL_MS = 4 * 60 * 60 * 1000; // 4h sem contato com o DC
