import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { MotivoRevogacao } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  ABSOLUTE_TTL_MS,
  IDLE_TTL_MS,
  RENEW_THRESHOLD,
} from './auth.constants.js';

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  // Gera o token opaco, persiste APENAS o hash e devolve o token (vai pro cookie).
  async create(
    userId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url'); // 256 bits
    const now = Date.now();
    await this.prisma.session.create({
      data: {
        id: sha256(token),
        userId,
        expiresAt: new Date(now + IDLE_TTL_MS),
        absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS),
        ip,
        userAgent,
      },
    });
    return token;
  }

  // Valida o token e aplica a renovação deslizante. null = sessão inválida.
  async validate(token: string) {
    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { id: sha256(token) },
      include: { user: true },
    });

    if (!session || session.revokedAt) return null;
    if (session.expiresAt < now || session.absoluteExpiresAt < now) return null;

    if (!session.user.isActive) {
      await this.revokeById(session.id, MotivoRevogacao.conta_desativada);
      return null;
    }

    // Renovação deslizante: só escreve no banco quando restar pouco TTL,
    // e nunca além do teto absoluto.
    const restanteMs = session.expiresAt.getTime() - now.getTime();
    if (restanteMs < IDLE_TTL_MS * RENEW_THRESHOLD) {
      const novoExpiresAt = new Date(
        Math.min(
          now.getTime() + IDLE_TTL_MS,
          session.absoluteExpiresAt.getTime(),
        ),
      );
      await this.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: novoExpiresAt },
      });
    }

    return session;
  }

  async revokeByToken(token: string, motivo: MotivoRevogacao): Promise<void> {
    await this.revokeById(sha256(token), motivo);
  }

  async revokeById(id: string, motivo: MotivoRevogacao): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), motivo },
    });
  }

  // Derruba o usuário de todos os dispositivos (runbook: desligamento/AD).
  async revokeAllForUser(
    userId: string,
    motivo: MotivoRevogacao,
  ): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), motivo },
    });
  }
}
