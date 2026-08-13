import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard.js';

describe('AppThrottlerGuard', () => {
  const ctx = {} as ExecutionContext;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it('libera sem checar limite quando NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    const spy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    // instância "crua": o ramo de teste não toca nenhuma dependência
    // injetada, então não há necessidade de montar o ThrottlerModule inteiro.
    const guard = Object.create(
      AppThrottlerGuard.prototype,
    ) as AppThrottlerGuard;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('delega para o ThrottlerGuard fora de teste', async () => {
    process.env.NODE_ENV = 'production';
    const spy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    const guard = Object.create(
      AppThrottlerGuard.prototype,
    ) as AppThrottlerGuard;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith(ctx);
  });
});
