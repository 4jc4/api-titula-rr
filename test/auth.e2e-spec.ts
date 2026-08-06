import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import type { PublicUser } from '../src/modules/auth/user-public.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// -- tipos das respostas -----------------------------------------------------
// supertest devolve `res.body` como `any`; tipar na leitura evita o unsafe
// member access e ainda documenta o contrato que o e2e está verificando.

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  reqId?: string;
  errors?: Array<{
    code: string;
    path: Array<string | number>;
    message: string;
  }>;
}

interface HealthBody {
  status: 'ok' | 'degraded' | 'down';
  database: 'connected' | 'disconnected';
  directory: 'reachable' | 'unreachable' | 'disabled';
}

interface RevogacaoBody {
  revogadas: number;
}

function corpo<T>(res: request.Response): T {
  return res.body as T;
}

// Extrai o cookie de sessão da resposta de login.
function cookieDe(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

// -- suíte -------------------------------------------------------------------

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  const login = (username: string, password = 'dev') =>
    request(server).post('/auth/login').send({ username, password });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = mod.createNestApplication();
    app.use(cookieParser());
    await app.init();

    // getHttpServer() é `any`: tipar aqui, uma vez, resolve o resto do arquivo
    server = app.getHttpServer() as Server;

    // banco de teste limpo (users em cascata leva as sessions junto)
    await app.get(PrismaService).user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  // -- login -----------------------------------------------------------------

  it('rejeita body inválido com 400 problem+json', async () => {
    const res = await request(server)
      .post('/auth/login')
      .send({ username: 'dev.gestor' }); // sem password

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(corpo<ProblemDetails>(res).errors?.[0]?.path).toEqual(['password']);
  });

  it('rejeita credencial inválida com 401', async () => {
    const res = await login('dev.gestor', 'senha-errada');
    expect(res.status).toBe(401);
  });

  it('nega quem existe na fonte mas não tem papel (sem papel, sem acesso)', async () => {
    const res = await login('dev.semgrupo');
    expect(res.status).toBe(401);
  });

  it('loga e provisiona o usuário espelhado no primeiro acesso', async () => {
    const res = await login('dev.gestor');

    expect(res.status).toBe(200);
    expect(corpo<PublicUser>(res)).toMatchObject({
      username: 'dev.gestor',
      papeis: ['gestor'],
    });

    // o schema de resposta NÃO expõe dados sensíveis
    const bruto = corpo<Record<string, unknown>>(res);
    expect(bruto).not.toHaveProperty('passwordHash');
    expect(bruto).not.toHaveProperty('cpf');

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  // -- guard ------------------------------------------------------------------

  it('nega rota protegida sem cookie', async () => {
    const res = await request(server).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('libera /health sem cookie (rota @Public)', async () => {
    const res = await request(server).get('/health');

    expect(res.status).toBe(200);
    expect(corpo<HealthBody>(res).database).toBe('connected');
  });

  it('devolve o usuário corrente com a sessão válida', async () => {
    const cookie = cookieDe(await login('dev.gestor'));
    const res = await request(server).get('/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(corpo<PublicUser>(res).username).toBe('dev.gestor');
  });

  // -- RBAC -------------------------------------------------------------------

  it('nega com 403 quem não tem a permissão exigida', async () => {
    const cookie = cookieDe(await login('dev.titulacao'));
    const res = await request(server)
      .get('/admin/usuarios')
      .set('Cookie', cookie);

    expect(res.status).toBe(403);
  });

  it('libera quem tem a permissão na matriz', async () => {
    const cookie = cookieDe(await login('dev.gestor'));
    const res = await request(server)
      .get('/admin/usuarios')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(corpo<PublicUser[]>(res))).toBe(true);
  });

  it('separa permissões dentro do mesmo papel autenticado', async () => {
    const gestor = cookieDe(await login('dev.gestor'));

    // gestor tem usuario:listar, mas NÃO tem sessao:revogar
    const res = await request(server)
      .post('/admin/usuarios/qualquer-id/revogar-sessoes')
      .set('Cookie', gestor);

    expect(res.status).toBe(403); // 403 antes do 404: o guard barra primeiro
  });

  // -- revogação --------------------------------------------------------------

  it('logout invalida a sessão imediatamente', async () => {
    const cookie = cookieDe(await login('dev.gestor'));

    await request(server)
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(204);

    await request(server).get('/auth/me').set('Cookie', cookie).expect(401);
  });

  it('admin derruba as sessões de outro usuário no request seguinte', async () => {
    const alvo = await login('dev.titulacao');
    const cookieAlvo = cookieDe(alvo);
    const alvoId = corpo<PublicUser>(alvo).id;
    const admin = cookieDe(await login('dev.admin'));

    // alvo está dentro
    await request(server).get('/auth/me').set('Cookie', cookieAlvo).expect(200);

    const res = await request(server)
      .post(`/admin/usuarios/${alvoId}/revogar-sessoes`)
      .set('Cookie', admin);

    expect(res.status).toBe(200);
    expect(corpo<RevogacaoBody>(res).revogadas).toBeGreaterThanOrEqual(1);

    // ...e cai NO REQUEST SEGUINTE (sem janela de token)
    await request(server).get('/auth/me').set('Cookie', cookieAlvo).expect(401);
  });
});
