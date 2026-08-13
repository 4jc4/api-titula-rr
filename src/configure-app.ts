import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import type { Env } from './config/env.js';

// Configuração compartilhada entre o bootstrap (main.ts) e o e2e.
// Existe para impedir DIVERGÊNCIA: se o e2e configurasse a app por conta
// própria, uma diferença no main.ts passaria despercebida pelos testes.
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);

  // contentSecurityPolicy: false — o Swagger UI (/api/docs) é servido pela
  // própria API; a CSP padrão do helmet quebra os assets dele. O resto dos
  // headers (remove X-Powered-By, X-Content-Type-Options, HSTS, etc.) fica
  // ativo normalmente.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(cookieParser());
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Sem CORS_ORIGIN no ambiente, o comportamento de hoje não muda: nenhum
  // header de CORS é enviado, e o navegador aplica same-origin normalmente.
  const origins = config.get('CORS_ORIGIN', { infer: true });
  if (origins) {
    app.enableCors({
      origin: origins.split(',').map((o) => o.trim()),
      credentials: true, // a sessão viaja em cookie — precisa refletir a origem, nunca '*'
    });
  }
}
