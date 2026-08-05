import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type {
  DirectoryChecker,
  StatusDiretorio,
} from '../directory-checker.js';

// Dev/CI: sem rede, sem AD. Confirma o que já está no banco — o recheck
// vira no-op benigno, e os testes e2e continuam rodando offline.
// Produção com este checker NÃO SOBE (trava no factory do auth.module).
@Injectable()
export class FakeDirectoryChecker implements DirectoryChecker {
  constructor(private readonly prisma: PrismaService) {}

  async verificar(username: string): Promise<StatusDiretorio> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive || user.papeis.length === 0) {
      return { estado: 'inativo' };
    }
    return { estado: 'ativo', papeis: user.papeis };
  }
}
