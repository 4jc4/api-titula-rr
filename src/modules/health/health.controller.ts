import { Controller, Get } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../auth/public.decorator.js';
import { HealthStatusDto } from './health.dto.js';
import { HealthService } from './health.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ZodResponse({ status: 200, type: HealthStatusDto })
  async getHealth() {
    return this.healthService.getStatus();
  }
}
