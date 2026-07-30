import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import type { Env } from '../../config/env.js';
import { MotivoRevogacao } from '../../generated/prisma/client.js';
import { ABSOLUTE_TTL_MS, SESSION_COOKIE } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from './public.decorator.js';
import { SessionService } from './session.service.js';
import { PublicUserDto, type PublicUser } from './user-public.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('login')
  // @ZodResponse: UMA anotação sincroniza o tipo TS, a serialização em runtime
  // (corta campos fora do schema) e o OpenAPI que o orval consome.
  @ZodResponse({ status: 200, type: PublicUserDto })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.login(
      dto.username,
      dto.password,
      ip,
      req.headers['user-agent'],
    );
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'strict',
      path: '/',
      // maxAge = teto ABSOLUTO: o cookie sobrevive às renovações deslizantes;
      // quem manda na expiração real é o servidor (expiresAt/absoluteExpiresAt).
      maxAge: ABSOLUTE_TTL_MS,
    });
    return user;
  }

  @Get('me')
  @ZodResponse({ status: 200, type: PublicUserDto })
  me(@CurrentUser() user: PublicUser) {
    return user;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];
    if (token) {
      await this.sessions.revokeByToken(token, MotivoRevogacao.logout);
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
