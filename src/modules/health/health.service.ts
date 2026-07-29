import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { HealthStatus } from './health.dto.js';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(): Promise<HealthStatus> {
    let database: HealthStatus['database'] = 'disconnected';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'connected';
    } catch {
      database = 'disconnected';
    }

    return {
      status: database === 'connected' ? 'ok' : 'down',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database,
    };
  }
}
