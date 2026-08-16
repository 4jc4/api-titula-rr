import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  OrigemConta,
  Papel,
  type Session,
  type User,
} from '../../generated/prisma/client.js';
import type { AdRecheckService } from './ad-recheck.service.js';
import { SESSION_COOKIE } from './auth.constants.js';
import { SessionGuard } from './session.guard.js';
import type { SessionService } from './session.service.js';

function fakeUser(over: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'fulano.teste',
    name: 'Fulano de Teste',
    email: null,
    cpf: null,
    papeis: [Papel.titulacao],
    origem: OrigemConta.AD,
    passwordHash: null,
    adVerifiedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function fakeSessionComUser(user: User, over: Partial<Session> = {}) {
  return {
    id: 'hash-da-sessao',
    userId: user.id,
    createdAt: new Date(),
    expiresAt: new Date(),
    absoluteExpiresAt: new Date(),
    revokedAt: null,
    motivo: null,
    ip: null,
    userAgent: null,
    ...over,
    user,
  };
}

// Reflector fake: só o que o guard lê (getAllAndOverride, pra @Public()).
function fakeReflector(isPublic: boolean): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
}

// ExecutionContext mínimo — só o que o guard usa: handler/classe (repassados
// ao Reflector) e o Request (cookies), onde req.user/sessionId são gravados.
function fakeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}) as unknown,
    getClass: () => ({}) as unknown,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

type ValidateFn = (token: string) => Promise<(Session & { user: User }) | null>;
type GarantirVerificadoFn = (
  user: User,
) => Promise<{ liberado: boolean; user: User }>;

describe('SessionGuard', () => {
  let validate: jest.Mock<ValidateFn>;
  let garantirVerificado: jest.Mock<GarantirVerificadoFn>;

  const build = (isPublic: boolean) =>
    new SessionGuard(
      fakeReflector(isPublic),
      { validate } as unknown as SessionService,
      { garantirVerificado } as unknown as AdRecheckService,
    );

  beforeEach(() => {
    validate = jest.fn<ValidateFn>();
    garantirVerificado = jest.fn<GarantirVerificadoFn>();
  });

  it('libera direto rotas @Public(), sem olhar cookie nenhum', async () => {
    const guard = build(true);

    await expect(guard.canActivate(fakeContext({ cookies: {} }))).resolves.toBe(
      true,
    );
    expect(validate).not.toHaveBeenCalled();
  });

  it('nega sem cookie de sessão', async () => {
    const guard = build(false);

    await expect(
      guard.canActivate(fakeContext({ cookies: {} })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('nega quando o token não corresponde a uma sessão válida', async () => {
    validate.mockResolvedValue(null);
    const guard = build(false);
    const ctx = fakeContext({
      cookies: { [SESSION_COOKIE]: 'token-invalido' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('nega quando o recheck de AD não libera (conta caiu ou fail-open estourou)', async () => {
    const user = fakeUser();
    validate.mockResolvedValue(fakeSessionComUser(user));
    garantirVerificado.mockResolvedValue({ liberado: false, user });

    const guard = build(false);
    const ctx = fakeContext({ cookies: { [SESSION_COOKIE]: 'token-valido' } });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('libera e popula req.user/req.sessionId com os papéis pós-recheck', async () => {
    const user = fakeUser({ papeis: [Papel.titulacao] });
    const atualizado = fakeUser({ papeis: [Papel.gestor] }); // recheck resincronizou
    validate.mockResolvedValue(
      fakeSessionComUser(user, { id: 'hash-da-sessao' }),
    );
    garantirVerificado.mockResolvedValue({ liberado: true, user: atualizado });

    const guard = build(false);
    const req: Record<string, unknown> = {
      cookies: { [SESSION_COOKIE]: 'token-valido' },
    };

    await expect(guard.canActivate(fakeContext(req))).resolves.toBe(true);
    expect(req.user).toMatchObject({
      username: 'fulano.teste',
      papeis: ['gestor'],
    });
    expect(req.sessionId).toBe('hash-da-sessao');
  });
});
