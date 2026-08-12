import { INestApplication, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';

// Configuração compartilhada entre o bootstrap (main.ts) e o e2e.
// Existe para impedir DIVERGÊNCIA: se o e2e configurasse a app por conta
// própria, uma diferença no main.ts passaria despercebida pelos testes.
export function configureApp(app: INestApplication): void {
  app.use(cookieParser());
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}
