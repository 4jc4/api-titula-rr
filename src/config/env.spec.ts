import { describe, expect, it } from '@jest/globals';
import { parseEnv } from './env.js';

// parseEnv é a metade pura de validateEnv() — sem process.exit(), dá pra
// testar a regra do superRefine (AUTH_VALIDATOR=ad exige o resto do AD_*)
// sem matar o processo do Jest.

const baseValida = { DATABASE_URL: 'postgresql://user:pass@host:5432/db' };

describe('parseEnv', () => {
  it('aceita o mínimo (DATABASE_URL) e aplica os defaults', () => {
    const result = parseEnv(baseValida);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.NODE_ENV).toBe('development');
    expect(result.data.PORT).toBe(3000);
    expect(result.data.AUTH_VALIDATOR).toBe('fake');
  });

  it('rejeita sem DATABASE_URL', () => {
    const result = parseEnv({});

    expect(result.success).toBe(false);
  });

  it('rejeita DATABASE_URL que não é uma URL', () => {
    const result = parseEnv({ DATABASE_URL: 'nao-e-uma-url' });

    expect(result.success).toBe(false);
  });

  it('coerciona PORT de string para number', () => {
    const result = parseEnv({ ...baseValida, PORT: '4000' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.PORT).toBe(4000);
  });

  // -- regra cruzada: AUTH_VALIDATOR=ad exige o resto do AD_* --------------

  it('aceita AUTH_VALIDATOR=fake sem nenhuma config de AD', () => {
    const result = parseEnv({ ...baseValida, AUTH_VALIDATOR: 'fake' });

    expect(result.success).toBe(true);
  });

  it('rejeita AUTH_VALIDATOR=ad sem a config de AD', () => {
    const result = parseEnv({ ...baseValida, AUTH_VALIDATOR: 'ad' });

    expect(result.success).toBe(false);
    if (result.success) return;
    const campos = result.error.issues.map((i) => i.path[0]);
    expect(campos).toEqual(
      expect.arrayContaining([
        'AD_URL',
        'AD_BASE_DN',
        'AD_UPN_SUFFIX',
        'AD_BIND_DN',
        'AD_BIND_PASSWORD',
      ]),
    );
    // AD_CA_PATH é opcional mesmo com AUTH_VALIDATOR=ad (raiz de CA custom)
    expect(campos).not.toContain('AD_CA_PATH');
  });

  it('aceita AUTH_VALIDATOR=ad com toda a config de AD presente', () => {
    const result = parseEnv({
      ...baseValida,
      AUTH_VALIDATOR: 'ad',
      AD_URL: 'ldaps://dc.example.invalid',
      AD_BASE_DN: 'DC=example,DC=invalid',
      AD_UPN_SUFFIX: 'example.invalid',
      AD_BIND_DN: 'svc@example.invalid',
      AD_BIND_PASSWORD: 'dummy',
    });

    expect(result.success).toBe(true);
  });

  it('rejeita AUTH_VALIDATOR=ad com só parte da config de AD', () => {
    const result = parseEnv({
      ...baseValida,
      AUTH_VALIDATOR: 'ad',
      AD_URL: 'ldaps://dc.example.invalid',
      // faltam AD_BASE_DN, AD_UPN_SUFFIX, AD_BIND_DN, AD_BIND_PASSWORD
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const campos = result.error.issues.map((i) => i.path[0]);
    expect(campos).not.toContain('AD_URL');
    expect(campos).toEqual(
      expect.arrayContaining([
        'AD_BASE_DN',
        'AD_UPN_SUFFIX',
        'AD_BIND_DN',
        'AD_BIND_PASSWORD',
      ]),
    );
  });
});
