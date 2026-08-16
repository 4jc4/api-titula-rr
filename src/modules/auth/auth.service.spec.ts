import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  OrigemConta,
  Papel,
  type User,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { CREDENTIAL_VALIDATOR } from './credential-validator.js';
import { SessionService } from './session.service.js';
import { LocalValidator } from './validators/local.validator.js';

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

type FindUniqueFn = (args: {
  where: { username: string };
}) => Promise<User | null>;
type UpsertFn = (args: unknown) => Promise<User>;
type LocalValidateFn = (
  username: string,
  password: string,
) => ReturnType<LocalValidator['validate']>;
type RemoteValidateFn = (
  username: string,
  password: string,
) => ReturnType<LocalValidator['validate']>;
type SessionCreateFn = (
  userId: string,
  ip?: string,
  userAgent?: string,
) => Promise<string>;

describe('AuthService.login', () => {
  let service: AuthService;
  let findUnique: jest.Mock<FindUniqueFn>;
  let upsert: jest.Mock<UpsertFn>;
  let localValidate: jest.Mock<LocalValidateFn>;
  let remoteValidate: jest.Mock<RemoteValidateFn>;
  let sessionCreate: jest.Mock<SessionCreateFn>;

  beforeEach(async () => {
    findUnique = jest.fn<FindUniqueFn>().mockResolvedValue(null);
    upsert = jest.fn<UpsertFn>();
    localValidate = jest.fn<LocalValidateFn>();
    remoteValidate = jest.fn<RemoteValidateFn>();
    sessionCreate = jest.fn<SessionCreateFn>().mockResolvedValue('token-fake');

    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: { user: { findUnique, upsert } } },
        { provide: SessionService, useValue: { create: sessionCreate } },
        { provide: LocalValidator, useValue: { validate: localValidate } },
        {
          provide: CREDENTIAL_VALIDATOR,
          useValue: { validate: remoteValidate },
        },
      ],
    }).compile();

    service = mod.get(AuthService);
  });

  // -- conta LOCAL (break-glass) ---------------------------------------------

  describe('conta LOCAL', () => {
    it('valida SEMPRE localmente, nunca chama a fonte remota', async () => {
      const local = fakeUser({ origem: OrigemConta.LOCAL });
      findUnique.mockResolvedValue(local);
      localValidate.mockResolvedValue({
        name: local.name,
        email: local.email,
        cpf: local.cpf,
        papeis: local.papeis,
      });

      await service.login('resgate.local', 'senha-break-glass');

      expect(localValidate).toHaveBeenCalledWith(
        'resgate.local',
        'senha-break-glass',
      );
      expect(remoteValidate).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled(); // conta LOCAL não é espelhada
    });

    it('rejeita senha local incorreta', async () => {
      findUnique.mockResolvedValue(fakeUser({ origem: OrigemConta.LOCAL }));
      localValidate.mockResolvedValue(null);

      await expect(
        service.login('resgate.local', 'senha-errada'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejeita conta LOCAL desativada mesmo com senha correta', async () => {
      const local = fakeUser({ origem: OrigemConta.LOCAL, isActive: false });
      findUnique.mockResolvedValue(local);
      localValidate.mockResolvedValue({
        name: local.name,
        email: local.email,
        cpf: local.cpf,
        papeis: local.papeis,
      });

      await expect(
        service.login('resgate.local', 'senha-break-glass'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // -- fonte remota (AD/fake) ------------------------------------------------

  describe('fonte remota', () => {
    it('rejeita credencial inválida sem tocar o banco', async () => {
      remoteValidate.mockResolvedValue(null);

      await expect(service.login('fulano', 'errada')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(upsert).not.toHaveBeenCalled();
    });

    it('rejeita quem existe na fonte mas não tem papel algum', async () => {
      remoteValidate.mockResolvedValue({
        name: 'Sem Grupo',
        email: null,
        cpf: null,
        papeis: [],
      });

      await expect(service.login('sem.grupo', 'dev')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(upsert).not.toHaveBeenCalled();
    });

    it('provisiona (upsert) o usuário espelhado e cria a sessão', async () => {
      remoteValidate.mockResolvedValue({
        name: 'Fulano de Teste',
        email: 'fulano@dev.local',
        cpf: '00000000191',
        papeis: [Papel.gestor],
      });
      const provisionado = fakeUser({
        name: 'Fulano de Teste',
        email: 'fulano@dev.local',
        cpf: '00000000191',
        papeis: [Papel.gestor],
      });
      upsert.mockResolvedValue(provisionado);

      const r = await service.login('fulano', 'dev', '10.0.0.1', 'jest');

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { username: 'fulano' },
          create: expect.objectContaining({
            username: 'fulano',
            papeis: [Papel.gestor],
          }),
          update: expect.objectContaining({ papeis: [Papel.gestor] }),
        }),
      );
      expect(sessionCreate).toHaveBeenCalledWith(
        provisionado.id,
        '10.0.0.1',
        'jest',
      );
      expect(r).toEqual({
        token: 'token-fake',
        user: {
          id: provisionado.id,
          username: provisionado.username,
          name: provisionado.name,
          email: provisionado.email,
          papeis: provisionado.papeis,
        },
      });
      // a forma pública nunca carrega passwordHash/cpf
      expect(r.user).not.toHaveProperty('passwordHash');
      expect(r.user).not.toHaveProperty('cpf');
    });

    it('rejeita usuário já espelhado mas desativado no banco local', async () => {
      remoteValidate.mockResolvedValue({
        name: 'Fulano',
        email: null,
        cpf: null,
        papeis: [Papel.gestor],
      });
      upsert.mockResolvedValue(fakeUser({ isActive: false }));

      await expect(service.login('fulano', 'dev')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionCreate).not.toHaveBeenCalled();
    });
  });
});
