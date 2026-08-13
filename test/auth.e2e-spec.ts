import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import type { PublicUser } from '../src/modules/auth/user-public.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// -- rotas -------------------------------------------------------------------
// Centralizadas: quando a v2 existir, só estas constantes mudam.
// HEALTH é VERSION_NEUTRAL de propósito — monitoramento, healthcheck do
// container e orquestração não podem quebrar quando a API lançar uma versão
// nova.
const API = '/api/v1';
const HEALTH = '/api/health';

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

interface PaginaUsuariosBody {
  items: PublicUser[];
  total: number;
  page: number;
  pageSize: number;
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
    request(server).post(`${API}/auth/login`).send({ username, password });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = mod.createNestApplication();

    // MESMA configuração do bootstrap de produção (prefixo, versionamento,
    // cookie-parser, trust proxy). Não repetir essas chamadas aqui: se o
    // e2e configurasse por conta própria, uma divergência no main.ts
    // passaria despercebida — foi o que aconteceu em 12/08/2026, com os
    // testes verdes e a aplicação real subindo sem prefixo.
    configureApp(app);

    await app.init();

    // getHttpServer() é `any`: tipar aqui, uma vez, resolve o resto do arquivo
    server = app.getHttpServer() as Server;

    // banco de teste limpo (users em cascata leva as sessions junto)
    await app.get(PrismaService).user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  // -- versionamento ---------------------------------------------------------
  // Estes três testes travam a decisão de projeto: o health fica FORA do
  // versionamento, o resto da API fica DENTRO, e nada responde sem prefixo.

  it('serve o health sem versão (VERSION_NEUTRAL)', async () => {
    const res = await request(server).get(HEALTH);

    expect(res.status).toBe(200);
    expect(corpo<HealthBody>(res).database).toBe('connected');
  });

  it('não expõe o health sob a versão', async () => {
    await request(server).get(`${API}/health`).expect(404);
  });

  it('não responde nos paths antigos, sem prefixo', async () => {
    await request(server).get('/auth/me').expect(404);
    await request(server).get('/health').expect(404);
  });

  // -- headers (helmet/CORS) --------------------------------------------------

  it('aplica os headers de segurança do helmet e some com X-Powered-By', async () => {
    const res = await request(server).get(HEALTH);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('não envia headers de CORS sem CORS_ORIGIN no ambiente', async () => {
    const res = await request(server)
      .get(HEALTH)
      .set('Origin', 'http://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  // -- login -----------------------------------------------------------------

  it('rejeita body inválido com 400 problem+json', async () => {
    const res = await request(server)
      .post(`${API}/auth/login`)
      .send({ username: 'dev.gestor' }); // sem password

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(corpo<ProblemDetails>(res).errors?.[0]?.path).toEqual(['password']);
    // o `instance` do RFC 7807 reflete a rota versionada
    expect(corpo<ProblemDetails>(res).instance).toBe(`${API}/auth/login`);
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
    // Path=/ e NÃO /api/v1: a sessão vale para o host inteiro, inclusive
    // para o frontend Next servido na mesma origem.
    expect(cookie).toContain('Path=/');
  });

  // -- guard ------------------------------------------------------------------

  it('nega rota protegida sem cookie', async () => {
    const res = await request(server).get(`${API}/auth/me`);
    expect(res.status).toBe(401);
  });

  it('libera o health sem cookie (rota @Public)', async () => {
    const res = await request(server).get(HEALTH);

    expect(res.status).toBe(200);
    expect(corpo<HealthBody>(res).database).toBe('connected');
  });

  it('devolve o usuário corrente com a sessão válida', async () => {
    const cookie = cookieDe(await login('dev.gestor'));
    const res = await request(server)
      .get(`${API}/auth/me`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(corpo<PublicUser>(res).username).toBe('dev.gestor');
  });

  // -- RBAC -------------------------------------------------------------------

  it('nega com 403 quem não tem a permissão exigida', async () => {
    const cookie = cookieDe(await login('dev.titulacao'));
    const res = await request(server)
      .get(`${API}/admin/usuarios`)
      .set('Cookie', cookie);

    expect(res.status).toBe(403);
  });

  it('libera quem tem a permissão na matriz', async () => {
    const cookie = cookieDe(await login('dev.gestor'));
    const res = await request(server)
      .get(`${API}/admin/usuarios`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const body = corpo<PaginaUsuariosBody>(res);
    expect(Array.isArray(body.items)).toBe(true);
    // page/pageSize default (1/20) quando a query vem vazia
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
  });

  it('respeita page/pageSize na paginação de /admin/usuarios', async () => {
    // Neste ponto da suíte já existem >=2 usuários provisionados
    // (dev.gestor, dev.titulacao) — pageSize=1 tem que cortar mesmo assim.
    const cookie = cookieDe(await login('dev.gestor'));
    const res = await request(server)
      .get(`${API}/admin/usuarios?page=1&pageSize=1`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const body = corpo<PaginaUsuariosBody>(res);
    expect(body.items).toHaveLength(1);
    expect(body.pageSize).toBe(1);
    expect(body.total).toBeGreaterThan(1);
  });

  it('separa permissões dentro do mesmo papel autenticado', async () => {
    // ATENÇÃO AO PATH NESTE TESTE. Ele prova que o PermissionGuard barra
    // ANTES do handler: com um id inexistente, 403 = "o guard negou";
    // 404 = "o guard deixou passar e o service não achou".
    // Se o path estiver errado (rota inexistente), o Nest TAMBÉM devolve
    // 404 — e a falha pareceria regressão na ordem dos guards, quando é só
    // typo. Daí a asserção de sanidade abaixo e o uso da constante API.
    const alvo = `${API}/admin/usuarios/id-inexistente/revogar-sessoes`;

    // sanidade: a ROTA existe. Com credencial de admin (que TEM a
    // permissão), o 404 vem do service — não de rota inexistente.
    const admin = cookieDe(await login('dev.admin'));
    await request(server).post(alvo).set('Cookie', admin).expect(404);

    // gestor tem usuario:listar, mas NÃO tem sessao:revogar
    const gestor = cookieDe(await login('dev.gestor'));
    const res = await request(server).post(alvo).set('Cookie', gestor);

    expect(res.status).toBe(403); // 403 antes do 404: o guard barra primeiro
  });

  // -- revogação --------------------------------------------------------------

  it('logout invalida a sessão imediatamente', async () => {
    const cookie = cookieDe(await login('dev.gestor'));

    await request(server)
      .post(`${API}/auth/logout`)
      .set('Cookie', cookie)
      .expect(204);

    await request(server)
      .get(`${API}/auth/me`)
      .set('Cookie', cookie)
      .expect(401);
  });

  it('admin derruba as sessões de outro usuário no request seguinte', async () => {
    const alvo = await login('dev.titulacao');
    const cookieAlvo = cookieDe(alvo);
    const alvoId = corpo<PublicUser>(alvo).id;
    const admin = cookieDe(await login('dev.admin'));

    // alvo está dentro
    await request(server)
      .get(`${API}/auth/me`)
      .set('Cookie', cookieAlvo)
      .expect(200);

    const res = await request(server)
      .post(`${API}/admin/usuarios/${alvoId}/revogar-sessoes`)
      .set('Cookie', admin);

    expect(res.status).toBe(200);
    expect(corpo<RevogacaoBody>(res).revogadas).toBeGreaterThanOrEqual(1);

    // ...e cai NO REQUEST SEGUINTE (sem janela de token)
    await request(server)
      .get(`${API}/auth/me`)
      .set('Cookie', cookieAlvo)
      .expect(401);
  });
});
