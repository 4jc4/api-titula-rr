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
    const req = { user: fakePublicUser([Papel.gestor]) }; // gestor não mexe em conta

    expect(() => guard.canActivate(fakeContext(req))).toThrow(
      ForbiddenException,
    );
  });

  it('libera quando algum papel do usuário cobre a permissão exigida', () => {
    const guard = new PermissionGuard(fakeReflector('usuario:listar'));
    const req = { user: fakePublicUser([Papel.administrador]) };

    expect(guard.canActivate(fakeContext(req))).toBe(true);
  });

  // Art. 80: quem arquiva é a chefia imediata, não o setor. Estes dois
  // testes travam a decisão de `gestor` ser NÍVEL somado ao papel de setor —
  // é a única permissão que depende da união do array para existir.
  it('a união do array cobre a permissão que só a chefia tem', () => {
    const guard = new PermissionGuard(fakeReflector('processo:arquivar'));
    const chefe = { user: fakePublicUser([Papel.governanca, Papel.gestor]) };

    expect(guard.canActivate(fakeContext(chefe))).toBe(true);
  });

  it('o papel de setor sozinho não arquiva', () => {
    const guard = new PermissionGuard(fakeReflector('processo:arquivar'));
    const analista = { user: fakePublicUser([Papel.governanca]) };

    expect(() => guard.canActivate(fakeContext(analista))).toThrow(
      ForbiddenException,
    );
  });

  it('administrador cobre as permissões de sistema', () => {
    const req = { user: fakePublicUser([Papel.administrador]) };

    for (const permissao of [
      'usuario:listar',
      'sessao:revogar',
      'parametro:editar',
    ]) {
      expect(
        new PermissionGuard(fakeReflector(permissao)).canActivate(
          fakeContext(req),
        ),
      ).toBe(true);
    }
  });

  // O cidadão tem 'processo:ler', mas escopado ao próprio dossiê — e o guard
  // NÃO sabe de escopo de linha. Este teste existe para documentar isso: ele
  // passa, e passar é exatamente o motivo de o filtro por interessado ser
  // obrigatório no ProcessoService.
  it('libera o cidadão em processo:ler — o escopo de linha NÃO é aqui', () => {
    const guard = new PermissionGuard(fakeReflector('processo:ler'));
    const req = { user: fakePublicUser([Papel.cidadao]) };

    expect(guard.canActivate(fakeContext(req))).toBe(true);
  });
});
