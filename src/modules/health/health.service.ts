import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  DIRECTORY_CHECKER,
  type DirectoryChecker,
} from '../auth/directory-checker.js';
import type { HealthStatus } from './health.dto.js';

// O probe do diretório abre um bind LDAP. Sem cache, cada chamada do
// monitoramento custa até 5s (connectTimeout) quando o DC está fora, e o
// Zabbix bate de minuto em minuto. 30s de defasagem é irrelevante para
// monitoramento e corta o custo em uma ordem de grandeza.
const SONDA_TTL_MS = 30_000;

@Injectable()
export class HealthService {
  private sonda?: { em: number; valor: HealthStatus['directory'] };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(DIRECTORY_CHECKER)
    private readonly checker: DirectoryChecker,
  ) {}

  private async sondarDiretorio(): Promise<HealthStatus['directory']> {
    if (this.config.get('AUTH_VALIDATOR', { infer: true }) !== 'ad') {
      return 'disabled';
    }

    const agora = Date.now();
    if (this.sonda && agora - this.sonda.em < SONDA_TTL_MS) {
      return this.sonda.valor;
    }

    // username inexistente de propósito: só interessa se o DC RESPONDE
    const r = await this.checker.verificar('__healthcheck__');
    const valor: HealthStatus['directory'] =
      r.estado === 'indisponivel' ? 'unreachable' : 'reachable';

    this.sonda = { em: agora, valor };
    return valor;
  }

  async getStatus(): Promise<HealthStatus> {
    let database: HealthStatus['database'] = 'disconnected';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'connected';
    } catch {
      database = 'disconnected';
    }

    const directory = await this.sondarDiretorio();

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
