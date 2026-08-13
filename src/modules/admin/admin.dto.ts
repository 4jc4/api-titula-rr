import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { publicUserSchema } from '../auth/user-public.js';

// z.coerce: page/pageSize chegam como string na query string.
export const listarUsuariosQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export class ListarUsuariosQueryDto extends createZodDto(
  listarUsuariosQuerySchema,
) {}

export const paginaUsuariosSchema = z.object({
  items: z.array(publicUserSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export class PaginaUsuariosDto extends createZodDto(paginaUsuariosSchema) {}
export type PaginaUsuarios = z.infer<typeof paginaUsuariosSchema>;

export const revogacaoResultSchema = z.object({
  revogadas: z.number().int().nonnegative(),
});

export class RevogacaoResultDto extends createZodDto(revogacaoResultSchema) {}
export type RevogacaoResult = z.infer<typeof revogacaoResultSchema>;
