import { NestFactory } from '@nestjs/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { criarDocumentoOpenApi } from '../openapi.js';

// Escreve o contrato em openapi/openapi.json, que é COMMITADO.
//
// O ponto não é ter o arquivo: é o CI regenerar e falhar quando o versionado
// estiver defasado. Com isso, mudar a forma de uma resposta vira diff visível
// no PR — dá para VER que um campo saiu — em vez de aparecer no dia em que o
// front, cujo cliente o orval gera a partir daqui, parar de compilar.
//
// Sobe a app sem escutar porta nenhuma. O `.env` é lido pelo ConfigModule,
// então em desenvolvimento basta `npm run openapi:generate`.
const DESTINO = resolve(process.cwd(), 'openapi/openapi.json');

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);

  const documento = criarDocumentoOpenApi(app);

  await mkdir(dirname(DESTINO), { recursive: true });
  // 2 espaços e \n final: é a formatação que o prettier daria a um JSON. O
  // arquivo está no .prettierignore, mas se um dia sair de lá o conteúdo não
  // muda — e um diff de formatação num contrato é ruído puro.
  await writeFile(DESTINO, JSON.stringify(documento, null, 2) + '\n', 'utf8');

  await app.close();
  console.log(`contrato escrito em ${DESTINO}`);
}

void main();
