import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const healthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  timestamp: z.iso.datetime(),
  uptime: z.number(),
  database: z.enum(['connected', 'disconnected']),
  directory: z.enum(['reachable', 'unreachable', 'disabled']),
});

export class HealthStatusDto extends createZodDto(healthStatusSchema) {}
export type HealthStatus = z.infer<typeof healthStatusSchema>;
