import { describe, expect, it, jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { Papel } from '../../generated/prisma/client.js';
import { PermissionGuard } from './permission.guard.js';
import type { PublicUser } from './user-public.js';

function fakeReflector(exigida: string | undefined): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(exigida),
  } as unknown as Reflector;
}

function fakeContext(req: { user?: PublicUser }): ExecutionContext {
  return {
    getHandler: () => ({}) as unknown,
    getClass: () => ({}) as unknown,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function fakePublicUser(papeis: Papel[]): PublicUser {
  return {
    id: 'user-1',
    username: 'fulano.teste',
    name: 'Fulano de Teste',
    email: null,
    papeis,
  };
}

describe('PermissionGuard', () => {
  it('libera rota sem @RequirePermission independente do usuário', () => {
    const guard = new PermissionGuard(fakeReflector(undefined));

    expect(guard.canActivate(fakeContext({}))).toBe(true);
  });

  it('nega com 403 quando não há usuário no request (sessão não passou antes)', () => {
    const guard = new PermissionGuard(fakeReflector('usuario:listar'));

    expect(() => guard.canActivate(fakeContext({}))).toThrow(
      ForbiddenException,
    );
  });

  it('nega com 403 quando o papel do usuário não tem a permissão exigida', () => {
    const guard = new PermissionGuard(fakeReflector('sessao:revogar'));
    const req = { user: fakePublicUser([Papel.gestor]) }; // gestor não tem sessao:revogar

    expect(() => guard.canActivate(fakeContext(req))).toThrow(
      ForbiddenException,
    );
  });

  it('libera quando algum papel do usuário cobre a permissão exigida', () => {
    const guard = new PermissionGuard(fakeReflector('usuario:listar'));
    const req = { user: fakePublicUser([Papel.gestor]) };

    expect(guard.canActivate(fakeContext(req))).toBe(true);
  });

  it('administrador libera para as duas permissões existentes', () => {
    const req = { user: fakePublicUser([Papel.administrador]) };

    expect(
      new PermissionGuard(fakeReflector('usuario:listar')).canActivate(
        fakeContext(req),
      ),
    ).toBe(true);
    expect(
      new PermissionGuard(fakeReflector('sessao:revogar')).canActivate(
        fakeContext(req),
      ),
    ).toBe(true);
  });
});
