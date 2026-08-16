import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import {
  MotivoRevogacao,
  OrigemConta,
  Papel,
  type Session,
  type User,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ABSOLUTE_TTL_MS, IDLE_TTL_MS } from './auth.constants.js';
import { SessionService } from './session.service.js';

const sha256 = (v: string): string =>
  createHash('sha256').update(v).digest('hex');

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

function fakeSession(over: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    id: 'hash-qualquer',
    userId: 'user-1',
    createdAt: new Date(now),
    expiresAt: new Date(now + IDLE_TTL_MS),
    absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS),
    revokedAt: null,
    motivo: null,
    ip: null,
    userAgent: null,
    ...over,
  };
}

type CreateFn = (args: unknown) => Promise<Session>;
type FindUniqueFn = (args: {
  where: { id: string };
}) => Promise<(Session & { user: User }) | null>;
type UpdateFn = (args: unknown) => Promise<Session>;
type UpdateManyFn = (args: unknown) => Promise<{ count: number }>;

describe('SessionService', () => {
  let service: SessionService;
  let create: jest.Mock<CreateFn>;
  let findUnique: jest.Mock<FindUniqueFn>;
  let update: jest.Mock<UpdateFn>;
  let updateMany: jest.Mock<UpdateManyFn>;

  beforeEach(async () => {
    create = jest.fn<CreateFn>().mockResolvedValue(fakeSession());
    findUnique = jest.fn<FindUniqueFn>();
    update = jest.fn<UpdateFn>().mockResolvedValue(fakeSession());
    updateMany = jest.fn<UpdateManyFn>().mockResolvedValue({ count: 1 });

    const mod = await Test.createTestingModule({
      providers: [
        SessionService,
        {
          provide: PrismaService,
          useValue: { session: { create, findUnique, update, updateMany } },
        },
      ],
    }).compile();

    service = mod.get(SessionService);
  });

  // -- create -------------------------------------------------------------

  describe('create', () => {
    it('persiste APENAS o hash do token, nunca o token em si', async () => {
      const token = await service.create('user-1');

      const args = create.mock.calls[0]?.[0] as {
        data: { id: string; userId: string };
      };
      expect(args.data.id).toBe(sha256(token));
      expect(args.data.id).not.toBe(token);
      expect(args.data.userId).toBe('user-1');
    });

    it('grava expiresAt/absoluteExpiresAt de acordo com os TTLs configurados', async () => {
      const antes = Date.now();
      await service.create('user-1', '10.0.0.1', 'jest');
      const depois = Date.now();

      const args = create.mock.calls[0]?.[0] as {
        data: {
          expiresAt: Date;
          absoluteExpiresAt: Date;
          ip?: string;
          userAgent?: string;
        };
      };
      expect(args.data.expiresAt.getTime()).toBeGreaterThanOrEqual(
        antes + IDLE_TTL_MS,
      );
      expect(args.data.expiresAt.getTime()).toBeLessThanOrEqual(
        depois + IDLE_TTL_MS,
      );
      expect(args.data.absoluteExpiresAt.getTime()).toBeGreaterThanOrEqual(
        antes + ABSOLUTE_TTL_MS,
      );
      expect(args.data.ip).toBe('10.0.0.1');
      expect(args.data.userAgent).toBe('jest');
    });

    it('devolve um token de 256 bits distinto a cada chamada', async () => {
      const a = await service.create('user-1');
      const b = await service.create('user-1');

      expect(a).not.toEqual(b);
      // base64url de 32 bytes -> 43 caracteres sem padding
      expect(a.length).toBe(43);
    });
  });

  // -- validate -------------------------------------------------------------

  describe('validate', () => {
    it('devolve null para token sem sessão correspondente', async () => {
      findUnique.mockResolvedValue(null);

      expect(await service.validate('token-qualquer')).toBeNull();
    });

    it('devolve null para sessão revogada', async () => {
      findUnique.mockResolvedValue({
        ...fakeSession({ revokedAt: new Date() }),
        user: fakeUser(),
      });

      expect(await service.validate('token')).toBeNull();
    });

    it('devolve null para sessão com IDLE_TTL vencido', async () => {
      findUnique.mockResolvedValue({
        ...fakeSession({ expiresAt: new Date(Date.now() - 1_000) }),
        user: fakeUser(),
      });

      expect(await service.validate('token')).toBeNull();
    });

    it('devolve null para sessão além do teto ABSOLUTO, mesmo com IDLE_TTL válido', async () => {
      findUnique.mockResolvedValue({
        ...fakeSession({
          expiresAt: new Date(Date.now() + IDLE_TTL_MS), // dentro da janela deslizante
          absoluteExpiresAt: new Date(Date.now() - 1_000), // mas o teto já passou
        }),
        user: fakeUser(),
      });

      expect(await service.validate('token')).toBeNull();
    });

    it('revoga e devolve null quando o usuário da sessão está inativo', async () => {
      findUnique.mockResolvedValue({
        ...fakeSession(),
        user: fakeUser({ isActive: false }),
      });

      const r = await service.validate('token');

      expect(r).toBeNull();
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            motivo: MotivoRevogacao.conta_desativada,
          }),
        }),
      );
    });

    it('NÃO renova quando resta mais da metade do IDLE_TTL', async () => {
      findUnique.mockResolvedValue({
        ...fakeSession({ expiresAt: new Date(Date.now() + IDLE_TTL_MS) }), // 100% restante
        user: fakeUser(),
      });

      await service.validate('token');

      expect(update).not.toHaveBeenCalled();
    });

    it('renova a janela deslizante quando resta menos de 50% do IDLE_TTL', async () => {
      findUnique.mockResolvedValue({
        ...fakeSession({
          expiresAt: new Date(Date.now() + IDLE_TTL_MS * 0.1), // 10% restante
          absoluteExpiresAt: new Date(Date.now() + ABSOLUTE_TTL_MS), // teto longe
        }),
        user: fakeUser(),
      });

      await service.validate('token');

      expect(update).toHaveBeenCalledTimes(1);
      const args = update.mock.calls[0]?.[0] as { data: { expiresAt: Date } };
      // renovou para ~agora + IDLE_TTL, não além disso
      expect(args.data.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + IDLE_TTL_MS + 1_000,
      );
    });

    it('nunca renova além do teto absoluto', async () => {
      const absoluto = new Date(Date.now() + 60_000); // teto chega em 1min
      findUnique.mockResolvedValue({
        ...fakeSession({
          expiresAt: new Date(Date.now() + 1_000), // quase vencendo -> dispara renovação
          absoluteExpiresAt: absoluto,
        }),
        user: fakeUser(),
      });

      await service.validate('token');

      const args = update.mock.calls[0]?.[0] as { data: { expiresAt: Date } };
      expect(args.data.expiresAt.getTime()).toBe(absoluto.getTime());
    });
  });

  // -- revogação -------------------------------------------------------------

  describe('revokeByToken / revokeById / revokeAllForUser', () => {
    it('revokeByToken revoga pelo hash do token, nunca pelo token cru', async () => {
      const token = 'token-do-usuario';
      await service.revokeByToken(token, MotivoRevogacao.logout);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: sha256(token), revokedAt: null },
        data: { revokedAt: expect.any(Date), motivo: MotivoRevogacao.logout },
      });
    });

    it('revokeAllForUser afeta só sessões ainda não revogadas do usuário e devolve a contagem', async () => {
      updateMany.mockResolvedValue({ count: 3 });

      const n = await service.revokeAllForUser('user-1', MotivoRevogacao.admin);

      expect(n).toBe(3);
      expect(updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date), motivo: MotivoRevogacao.admin },
      });
    });
  });
});
