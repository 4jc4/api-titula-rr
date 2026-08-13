import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Guard global de rate limiting. Existe principalmente para o /auth/login:
// sem limite, o endpoint é um vetor de bloqueio de conta no AD por terceiro
// (cada tentativa faz um bind LDAP com a senha informada).
//
// Desligado em NODE_ENV=test: o próprio e2e faz mais de dez logins na mesma
// suíte, do mesmo IP, dentro da mesma janela — um throttle real aqui
// derrubaria os testes, não o comportamento que eles verificam. process.env
// (não ConfigService) porque o valor precisa estar pronto antes da injeção
// de dependências rodar; o script test:e2e já exporta NODE_ENV=test antes do
// Node subir.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') return true;
    return super.canActivate(context);
  }
}
