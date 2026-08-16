import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  DIRECTORY_CHECKER,
  type StatusDiretorio,
} from '../auth/directory-checker.js';
import { HealthService } from './health.service.js';

type QueryRawFn = () => Promise<unknown>;
type VerificarFn = (username: string) => Promise<StatusDiretorio>;

// Monta o service com os três colaboradores mockados. Recebe as respostas
// PRONTAS (não expõe os mocks vazios pra fora) — evita o erro clássico de
// configurar um jest.fn() e só depois descobrir que o Nest injetou outra
// instância dele.
async function build(
  authValidator: Env['AUTH_VALIDATOR'],
  opts: {
    banco?: 'ok' | 'fora';
    diretorio?: StatusDiretorio;
  } = {},
): Promise<{
  service: HealthService;
  queryRaw: jest.Mock<QueryRawFn>;
  verificar: jest.Mock<VerificarFn>;
}> {
  const queryRaw = jest.fn<QueryRawFn>();
  if (opts.banco === 'fora') {
    queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
  } else {
    queryRaw.mockResolvedValue([{ 1: 1 }]);
  }

  const verificar = jest
    .fn<VerificarFn>()
    .mockResolvedValue(opts.diretorio ?? { estado: 'ativo', papeis: [] });

  const mod = await Test.createTestingModule({
    providers: [
      HealthService,
      { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      { provide: ConfigService, useValue: { get: () => authValidator } },
      { provide: DIRECTORY_CHECKER, useValue: { verificar } },
    ],
  }).compile();

  return { service: mod.get(HealthService), queryRaw, verificar };
}

describe('HealthService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // -- banco -------------------------------------------------------------

  it('status ok quando o banco responde e o AD está desligado (fake)', async () => {
    const { service, verificar } = await build('fake');

    const r = await service.getStatus();

    expect(r.database).toBe('connected');
    expect(r.directory).toBe('disabled');
    expect(r.status).toBe('ok');
    expect(verificar).not.toHaveBeenCalled(); // AUTH_VALIDATOR != 'ad' -> nem pergunta
  });

  it('status down quando o banco não responde, mesmo com AD saudável', async () => {
    const { service } = await build('ad', { banco: 'fora' });

    const r = await service.getStatus();

    expect(r.database).toBe('disconnected');
    expect(r.status).toBe('down');
  });

  // -- diretório -----------------------------------------------------------

  it('sonda o diretório com um username sentinela quando AUTH_VALIDATOR=ad', async () => {
    const { service, verificar } = await build('ad');

    await service.getStatus();

    expect(verificar).toHaveBeenCalledWith('__healthcheck__');
  });

  it('status degraded quando o banco está ok mas o diretório está inalcançável', async () => {
    const { service } = await build('ad', {
      diretorio: { estado: 'indisponivel' },
    });

    const r = await service.getStatus();

    expect(r.database).toBe('connected');
    expect(r.directory).toBe('unreachable');
    expect(r.status).toBe('degraded');
  });

  it('trata qualquer estado que não seja "indisponivel" como diretório alcançável', async () => {
    const { service } = await build('ad', {
      diretorio: { estado: 'ativo', papeis: [] },
    });

    const r = await service.getStatus();

    expect(r.directory).toBe('reachable');
    expect(r.status).toBe('ok');
  });

  // -- cache da sonda --------------------------------------------------------

  it('cacheia o resultado da sonda por 30s — não bate no AD a cada request', async () => {
    const { service, verificar } = await build('ad');

    await service.getStatus();
    await service.getStatus();
    await service.getStatus();

    expect(verificar).toHaveBeenCalledTimes(1);
  });

  it('sonda de novo depois que o cache de 30s expira', async () => {
    jest.useFakeTimers();
    const { service, verificar } = await build('ad');

    await service.getStatus();
    jest.advanceTimersByTime(30_001);
    await service.getStatus();

    expect(verificar).toHaveBeenCalledTimes(2);
  });
});
