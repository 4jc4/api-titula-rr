import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { Env } from './config/env.js';
import { configureApp } from './configure-app.js';
import { criarDocumentoOpenApi } from './openapi.js';

async function bootstrap() {
  // bufferLogs: nada é perdido entre o create e o useLogger
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Prefixo, versionamento, cookie-parser e trust proxy — os mesmos que o
  // e2e usa (ver configure-app.ts). Precisa vir ANTES do createDocument.
  configureApp(app);

  const config = app.get(ConfigService<Env, true>);

  // OpenAPI: fonte de verdade do contrato. O orval (no repo do Next) gera o
  // cliente a partir de /api/docs-json. cleanupOpenApiDoc é OBRIGATÓRIO com
  // nestjs-zod v5 para o documento sair correto.
  // Como o createDocument roda DEPOIS do configureApp, os paths saem
  // versionados: /api/v1/auth/login, /api/health, etc.
  //
  // FORA DE PRODUÇÃO, e não por economia: o SwaggerModule registra as rotas
  // direto no adapter Express, FORA do pipeline do Nest — os APP_GUARD
  // globais não se aplicam a elas. Em produção, /api/docs e /api/docs-json
  // responderiam sem cookie de sessão a qualquer um que alcance a API,
  // entregando o mapa completo de endpoints, campos e regras de validação.
  // Na intranet o risco é baixo, não nulo, e o custo de desligar é zero: o
  // orval gera o cliente contra uma instância de desenvolvimento. Se um dia
  // fizer falta em produção, o caminho é um basic-auth no location /api/docs
  // do Nginx — não devolver a rota para trás dos guards, que o Swagger não
  // atravessa.
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    // 'api/docs' e não 'docs': a documentação acompanha o prefixo da API,
    // para o vhost do Nginx rotear tudo sob /api com um location só.
    // O documento é montado por criarDocumentoOpenApi() — o MESMO que gera o
    // openapi/openapi.json versionado, para os dois não divergirem.
    SwaggerModule.setup('api/docs', app, criarDocumentoOpenApi(app));
  }

  await app.listen(config.get('PORT', { infer: true }));

  // Desligamento gracioso, registrado à mão em vez de app.enableShutdownHooks():
  // o helper do Nest liga os sinais a um app.close() que corre em paralelo com
  // o flush do pino, e pode encerrar o processo antes do último log sair
  // (nestjs/nest#15978). Chamando app.close() nós mesmos, o log de shutdown
  // sai ANTES do PrismaService.onModuleDestroy() rodar (Prisma se desconecta
  // aqui), e só então o processo termina.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void (async () => {
        logger.log(`recebido ${signal}, encerrando graciosamente...`);
        await app.close();
        process.exit(0);
      })();
    });
  }
}
void bootstrap();
