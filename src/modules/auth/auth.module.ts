import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Env } from '../../config/env.js';
import { AdRecheckService } from './ad-recheck.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CREDENTIAL_VALIDATOR } from './credential-validator.js';
import { DIRECTORY_CHECKER } from './directory-checker.js';
import { PermissionGuard } from './permission.guard.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';
import { AdDirectoryChecker } from './validators/ad-directory.checker.js';
import { AdValidator } from './validators/ad.validator.js';
import { FakeAdValidator } from './validators/fake-ad.validator.js';
import { FakeDirectoryChecker } from './validators/fake-directory.checker.js';
import { LocalValidator } from './validators/local.validator.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    AdRecheckService,
    LocalValidator,
    FakeAdValidator,
    AdValidator,
    FakeDirectoryChecker,
    AdDirectoryChecker,
    {
      // Fonte remota de IDENTIDADE (login): valida a senha do usuário.
      // Escolha por env; produção EXIGE ad.
      provide: CREDENTIAL_VALIDATOR,
      inject: [ConfigService, FakeAdValidator, AdValidator],
      useFactory: (
        config: ConfigService<Env, true>,
        fake: FakeAdValidator,
        ad: AdValidator,
      ) => {
        const escolhido = config.get('AUTH_VALIDATOR', { infer: true });
        if (
          config.get('NODE_ENV', { infer: true }) === 'production' &&
          escolhido !== 'ad'
        ) {
          throw new Error(
            'CREDENTIAL_VALIDATOR: produção exige AUTH_VALIDATOR=ad.',
          );
        }
        return escolhido === 'ad' ? ad : fake;
      },
    },
    {
      // Verificador de DIRETÓRIO (recheck): consulta com a conta de serviço,
      // sem senha de usuário. Mesma trava de produção.
      provide: DIRECTORY_CHECKER,
      inject: [ConfigService, FakeDirectoryChecker, AdDirectoryChecker],
      useFactory: (
        config: ConfigService<Env, true>,
        fake: FakeDirectoryChecker,
        ad: AdDirectoryChecker,
      ) => {
        const escolhido = config.get('AUTH_VALIDATOR', { infer: true });
        if (
          config.get('NODE_ENV', { infer: true }) === 'production' &&
          escolhido !== 'ad'
        ) {
          throw new Error(
            'DIRECTORY_CHECKER: produção exige AUTH_VALIDATOR=ad.',
          );
        }
        return escolhido === 'ad' ? ad : fake;
      },
    },
    // Guard global: TODA rota exige sessão, exceto as marcadas com @Public()
    { provide: APP_GUARD, useClass: SessionGuard },
    // Depois da sessão, a permissão (rotas com @RequirePermission)
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [SessionService, DIRECTORY_CHECKER],
})
export class AuthModule {}
