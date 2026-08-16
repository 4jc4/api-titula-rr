import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import {
  OrigemConta,
  Papel,
  type User,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { LocalValidator } from './local.validator.js';

function fakeUser(over: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'resgate.local',
    name: 'Conta de Resgate',
    email: null,
    cpf: null,
    papeis: [Papel.administrador],
    origem: OrigemConta.LOCAL,
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

describe('LocalValidator', () => {
  let validator: LocalValidator;
  let findUnique: jest.Mock<FindUniqueFn>;
  // hash real — o caminho break-glass é a porta de entrada quando o AD está
  // fora do ar, então o teste verifica argon2 de verdade, não um mock.
  let hashValido: string;

  beforeAll(async () => {
    hashValido = await argon2.hash('senha-break-glass-forte');
  });

  beforeEach(async () => {
    findUnique = jest.fn<FindUniqueFn>();

    const mod = await Test.createTestingModule({
      providers: [
        LocalValidator,
        { provide: PrismaService, useValue: { user: { findUnique } } },
      ],
    }).compile();

    validator = mod.get(LocalValidator);
  });

  it('valida a senha correta contra o hash argon2 e devolve a identidade', async () => {
    findUnique.mockResolvedValue(
      fakeUser({ passwordHash: hashValido, name: 'Conta de Resgate' }),
    );

    const r = await validator.validate(
      'resgate.local',
      'senha-break-glass-forte',
    );

    expect(r).toEqual({
      name: 'Conta de Resgate',
      email: null,
      cpf: null,
      papeis: [Papel.administrador],
    });
  });

  it('rejeita senha incorreta', async () => {
    findUnique.mockResolvedValue(fakeUser({ passwordHash: hashValido }));

    const r = await validator.validate('resgate.local', 'senha-errada');

    expect(r).toBeNull();
  });

  it('devolve null quando o usuário não existe', async () => {
    findUnique.mockResolvedValue(null);

    const r = await validator.validate('inexistente', 'qualquer');

    expect(r).toBeNull();
  });

  it('NUNCA valida conta origem=AD por aqui, mesmo com senha certa e hash presente', async () => {
    // não deveria existir na prática (CHECK do banco: origem=LOCAL <=>
    // passwordHash IS NOT NULL) — defensivo mesmo assim.
    findUnique.mockResolvedValue(
      fakeUser({ origem: OrigemConta.AD, passwordHash: hashValido }),
    );

    const r = await validator.validate(
      'resgate.local',
      'senha-break-glass-forte',
    );

    expect(r).toBeNull();
  });

  it('devolve null para conta LOCAL sem passwordHash (nunca deveria existir, mas não quebra)', async () => {
    findUnique.mockResolvedValue(fakeUser({ passwordHash: null }));

    const r = await validator.validate('resgate.local', 'qualquer');

    expect(r).toBeNull();
  });
});
