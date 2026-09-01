import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

// Construção do documento OpenAPI, compartilhada entre o bootstrap (main.ts) e
// o script que gera `openapi/openapi.json`. Existe pelo mesmo motivo do
// configureApp(): se cada um montasse o seu, o contrato servido em /api/docs
// poderia divergir do contrato versionado no repositório — e a divergência só
// apareceria quando o cliente gerado pelo orval quebrasse.
//
// Precisa rodar DEPOIS do configureApp(): é ele que põe o prefixo e a versão,
// e sem isso os paths saem como /auth/login em vez de /api/v1/auth/login.
export function criarDocumentoOpenApi(app: INestApplication) {
  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Titula RR — API')
      .setVersion('0.1.0')
      .addCookieAuth('session')
      .build(),
  );

  // OBRIGATÓRIO com nestjs-zod v5 — sem isto o documento sai malformado.
  return cleanupOpenApiDoc(documento);
}
