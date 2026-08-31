import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Fonte única do contrato de login: valida o body (ZodValidationPipe global),
// gera o tipo TS e aparece no OpenAPI (-> orval -> tipos no Next).
export const loginSchema = z.object({
  // Aceita as três formas com que o usuário digita: `fulano`,
  // `fulano@dominio` e `DOMINIO\fulano` — o AD é indiferente, o log não.
  // O `.pipe()` no fim existe porque o `min(1)` roda ANTES do transform:
  // `"@dominio"` passaria na validação e chegaria vazio ao validator, virando
  // um bind `@dominio` no AD. Termina em 401 de qualquer jeito, mas por
  // acidente — e 400 é a resposta honesta.
  username: z
    .string()
    .min(1)
    .transform((v) => v.trim().toLowerCase().split('@')[0].split('\\').pop()!)
    .pipe(z.string().min(1)),
  password: z.string().min(1),
});
export class LoginDto extends createZodDto(loginSchema) {}
