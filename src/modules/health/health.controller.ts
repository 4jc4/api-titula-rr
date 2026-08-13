import {
  Controller,
  Get,
  HttpStatus,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
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
  @ApiServiceUnavailableResponse({
    description:
      'status "down" — banco de dados inacessível (mesmo corpo, mesmo schema)',
    type: HealthStatusDto,
  })
  async getHealth(@Res({ passthrough: true }) res: Response) {
    const health = await this.healthService.getStatus();

    // O corpo já diz tudo (status/database/directory), mas quem só olha o
    // código HTTP — o healthcheck do docker-compose.yml, e possivelmente o
    // Zabbix — precisa de um sinal nesse nível também. 'degraded' (AD fora,
    // banco ok) fica em 200: sessões ativas e break-glass continuam
    // funcionando, não é motivo pra reiniciar o container. 'down' (banco
    // inacessível) é a única condição em que nada funciona.
    if (health.status === 'down') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return health;
  }
}
