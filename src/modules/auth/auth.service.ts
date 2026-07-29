import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { OrigemConta } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CREDENTIAL_VALIDATOR,
  type CredentialValidator,
} from './credential-validator.js';
import { SessionService } from './session.service.js';
import { toPublicUser, type PublicUser } from './user-public.js';
import { LocalValidator } from './validators/local.validator.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly localValidator: LocalValidator,
    @Inject(CREDENTIAL_VALIDATOR)
    private readonly remoteValidator: CredentialValidator,
  ) {}

  async login(
    username: string,
    password: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ token: string; user: PublicUser }> {
    const existing = await this.prisma.user.findUnique({
      where: { username },
    });

    // Conta LOCAL (break-glass): valida SEMPRE localmente, nunca na fonte remota.
    if (existing?.origem === OrigemConta.LOCAL) {
      const identity = await this.localValidator.validate(username, password);
      if (!identity || !existing.isActive) throw new UnauthorizedException();
      const token = await this.sessions.create(existing.id, ip, userAgent);
      return { token, user: toPublicUser(existing) };
    }

    // Fonte remota (fake hoje, AD na Fase C)
    const identity = await this.remoteValidator.validate(username, password);
    if (!identity) throw new UnauthorizedException();
    if (identity.papeis.length === 0) {
      // Existe na fonte, mas sem grupo do sistema: sem papel, sem acesso.
      throw new UnauthorizedException();
    }

    // Espelho provisionado: cria no 1º login, re-sincroniza nos seguintes.
    const user = await this.prisma.user.upsert({
      where: { username },
      create: {
        username,
        name: identity.name,
        email: identity.email,
        cpf: identity.cpf,
        papeis: identity.papeis,
        adVerifiedAt: new Date(),
      },
      update: {
        name: identity.name,
        email: identity.email,
        cpf: identity.cpf,
        papeis: identity.papeis,
        adVerifiedAt: new Date(),
      },
    });
    if (!user.isActive) throw new UnauthorizedException();

    const token = await this.sessions.create(user.id, ip, userAgent);
    return { token, user: toPublicUser(user) };
  }
}
