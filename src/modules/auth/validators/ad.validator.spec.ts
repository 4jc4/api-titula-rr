import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { InvalidCredentialsError } from 'ldapts';
import type { Env } from '../../../config/env.js';

// -- mock do ldapts -----------------------------------------------------------
// AdValidator instancia `new Client(...)` direto (não é injetado pelo Nest —
// é uma lib externa, sem sentido colocar atrás de DI só para o teste), então
// o mock precisa ser do MÓDULO. ESM: registra o mock ANTES de importar o
// arquivo sob teste (import estático rodaria antes do jest.mock de qualquer
// forma) — daí o import dinâmico depois de unstable_mockModule.
const bind = jest.fn<(dn: string, password: string) => Promise<void>>();
const search =
  jest.fn<
    (
      base: string,
      opts: unknown,
    ) => Promise<{ searchEntries: Record<string, unknown>[] }>
  >();
const unbind = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => ({ bind, search, unbind })),
  InvalidCredentialsError,
}));

const { AdValidator } = await import('./ad.validator.js');

// -- helpers ------------------------------------------------------------------

function fakeConfig(): ConfigService<Env, true> {
  const valores: Partial<Env> = {
    AD_URL: 'ldaps://dc.intranet.iteraima.rr.gov.br',
    AD_BASE_DN: 'DC=intranet,DC=iteraima,DC=rr,DC=gov,DC=br',
    AD_UPN_SUFFIX: 'intranet.iteraima.rr.gov.br',
    // AD_CA_PATH ausente de propósito: sem ler certificado nenhum do disco
  };
  return {
    get: (chave: keyof Env) => valores[chave],
  } as unknown as ConfigService<Env, true>;
}

function fakeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

describe('AdValidator', () => {
  let validator: InstanceType<typeof AdValidator>;

  beforeEach(() => {
    jest.clearAllMocks();
    unbind.mockResolvedValue(undefined);
    validator = new AdValidator(fakeConfig(), fakeLogger());
  });

  it('recusa senha vazia sem sequer abrir conexão com o AD', async () => {
    const r = await validator.validate('fulano', '');

    expect(r).toBeNull();
    expect(bind).not.toHaveBeenCalled();
  });

  it('faz bind com usuario@sufixo e devolve a identidade resolvida', async () => {
    bind.mockResolvedValue(undefined);
    search.mockResolvedValue({
      searchEntries: [
        {
          displayName: 'Fulano de Teste',
          mail: 'fulano@intranet.iteraima.rr.gov.br',
          employeeID: '123.456.789-00',
          memberOf: [
            'CN=TITULA_GESTOR,OU=Grupos,DC=intranet,DC=iteraima,DC=rr,DC=gov,DC=br',
          ],
        },
      ],
    });

    const r = await validator.validate('fulano', 'senha-correta');

    expect(bind).toHaveBeenCalledWith(
      'fulano@intranet.iteraima.rr.gov.br',
      'senha-correta',
    );
    expect(r).toEqual({
      name: 'Fulano de Teste',
      email: 'fulano@intranet.iteraima.rr.gov.br',
      cpf: '12345678900', // normalizado: só dígitos
      papeis: ['gestor'],
    });
    expect(unbind).toHaveBeenCalled();
  });

  it('escapa caracteres especiais do filtro LDAP no username', async () => {
    bind.mockResolvedValue(undefined);
    search.mockResolvedValue({ searchEntries: [] });

    await validator.validate('fulano*(admin)', 'senha');

    const filtro = (search.mock.calls[0]?.[1] as { filter: string } | undefined)
      ?.filter;
    expect(filtro).toContain('\\2a'); // '*' escapado
    expect(filtro).toContain('\\28'); // '('
    expect(filtro).toContain('\\29'); // ')'
  });

  it('devolve null quando o bind autentica mas a busca não acha a entrada', async () => {
    bind.mockResolvedValue(undefined);
    search.mockResolvedValue({ searchEntries: [] });

    const r = await validator.validate('fulano', 'senha-correta');

    expect(r).toBeNull();
  });

  it('devolve null em credencial inválida (senha errada / conta bloqueada)', async () => {
    bind.mockRejectedValue(new InvalidCredentialsError());

    const r = await validator.validate('fulano', 'senha-errada');

    expect(r).toBeNull();
    expect(unbind).toHaveBeenCalled(); // finally roda mesmo no caminho de erro
  });

  it('lança 503 quando o DC está inacessível — não é credencial inválida', async () => {
    bind.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(validator.validate('fulano', 'senha')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('usa displayName vazio -> cai para o username, e mail/cpf ausentes -> null', async () => {
    bind.mockResolvedValue(undefined);
    search.mockResolvedValue({
      searchEntries: [{ memberOf: [] }], // sem displayName/mail/employeeID
    });

    const r = await validator.validate('fulano', 'senha-correta');

    expect(r).toEqual({
      name: 'fulano',
      email: null,
      cpf: null,
      papeis: [],
    });
  });
});
