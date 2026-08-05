import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'ldapts';
import { PinoLogger } from 'nestjs-pino';
import { readFileSync } from 'node:fs';
import type { Env } from '../../../config/env.js';
import type {
  DirectoryChecker,
  StatusDiretorio,
} from '../directory-checker.js';
import { gruposParaPapeis } from '../grupos-para-papeis.js';

function escapeLdapFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).padStart(2, '0');
    return `\\${hex}`;
  });
}

function toArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

// Bit ACCOUNTDISABLE (2) via matching rule LDAP_MATCHING_RULE_BIT_AND.
// O "!" faz o filtro devolver APENAS contas habilitadas — conta desligada
// simplesmente não retorna, sem precisar interpretar o valor do atributo.
const SOMENTE_HABILITADOS = '(!(userAccountControl:1.2.840.113556.1.4.803:=2))';

@Injectable()
export class AdDirectoryChecker implements DirectoryChecker {
  private readonly url: string;
  private readonly baseDn: string;
  private readonly bindDn: string;
  private readonly bindPassword: string;
  private readonly ca?: Buffer;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdDirectoryChecker.name);
    this.url = config.get('AD_URL', { infer: true })!;
    this.baseDn = config.get('AD_BASE_DN', { infer: true })!;
    this.bindDn = config.get('AD_BIND_DN', { infer: true })!;
    this.bindPassword = config.get('AD_BIND_PASSWORD', { infer: true })!;
    const caPath = config.get('AD_CA_PATH', { infer: true });
    this.ca = caPath ? readFileSync(caPath) : undefined;
  }

  async verificar(username: string): Promise<StatusDiretorio> {
    const client = new Client({
      url: this.url,
      tlsOptions: this.ca ? { ca: [this.ca] } : undefined,
      timeout: 5000,
      connectTimeout: 5000,
    });

    try {
      // Bind com a conta de SERVIÇO — aqui não há senha de usuário.
      await client.bind(this.bindDn, this.bindPassword);

      const { searchEntries } = await client.search(this.baseDn, {
        scope: 'sub',
        filter:
          `(&(objectCategory=person)` +
          `(sAMAccountName=${escapeLdapFilter(username)})` +
          `${SOMENTE_HABILITADOS})`,
        attributes: ['memberOf'],
      });

      const entry = searchEntries[0];
      // Sem entrada = conta desabilitada, renomeada ou excluída no AD.
      if (!entry) return { estado: 'inativo' };

      const { papeis } = gruposParaPapeis(toArray(entry.memberOf));
      // Perdeu todos os grupos TITULA_* = perdeu o acesso ao sistema.
      if (papeis.length === 0) return { estado: 'inativo' };

      return { estado: 'ativo', papeis };
    } catch (error: unknown) {
      // Falha de infraestrutura NÃO é decisão de acesso: quem decide o que
      // fazer com isso é a política de fail-open no AdRecheckService.
      this.logger.error({ err: error, username }, 'recheck: AD inacessível');
      return { estado: 'indisponivel' };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}
