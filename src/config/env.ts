import { z } from 'zod';

// Env usa zod PURO deliberadamente: nestjs-zod resolve a tríade HTTP
// (validação de body + OpenAPI + serialização); env não é HTTP.
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.url(),
    // Fonte remota de identidade: fake (dev sem AD) ou ad (LDAPS real)
    AUTH_VALIDATOR: z.enum(['fake', 'ad']).default('fake'),
    AD_URL: z.url().optional(), // ldaps://FQDN — nunca IP (LDAPS valida o nome)
    AD_BASE_DN: z.string().optional(),
    AD_UPN_SUFFIX: z.string().optional(),
    AD_CA_PATH: z.string().optional(), // raiz da CA corporativa
    AD_BIND_DN: z.string().optional(), // svc-titula@intranet... (conta de serviço do recheck)
    AD_BIND_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_VALIDATOR === 'ad') {
      for (const campo of [
        'AD_URL',
        'AD_BASE_DN',
        'AD_UPN_SUFFIX',
        'AD_BIND_DN',
        'AD_BIND_PASSWORD',
      ] as const) {
        if (!env[campo]) {
          ctx.addIssue({
            code: 'custom',
            path: [campo],
            message: `${campo} é obrigatório quando AUTH_VALIDATOR=ad`,
          });
        }
      }
    }
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
