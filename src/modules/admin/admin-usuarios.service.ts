import { Injectable, NotFoundException } from '@nestjs/common';
import { MotivoRevogacao } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SessionService } from '../auth/session.service.js';
import { toPublicUser, type PublicUser } from '../auth/user-public.js';
import type { RevogacaoResult } from './admin.dto.js';

@Injectable()
export class AdminUsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async listar(): Promise<PublicUser[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { username: 'asc' },
    });
    return users.map(toPublicUser);
  }

  // Runbook "derrubar o usuário X de todos os dispositivos":
  // desligamento, comprometimento de conta, mudança punitiva de grupo no AD.
  async revogarSessoes(userId: string): Promise<RevogacaoResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const revogadas = await this.sessions.revokeAllForUser(
      userId,
      MotivoRevogacao.admin,
    );
    return { revogadas };
  }
}
