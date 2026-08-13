import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../auth/public.decorator.js';
import { HealthStatusDto } from './health.dto.js';
import { HealthService } from './health.service.js';

// VERSION_NEUTRAL: fica em /api/health, fora do versionamento.
// Monitoramento (Zabbix), healthcheck do container e orquestração não
// podem quebrar quando a API lançar a v2. SkipThrottle pelo mesmo motivo:
// infraestrutura de monitoramento nunca deve tomar 429.
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ZodResponse({ status: 200, type: HealthStatusDto })
  async getHealth() {
    return this.healthService.getStatus();
  }
}
