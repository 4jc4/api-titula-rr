import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PublicUser } from './user-public.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser => {
    const req = ctx.switchToHttp().getRequest<{ user: PublicUser }>();
    return req.user;
  },
);
