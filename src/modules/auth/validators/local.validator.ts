import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { OrigemConta } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { ValidatedIdentity } from '../credential-validator.js';

// Caminho break-glass: valida contas origem=LOCAL contra o argon2 do banco.
// Permanente — é a porta de entrada quando o DC está fora do ar.
@Injectable()
export class LocalValidator {
  constructor(private readonly prisma: PrismaService) {}

  async validate(
    username: string,
    password: string,
  ): Promise<ValidatedIdentity | null> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || user.origem !== OrigemConta.LOCAL || !user.passwordHash) {
      return null;
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) return null;
    return {
      name: user.name,
      email: user.email,
      cpf: user.cpf,
      papeis: user.papeis,
    };
  }
}
