import { z } from 'zod';

// Env usa zod PURO deliberadamente: nestjs-zod resolve a tríade HTTP
// (validação de body + OpenAPI + serialização); env não é HTTP.
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    console.error('❌ Variáveis de ambiente inválidas:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}
