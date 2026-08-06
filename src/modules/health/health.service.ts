import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  DIRECTORY_CHECKER,
  type DirectoryChecker,
} from '../auth/directory-checker.js';
import type { HealthStatus } from './health.dto.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(DIRECTORY_CHECKER)
    private readonly checker: DirectoryChecker,
  ) {}

  async getStatus(): Promise<HealthStatus> {
    let database: HealthStatus['database'] = 'disconnected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'connected';
    } catch {
      database = 'disconnected';
    }

    let directory: HealthStatus['directory'] = 'disabled';
    if (this.config.get('AUTH_VALIDATOR', { infer: true }) === 'ad') {
      // username inexistente de propósito: só interessa se o DC RESPONDE.
      const r = await this.checker.verificar('__healthcheck__');
      directory = r.estado === 'indisponivel' ? 'unreachable' : 'reachable';
    }

    // Banco fora = down (nada funciona). AD fora = degraded: sessões ativas
    // seguem, break-glass entra, mas login novo pelo AD falha.
    const status: HealthStatus['status'] =
      database !== 'connected'
        ? 'down'
        : directory === 'unreachable'
          ? 'degraded'
          : 'ok';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database,
      directory,
    };
  }
}
