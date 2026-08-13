import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import type { HealthStatus } from './health.dto.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

function fakeStatus(over: Partial<HealthStatus> = {}): HealthStatus {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: 1,
    database: 'connected',
    directory: 'disabled',
    ...over,
  };
}

type GetStatusFn = () => Promise<HealthStatus>;

describe('HealthController', () => {
  let controller: HealthController;
  let getStatus: jest.Mock<GetStatusFn>;
  let statusMock: jest.Mock<(code: number) => Response>;

  beforeEach(async () => {
    getStatus = jest.fn<GetStatusFn>();
    statusMock = jest.fn();

    const mod = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { getStatus } }],
    }).compile();

    controller = mod.get(HealthController);
  });

  const res = () => ({ status: statusMock }) as unknown as Response;

  it('mantém HTTP 200 quando status é ok', async () => {
    getStatus.mockResolvedValue(fakeStatus({ status: 'ok' }));

    const body = await controller.getHealth(res());

    expect(statusMock).not.toHaveBeenCalled();
    expect(body.status).toBe('ok');
  });

  it('mantém HTTP 200 quando status é degraded — sessões ativas seguem funcionando', async () => {
    getStatus.mockResolvedValue(
      fakeStatus({ status: 'degraded', directory: 'unreachable' }),
    );

    await controller.getHealth(res());

    expect(statusMock).not.toHaveBeenCalled();
  });

  it('devolve HTTP 503 quando status é down — banco inacessível', async () => {
    getStatus.mockResolvedValue(
      fakeStatus({ status: 'down', database: 'disconnected' }),
    );

    await controller.getHealth(res());

    expect(statusMock).toHaveBeenCalledWith(503);
  });
});
