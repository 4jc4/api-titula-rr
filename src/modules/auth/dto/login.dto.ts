import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Fonte única do contrato de login: valida o body (ZodValidationPipe global),
// gera o tipo TS e aparece no OpenAPI (-> orval -> tipos no Next).
export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export class LoginDto extends createZodDto(loginSchema) {}
