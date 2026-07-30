import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { publicUserSchema } from '../auth/user-public.js';

export class ListaUsuariosDto extends createZodDto(z.array(publicUserSchema)) {}

export const revogacaoResultSchema = z.object({
  revogadas: z.number().int().nonnegative(),
});

export class RevogacaoResultDto extends createZodDto(revogacaoResultSchema) {}
export type RevogacaoResult = z.infer<typeof revogacaoResultSchema>;
