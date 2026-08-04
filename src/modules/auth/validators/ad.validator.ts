import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, InvalidCredentialsError } from 'ldapts';
import { PinoLogger } from 'nestjs-pino';
import { readFileSync } from 'node:fs';
import type { Env } from '../../../config/env.js';
import type {
  CredentialValidator,
  ValidatedIdentity,
} from '../credential-validator.js';
import { gruposParaPapeis } from '../grupos-para-papeis.js';

// Escapa caracteres especiais de filtro LDAP (RFC 4515) — o username vem
// do cliente e NUNCA entra cru num filtro.
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

@Injectable()
export class AdValidator implements CredentialValidator {
  private readonly url: string;
  private readonly baseDn: string;
  private readonly upnSuffix: string;
  private readonly ca?: Buffer;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdValidator.name);
    this.url = config.get('AD_URL', { infer: true })!;
    this.baseDn = config.get('AD_BASE_DN', { infer: true })!;
    this.upnSuffix = config.get('AD_UPN_SUFFIX', { infer: true })!;
    const caPath = config.get('AD_CA_PATH', { infer: true });
    this.ca = caPath ? readFileSync(caPath) : undefined;
  }

  async validate(
    username: string,
    password: string,
  ): Promise<ValidatedIdentity | null> {
    // CRÍTICO: bind com senha vazia é tratado pelo AD como bind ANÔNIMO e
    // "sucede" — sem esta guarda, senha em branco viraria login válido.
    if (!password) return null;

    const client = new Client({
      url: this.url,
      tlsOptions: this.ca ? { ca: [this.ca] } : undefined,
      timeout: 5000,
      connectTimeout: 5000,
    });

    try {
      // O bind com as credenciais do PRÓPRIO usuário é a verificação de
      // senha — o AD aplica as políticas dele (bloqueio, expiração, GPO).
      await client.bind(`${username}@${this.upnSuffix}`, password);

      const { searchEntries } = await client.search(this.baseDn, {
        scope: 'sub',
        filter: `(&(objectCategory=person)(sAMAccountName=${escapeLdapFilter(username)}))`,
        attributes: ['displayName', 'mail', 'employeeID', 'memberOf'],
      });

      const entry = searchEntries[0];
      if (!entry) return null;

      const { papeis, desconhecidos } = gruposParaPapeis(
        toArray(entry.memberOf),
      );
      for (const grupo of desconhecidos) {
        // Typo da TI ao criar grupo: anomalia visível, nunca bloqueio
        this.logger.warn({ grupo, username }, 'grupo TITULA_ desconhecido');
      }

      const cpfBruto = toArray(entry.employeeID)[0];
      return {
        name: toArray(entry.displayName)[0] ?? username,
        email: toArray(entry.mail)[0] ?? null,
        // convenção: employeeID = CPF só dígitos; normaliza defensivamente
        cpf: cpfBruto ? cpfBruto.replace(/\D/g, '') : null,
        papeis,
      };
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return null; // senha errada / conta bloqueada / desabilitada -> 401
      }
      // DC inacessível NÃO é credencial inválida: é indisponibilidade (503).
      // Sessões ativas seguem funcionando; o break-glass cobre o login.
      this.logger.error({ err: error }, 'falha ao contatar o AD');
      throw new ServiceUnavailableException(
        'Autenticação temporariamente indisponível',
      );
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}
