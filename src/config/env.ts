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
    // Origens extras liberadas para CORS, separadas por vírgula. Ausente =
    // CORS desligado (hoje o navegador só fala com o Nginx, que roteia API e
    // Next na mesma origem). Existe para quando isso mudar sem precisar
    // mexer em código — ex.: dev local com o Next numa porta diferente.
    CORS_ORIGIN: z.string().optional(),
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

// Pura — só interpreta, não decide o que fazer com o resultado. Existe
// separada de validateEnv() por um motivo específico: process.exit() dentro
// da mesma função tornaria impossível testar a regra do superRefine (ex.:
// AUTH_VALIDATOR=ad sem AD_BIND_PASSWORD) sem matar o processo do Jest.
export function parseEnv(
  config: Record<string, unknown>,
): z.ZodSafeParseResult<Env> {
  return envSchema.safeParse(config);
}

// Efeito colateral — chamada uma vez, no bootstrap (ConfigModule.forRoot).
// console.error, não o logger pino do projeto: aqui o ConfigService ainda
// não existe, e o LoggerModule depende dele para se configurar — logar via
// pino neste ponto é ovo-e-galinha.
export function validateEnv(config: Record<string, unknown>): Env {
  const result = parseEnv(config);
  if (!result.success) {
    console.error('❌ Variáveis de ambiente inválidas:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}
