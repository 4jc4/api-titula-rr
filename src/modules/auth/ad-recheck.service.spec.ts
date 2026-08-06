import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import {
  MotivoRevogacao,
  OrigemConta,
  Papel,
  type User,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdRecheckService } from './ad-recheck.service.js';
import {
  AD_FAIL_OPEN_TTL_MS,
  AD_RECHECK_INTERVAL_MS,
} from './auth.constants.js';
import {
  DIRECTORY_CHECKER,
  type StatusDiretorio,
} from './directory-checker.js';
import { SessionService } from './session.service.js';

// -- helpers ----------------------------------------------------------------

const minutosAtras = (m: number): Date => new Date(Date.now() - m * 60_000);
const horasAtras = (h: number): Date => new Date(Date.now() - h * 3_600_000);

function fakeUser(over: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'fulano.teste',
    name: 'Fulano de Teste',
    email: null,
    cpf: null,
    papeis: [Papel.titulacao],
    origem: OrigemConta.AD,
    passwordHash: null,
    adVerifiedAt: horasAtras(1), // por padrão: recheck VENCIDO
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

// Assinaturas dos mocks tipadas: sem `any`, o lint não acusa unsafe return.
interface UpdateArgs {
  where: { id: string };
  data: Partial<User>;
}

type VerificarFn = (username: string) => Promise<StatusDiretorio>;
type RevokeAllFn = (userId: string, motivo: MotivoRevogacao) => Promise<void>;
type UpdateFn = (args: UpdateArgs) => User;

// -- suíte -------------------------------------------------------------------

describe('AdRecheckService', () => {
  let service: AdRecheckService;
  let verificar: jest.Mock<VerificarFn>;
  let revokeAllForUser: jest.Mock<RevokeAllFn>;
  let update: jest.Mock<UpdateFn>;

  beforeEach(async () => {
    verificar = jest.fn<VerificarFn>();
    revokeAllForUser = jest.fn<RevokeAllFn>().mockResolvedValue(undefined);
    // devolve o usuário com os campos atualizados — basta para as asserções
    update = jest.fn<UpdateFn>(({ where, data }: UpdateArgs): User => ({
      ...fakeUser(),
      ...data,
      id: where.id,
    }));

    const mod = await Test.createTestingModule({
      providers: [
        AdRecheckService,
        { provide: PrismaService, useValue: { user: { update } } },
        { provide: SessionService, useValue: { revokeAllForUser } },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        { provide: DIRECTORY_CHECKER, useValue: { verificar } },
      ],
    }).compile();

    service = mod.get(AdRecheckService);
  });

  // -- quando NÃO consultar o AD --------------------------------------------

  it('não consulta o AD dentro do intervalo de recheck', async () => {
    const user = fakeUser({ adVerifiedAt: minutosAtras(1) });
    const r = await service.garantirVerificado(user);

    expect(r.liberado).toBe(true);
    expect(verificar).not.toHaveBeenCalled();
  });

  it('nunca consulta o AD para conta LOCAL (break-glass)', async () => {
    const user = fakeUser({
      origem: OrigemConta.LOCAL,
      adVerifiedAt: null, // nunca verificada — e não importa
    });
    const r = await service.garantirVerificado(user);

    expect(r.liberado).toBe(true);
    expect(verificar).not.toHaveBeenCalled();
  });

  it('consulta o AD quando o intervalo venceu', async () => {
    verificar.mockResolvedValue({ estado: 'ativo', papeis: [Papel.titulacao] });

    await service.garantirVerificado(
      fakeUser({
        adVerifiedAt: new Date(Date.now() - AD_RECHECK_INTERVAL_MS - 1_000),
      }),
    );

    expect(verificar).toHaveBeenCalledWith('fulano.teste');
  });

  // -- estado ATIVO ----------------------------------------------------------

  it('re-sincroniza os papéis vindos do AD e reinicia o relógio', async () => {
    verificar.mockResolvedValue({ estado: 'ativo', papeis: [Papel.gestor] });

    const r = await service.garantirVerificado(fakeUser()); // era titulacao

    expect(r.liberado).toBe(true);
    expect(r.user.papeis).toEqual([Papel.gestor]);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          papeis: [Papel.gestor],
          adVerifiedAt: expect.any(Date),
        }),
      }),
    );
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  // -- estado INATIVO (decisão do AD) ---------------------------------------

  it('revoga TODAS as sessões quando a conta está inativa no AD', async () => {
    verificar.mockResolvedValue({ estado: 'inativo' });

    const r = await service.garantirVerificado(fakeUser());

    expect(r.liberado).toBe(false);
    expect(revokeAllForUser).toHaveBeenCalledWith(
      'user-1',
      MotivoRevogacao.conta_desativada,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false, papeis: [] }),
      }),
    );
  });

  // -- estado INDISPONÍVEL (infra) — o par que NÃO pode ser confundido ------

  it('fail-open: mantém a sessão quando o AD cai DENTRO do teto', async () => {
    verificar.mockResolvedValue({ estado: 'indisponivel' });

    const r = await service.garantirVerificado(
      fakeUser({ adVerifiedAt: horasAtras(1) }), // 1h < 4h
    );

    expect(r.liberado).toBe(true);
    // o relógio NÃO é reiniciado: não houve verificação bem-sucedida
    expect(update).not.toHaveBeenCalled();
  });

  it('nega quando o AD cai ALÉM do teto — mas NÃO revoga a sessão', async () => {
    verificar.mockResolvedValue({ estado: 'indisponivel' });

    const r = await service.garantirVerificado(
      fakeUser({
        adVerifiedAt: new Date(Date.now() - AD_FAIL_OPEN_TTL_MS - 60_000),
      }),
    );

    expect(r.liberado).toBe(false);
    // ESTA é a diferença para 'inativo': indisponibilidade não é decisão de
    // acesso — o DC pode voltar e a sessão precisa sobreviver.
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  // -- dedupe ----------------------------------------------------------------

  it('deduplica verificações simultâneas do mesmo usuário', async () => {
    let resolver!: (status: StatusDiretorio) => void;
    verificar.mockReturnValue(
      new Promise<StatusDiretorio>((res) => {
        resolver = res;
      }),
    );

    const user = fakeUser();
    const a = service.garantirVerificado(user);
    const b = service.garantirVerificado(user);
    resolver({ estado: 'ativo', papeis: [Papel.titulacao] });
    await Promise.all([a, b]);

    expect(verificar).toHaveBeenCalledTimes(1);
  });
});
