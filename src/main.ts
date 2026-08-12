import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module.js';
import { Env } from './config/env.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  // bufferLogs: nada é perdido entre o create e o useLogger
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Prefixo, versionamento, cookie-parser e trust proxy — os mesmos que o
  // e2e usa (ver configure-app.ts). Precisa vir ANTES do createDocument.
  configureApp(app);

  // OpenAPI: fonte de verdade do contrato. O orval (no repo do Next) gera o
  // cliente a partir de /api/docs-json. cleanupOpenApiDoc é OBRIGATÓRIO com
  // nestjs-zod v5 para o documento sair correto.
  // Como o createDocument roda DEPOIS do configureApp, os paths saem
  // versionados: /api/v1/auth/login, /api/health, etc.
  const openApiDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Titula RR — API')
      .setVersion('0.1.0')
      .addCookieAuth('session')
      .build(),
  );

  // 'api/docs' e não 'docs': a documentação acompanha o prefixo da API,
  // para o vhost do Nginx rotear tudo sob /api com um location só.
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(openApiDoc));

  const config = app.get(ConfigService<Env, true>);
  await app.listen(config.get('PORT', { infer: true }));
}
void bootstrap();
