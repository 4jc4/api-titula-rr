import { Injectable, NotFoundException } from '@nestjs/common';
import { MotivoRevogacao } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SessionService } from '../auth/session.service.js';
import { toPublicUser } from '../auth/user-public.js';
import type { PaginaUsuarios, RevogacaoResult } from './admin.dto.js';

@Injectable()
export class AdminUsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async listar(page: number, pageSize: number): Promise<PaginaUsuarios> {
    // Promise.all, não $transaction: um usuário entrando entre as duas
    // consultas deixa o `total` levemente desatualizado por um request —
    // aceitável numa listagem administrativa, não vale o custo de uma
    // transação.
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { username: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count(),
    ]);
    return { items: items.map(toPublicUser), total, page, pageSize };
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
