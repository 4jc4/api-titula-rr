import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { MotivoRevogacao, type User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AD_FAIL_OPEN_TTL_MS,
  AD_RECHECK_INTERVAL_MS,
} from './auth.constants.js';
import {
  DIRECTORY_CHECKER,
  type DirectoryChecker,
} from './directory-checker.js';
import { SessionService } from './session.service.js';

export interface ResultadoRecheck {
  // false = negar o request (conta inativa, ou fail-open estourado)
  liberado: boolean;
  // usuário possivelmente com papéis atualizados (o guard usa ESTE)
  user: User;
}

@Injectable()
export class AdRecheckService {
  // Dedupe: várias requests simultâneas do mesmo usuário compartilham UMA
  // verificação em voo, em vez de abrirem N conexões LDAP ao mesmo tempo.
  private readonly emVoo = new Map<string, Promise<ResultadoRecheck>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly logger: PinoLogger,
    @Inject(DIRECTORY_CHECKER)
    private readonly checker: DirectoryChecker,
  ) {
    this.logger.setContext(AdRecheckService.name);
  }

  async garantirVerificado(user: User): Promise<ResultadoRecheck> {
    // Conta LOCAL (break-glass) não tem contraparte no AD: nunca reverifica.
    if (user.origem === 'LOCAL') return { liberado: true, user };

    const desde = user.adVerifiedAt?.getTime() ?? 0;
    const idade = Date.now() - desde;
    if (idade < AD_RECHECK_INTERVAL_MS) return { liberado: true, user };

    const emVoo = this.emVoo.get(user.id);
    if (emVoo) return emVoo;

    const promessa = this.verificar(user, idade).finally(() => {
      this.emVoo.delete(user.id);
    });
    this.emVoo.set(user.id, promessa);
    return promessa;
  }

  private async verificar(
    user: User,
    idade: number,
  ): Promise<ResultadoRecheck> {
    const status = await this.checker.verificar(user.username);

    if (status.estado === 'indisponivel') {
      // FAIL-OPEN COM TETO: o DC estar fora não derruba quem trabalha,
      // mas a confiança na última verificação tem prazo de validade.
      if (idade < AD_FAIL_OPEN_TTL_MS) {
        this.logger.warn(
          { username: user.username, idadeMs: idade },
          'recheck: AD indisponível, mantendo sessão dentro do teto',
        );
        return { liberado: true, user };
      }
      this.logger.error(
        { username: user.username, idadeMs: idade },
        'recheck: AD indisponível além do teto — negando',
      );
      return { liberado: false, user };
    }

    if (status.estado === 'inativo') {
      // Decisão do AD (desligamento / perda de grupo): age AGORA.
      this.logger.warn(
        { username: user.username },
        'recheck: conta inativa no AD — revogando sessões',
      );
      const atualizado = await this.prisma.user.update({
        where: { id: user.id },
        data: { isActive: false, papeis: [] },
      });
      await this.sessions.revokeAllForUser(
        user.id,
        MotivoRevogacao.conta_desativada,
      );
      return { liberado: false, user: atualizado };
    }

    // Ativo: re-sincroniza papéis (mudança de setor no AD reflete aqui) e
    // reinicia o relógio do recheck/fail-open.
    const papeisMudaram =
      status.papeis.length !== user.papeis.length ||
      status.papeis.some((p) => !user.papeis.includes(p));

    if (papeisMudaram) {
      this.logger.warn(
        { username: user.username, de: user.papeis, para: status.papeis },
        'recheck: papéis re-sincronizados do AD',
      );
    }

    const atualizado = await this.prisma.user.update({
      where: { id: user.id },
      data: { papeis: status.papeis, adVerifiedAt: new Date() },
    });
    return { liberado: true, user: atualizado };
  }
}
