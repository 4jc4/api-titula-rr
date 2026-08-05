import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AdRecheckService } from './ad-recheck.service.js';
import { SESSION_COOKIE } from './auth.constants.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { SessionService } from './session.service.js';
import { toPublicUser } from './user-public.js';

// Guard GLOBAL fail-closed: toda rota exige sessão válida, exceto @Public().
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly recheck: AdRecheckService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];
    if (!token) throw new UnauthorizedException();

    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException();

    // reverifica no AD se a última verificação estiver velha.
    // Devolve o usuário possivelmente com papéis atualizados — o RBAC do
    // request corrente já usa os papéis novos.
    const { liberado, user } = await this.recheck.garantirVerificado(
      session.user,
    );
    if (!liberado) throw new UnauthorizedException();

    Object.assign(req, {
      user: toPublicUser(user),
      sessionId: session.id,
    });
    return true;
  }
}
