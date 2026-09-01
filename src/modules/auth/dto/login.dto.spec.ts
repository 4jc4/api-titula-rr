import { describe, expect, it } from '@jest/globals';
import { loginSchema } from './login.dto.js';

// A normalização do username é a primeira coisa que toca a credencial do
// usuário, e ela roda antes de qualquer log. Estes testes travam as três
// formas que a pessoa digita e o caso que passava despercebido.

describe('loginSchema', () => {
  const parse = (username: string) =>
    loginSchema.safeParse({ username, password: 'x' });

  it('normaliza para minúsculas e sem espaços', () => {
    const r = parse('  FULANO  ');
    expect(r.success && r.data.username).toBe('fulano');
  });

  it('descarta o sufixo UPN', () => {
    const r = parse('fulano@intranet.iteraima.rr.gov.br');
    expect(r.success && r.data.username).toBe('fulano');
  });

  it('descarta o domínio no formato NetBIOS', () => {
    const r = parse('ITERAIMA\\fulano');
    expect(r.success && r.data.username).toBe('fulano');
  });

  it('recusa o que fica vazio DEPOIS da normalização', () => {
    // O min(1) roda antes do transform, então '@dominio' passava por ele e
    // chegava vazio ao validator — virando um bind `@dominio` no AD.
    const r = parse('@intranet.iteraima.rr.gov.br');
    expect(r.success).toBe(false);
    // narrowing explícito: SafeParseResult é união discriminada, `error` não
    // existe no ramo de sucesso
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(['username']);
    }
  });

  it('recusa username vazio', () => {
    expect(parse('').success).toBe(false);
  });

  it('recusa senha vazia', () => {
    expect(
      loginSchema.safeParse({ username: 'fulano', password: '' }).success,
    ).toBe(false);
  });
});
