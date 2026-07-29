import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Env } from '../../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CREDENTIAL_VALIDATOR } from './credential-validator.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';
import { FakeAdValidator } from './validators/fake-ad.validator.js';
import { LocalValidator } from './validators/local.validator.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    LocalValidator,
    FakeAdValidator,
    {
      // Fonte remota de identidade. Fase C: trocar FakeAdValidator -> AdValidator.
      // Trava de segurança: produção com o fake NÃO SOBE.
      provide: CREDENTIAL_VALIDATOR,
      inject: [ConfigService, FakeAdValidator],
      useFactory: (config: ConfigService<Env, true>, fake: FakeAdValidator) => {
        if (config.get('NODE_ENV', { infer: true }) === 'production') {
          throw new Error(
            'CREDENTIAL_VALIDATOR: FakeAdValidator é proibido em produção. ' +
              'Implemente o AdValidator (Fase C) antes de fazer deploy.',
          );
        }
        return fake;
      },
    },
    // Guard global: TODA rota exige sessão, exceto as marcadas com @Public()
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
