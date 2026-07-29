import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Primeiro contrato do projeto — o molde de todo endpoint daqui em diante:
// o schema valida, serializa e documenta (OpenAPI -> orval -> Next).
export const healthStatusSchema = z.object({
  // 'degraded' reservado para a Fase D (banco ok + AD fora do ar)
  status: z.enum(['ok', 'degraded', 'down']),
  timestamp: z.iso.datetime(),
  uptime: z.number(),
  database: z.enum(['connected', 'disconnected']),
});

export class HealthStatusDto extends createZodDto(healthStatusSchema) {}
export type HealthStatus = z.infer<typeof healthStatusSchema>;
