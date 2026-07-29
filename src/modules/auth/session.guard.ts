import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
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

    // req.user carrega SÓ a forma pública (sem passwordHash, sem cpf)
    Object.assign(req, {
      user: toPublicUser(session.user),
      sessionId: session.id,
    });
    return true;
  }
}
