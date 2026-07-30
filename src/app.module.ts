import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { randomUUID } from 'node:crypto';
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
              ignore: (req) => req.url === '/health',
            },
          },
        };
      },
    }),
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
  ],
})
export class AppModule {}
