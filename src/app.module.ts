import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { randomUUID } from 'node:crypto';
import { AppThrottlerGuard } from './common/app-throttler.guard.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import type { Env } from './config/env.js';
import { validateEnv } from './config/env.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
        return {
          // Sem isso, o default do nestjs-pino é forRoutes: ['*'] — com
          // Express 5 (path-to-regexp v8), o '*' cru não é mais suportado e
          // dispara um WARN de "Unsupported route path" (auto-convertido,
          // mas barulhento) toda vez que a app sobe. '*path' já nasce no
          // formato novo (wildcard nomeado) e cobre as mesmas rotas.
          forRoutes: [{ path: '*path', method: RequestMethod.ALL }],
          pinoHttp: {
            level: isProd ? 'info' : 'debug',
            // Em dev, log legível; em produção, JSON puro (para o futuro
            // agregador — Zabbix/Loki/etc. — consumir)
            transport: isProd
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
            // Um id por request — aparece em todo log e nos Problem Details
            genReqId: () => randomUUID(),
            // SEGURANÇA: o cookie carrega o token de sessão; header de auth
            // e set-cookie idem. Log com token = credencial vazada em disco.
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            // /health é chamado por monitoramento — não poluir o log
            autoLogging: {
              ignore: (req) => req.url?.startsWith('/api/health') ?? false,
            },
          },
        };
      },
    }),
    // Teto GERAL da API (proteção de última linha); rotas sensíveis (ex.:
    // /auth/login) apertam ainda mais com @Throttle no próprio handler.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    // Habilita @Cron em qualquer provider da app — hoje só o
    // SessionCleanupService (AuthModule) usa.
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AdminModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    // Validação de TODO body/query com schema zod dos DTOs (createZodDto)
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Serialização das respostas anotadas com @ZodResponse/@ZodSerializerDto
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    // Formato único de erro (RFC 7807) para TODA exceção da aplicação
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    // Rate limiting global — desligado em NODE_ENV=test (ver o guard)
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
