import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { STATUS_CODES } from 'node:http';

// RFC 7807 — Problem Details for HTTP APIs.
// Formato ÚNICO de erro da API: o frontend trata um shape só.
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  reqId?: string;
  [extension: string]: unknown;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const reqId = req.id as string | undefined;

    let status: number;
    let detail: string | undefined;
    const extensions: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        detail = body;
      } else {
        const obj = body as Record<string, unknown>;
        // message pode ser string ou string[] (pipes do Nest)
        detail = Array.isArray(obj.message)
          ? (obj.message as string[]).join('; ')
          : (obj.message as string | undefined);
        // nestjs-zod anexa os issues em `errors` — preservar para o front
        if (Array.isArray(obj.errors)) {
          extensions.errors = obj.errors;
        }
      }
    } else {
      // Erro NÃO tratado: loga tudo internamente, expõe NADA externamente.
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      detail = 'Erro interno. Informe o reqId ao suporte.';
      this.logger.error(
        { err: exception, reqId, url: req.url },
        'unhandled exception',
      );
    }

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      detail,
      instance: req.url,
      reqId,
      ...extensions,
    };

    res.status(status).type('application/problem+json').json(problem);
  }
}
