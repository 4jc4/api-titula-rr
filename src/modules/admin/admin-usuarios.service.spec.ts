import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import {
  OrigemConta,
  Papel,
  type User,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SessionService } from '../auth/session.service.js';
import { AdminUsuariosService } from './admin-usuarios.service.js';

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

type FindManyFn = (args: unknown) => Promise<User[]>;
type CountFn = () => Promise<number>;

describe('AdminUsuariosService.listar', () => {
  let service: AdminUsuariosService;
  let findMany: jest.Mock<FindManyFn>;
  let count: jest.Mock<CountFn>;

  beforeEach(async () => {
    findMany = jest.fn<FindManyFn>().mockResolvedValue([]);
    count = jest.fn<CountFn>().mockResolvedValue(0);

    const mod = await Test.createTestingModule({
      providers: [
        AdminUsuariosService,
        { provide: PrismaService, useValue: { user: { findMany, count } } },
        { provide: SessionService, useValue: {} },
      ],
    }).compile();

    service = mod.get(AdminUsuariosService);
  });

  it('traduz page/pageSize em skip/take', async () => {
    await service.listar(3, 10);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it('primeira página não pula nenhum registro', async () => {
    await service.listar(1, 20);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it('devolve os itens serializados junto com total/page/pageSize', async () => {
    findMany.mockResolvedValue([
      fakeUser({ id: 'a', username: 'a' }),
      fakeUser({ id: 'b', username: 'b', papeis: [Papel.administrador] }),
    ]);
    count.mockResolvedValue(42);

    const result = await service.listar(2, 5);

    expect(result).toEqual({
      items: [
        expect.objectContaining({ id: 'a', username: 'a' }),
        expect.objectContaining({ id: 'b', papeis: [Papel.administrador] }),
      ],
      total: 42,
      page: 2,
      pageSize: 5,
    });
    // toPublicUser corta os campos sensíveis — trava isso aqui também.
    for (const item of result.items) {
      expect(item).not.toHaveProperty('passwordHash');
      expect(item).not.toHaveProperty('cpf');
    }
  });
});
