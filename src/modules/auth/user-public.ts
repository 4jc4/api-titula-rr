import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Papel, type User } from '../../generated/prisma/client.js';

// Forma pública do usuário — o que sai pela API e entra em req.user.
// O schema é a fonte de verdade: valida, serializa (@ZodResponse corta
// qualquer campo fora daqui — passwordHash e cpf NUNCA passam) e documenta
// no OpenAPI que o orval consome.
export const publicUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  name: z.string(),
  email: z.email().nullable(),
  papeis: z.array(z.enum(Papel)),
});

export class PublicUserDto extends createZodDto(publicUserSchema) {}
export type PublicUser = z.infer<typeof publicUserSchema>;

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    papeis: user.papeis,
  };
}
