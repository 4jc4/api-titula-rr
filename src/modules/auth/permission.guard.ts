import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permissao } from './permissions.js';
import { temPermissao } from './permissions.js';
import { PERMISSAO_KEY } from './require-permission.decorator.js';
import type { PublicUser } from './user-public.js';

// Roda DEPOIS do SessionGuard (ordem de registro no auth.module):
//   - rota sem @RequirePermission -> exige só sessão válida (SessionGuard)
//   - rota com @RequirePermission -> exige sessão + permissão na matriz
// Fail-closed: sem usuário ou sem permissão = 403, sem exceções.
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const exigida = this.reflector.getAllAndOverride<Permissao | undefined>(
      PERMISSAO_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!exigida) return true; // rota sem exigência de permissão

    const req = context.switchToHttp().getRequest<{ user?: PublicUser }>();
    if (!req.user || !temPermissao(req.user.papeis, exigida)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
