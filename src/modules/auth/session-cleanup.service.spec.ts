import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { SESSION_CLEANUP_RETENTION_MS } from './auth.constants.js';
import { SessionCleanupService } from './session-cleanup.service.js';
import { SessionService } from './session.service.js';

type DeleteDeadOlderThanFn = (retencaoMs: number) => Promise<number>;

describe('SessionCleanupService', () => {
  let service: SessionCleanupService;
  let deleteDeadOlderThan: jest.Mock<DeleteDeadOlderThanFn>;
  let info: jest.Mock;

  beforeEach(async () => {
    deleteDeadOlderThan = jest.fn<DeleteDeadOlderThanFn>();
    info = jest.fn();

    const mod = await Test.createTestingModule({
      providers: [
        SessionCleanupService,
        { provide: SessionService, useValue: { deleteDeadOlderThan } },
        {
          provide: PinoLogger,
          useValue: { setContext: jest.fn(), info },
        },
      ],
    }).compile();

    service = mod.get(SessionCleanupService);
  });

  it('apaga usando a retenção configurada', async () => {
    deleteDeadOlderThan.mockResolvedValue(0);

    await service.limpar();

    expect(deleteDeadOlderThan).toHaveBeenCalledWith(
      SESSION_CLEANUP_RETENTION_MS,
    );
  });

  it('loga quando apaga alguma sessão', async () => {
    deleteDeadOlderThan.mockResolvedValue(5);

    await service.limpar();

    expect(info).toHaveBeenCalledWith(
      { apagadas: 5 },
      expect.stringContaining('removidas'),
    );
  });

  it('não loga quando não há nada pra apagar', async () => {
    deleteDeadOlderThan.mockResolvedValue(0);

    await service.limpar();

    expect(info).not.toHaveBeenCalled();
  });
});
