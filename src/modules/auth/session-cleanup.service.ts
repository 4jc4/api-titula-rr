import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { SESSION_CLEANUP_RETENTION_MS } from './auth.constants.js';
import { SessionService } from './session.service.js';

// Job agendado citado no schema.prisma: a tabela `sessions` não pode crescer
// pra sempre. Roda de madrugada — fora do horário de pico, sem concorrer com
// tráfego real por lock/IO na tabela.
@Injectable()
export class SessionCleanupService {
  constructor(
    private readonly sessions: SessionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SessionCleanupService.name);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async limpar(): Promise<void> {
    const apagadas = await this.sessions.deleteDeadOlderThan(
      SESSION_CLEANUP_RETENTION_MS,
    );
    if (apagadas > 0) {
      this.logger.info(
        { apagadas },
        'limpeza: sessões expiradas/revogadas antigas removidas',
      );
    }
  }
}
