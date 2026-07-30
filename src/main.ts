import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module.js';
import { Env } from './config/env.js';

async function bootstrap() {
  // bufferLogs: nada é perdido entre o create e o useLogger
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  // OpenAPI: fonte de verdade do contrato. O orval (no repo do Next) gera o
  // cliente a partir de /docs-json. cleanupOpenApiDoc é OBRIGATÓRIO com
  // nestjs-zod v5 para o documento sair correto.
  const openApiDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Titula RR — API')
      .setVersion('0.1.0')
      .addCookieAuth('session')
      .build(),
  );
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(openApiDoc));

  const config = app.get(ConfigService<Env, true>);
  await app.listen(config.get('PORT', { infer: true }));
}
void bootstrap();
