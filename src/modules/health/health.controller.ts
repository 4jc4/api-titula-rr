import { Controller, Get } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { HealthStatusDto } from './health.dto.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ZodResponse({ type: HealthStatusDto })
  async getHealth() {
    return this.healthService.getStatus();
  }
}
