import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../../config/env.js';

// Mesmo esquema de mock do ad.validator.spec.ts — ver o comentário lá.
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
}));

const { AdDirectoryChecker } = await import('./ad-directory.checker.js');

function fakeConfig(): ConfigService<Env, true> {
  const valores: Partial<Env> = {
    AD_URL: 'ldaps://dc.intranet.iteraima.rr.gov.br',
    AD_BASE_DN: 'DC=intranet,DC=iteraima,DC=rr,DC=gov,DC=br',
    AD_BIND_DN: 'svc-titula@intranet.iteraima.rr.gov.br',
    AD_BIND_PASSWORD: 'senha-do-servico',
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

describe('AdDirectoryChecker', () => {
  let checker: InstanceType<typeof AdDirectoryChecker>;

  beforeEach(() => {
    jest.clearAllMocks();
    unbind.mockResolvedValue(undefined);
    bind.mockResolvedValue(undefined);
    checker = new AdDirectoryChecker(fakeConfig(), fakeLogger());
  });

  it('faz bind com a conta de SERVIÇO, nunca com senha de usuário', async () => {
    search.mockResolvedValue({ searchEntries: [] });

    await checker.verificar('fulano');

    expect(bind).toHaveBeenCalledWith(
      'svc-titula@intranet.iteraima.rr.gov.br',
      'senha-do-servico',
    );
  });

  it('filtra só contas habilitadas (ACCOUNTDISABLE) na busca', async () => {
    search.mockResolvedValue({ searchEntries: [] });

    await checker.verificar('fulano');

    const filtro = (search.mock.calls[0]?.[1] as { filter: string } | undefined)
      ?.filter;
    expect(filtro).toContain(
      '(!(userAccountControl:1.2.840.113556.1.4.803:=2))',
    );
  });

  it('devolve inativo quando a busca não encontra a conta', async () => {
    search.mockResolvedValue({ searchEntries: [] });

    const r = await checker.verificar('fulano');

    expect(r).toEqual({ estado: 'inativo' });
  });

  it('devolve inativo quando a conta existe mas perdeu todos os grupos TITULA_*', async () => {
    search.mockResolvedValue({
      searchEntries: [{ memberOf: ['CN=Domain Users,DC=intranet'] }],
    });

    const r = await checker.verificar('fulano');

    expect(r).toEqual({ estado: 'inativo' });
  });

  it('devolve ativo com os papéis atuais quando a conta tem grupo TITULA_*', async () => {
    search.mockResolvedValue({
      searchEntries: [
        {
          memberOf: [
            'CN=TITULA_TITULACAO,OU=Grupos,DC=intranet,DC=iteraima,DC=rr,DC=gov,DC=br',
          ],
        },
      ],
    });

    const r = await checker.verificar('fulano');

    expect(r).toEqual({ estado: 'ativo', papeis: ['titulacao'] });
  });

  it('devolve indisponivel (não lança) quando o AD está inacessível', async () => {
    bind.mockRejectedValue(new Error('ECONNREFUSED'));

    const r = await checker.verificar('fulano');

    expect(r).toEqual({ estado: 'indisponivel' });
  });

  it('sempre faz unbind, inclusive no caminho de erro', async () => {
    bind.mockRejectedValue(new Error('timeout'));

    await checker.verificar('fulano');

    expect(unbind).toHaveBeenCalled();
  });
});
