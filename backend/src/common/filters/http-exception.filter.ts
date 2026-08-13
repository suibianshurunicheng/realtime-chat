import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter: normalizes all errors into `{ code, message, data: null }`
 * where `code` carries the HTTP status (e.g. 401, 409). The frontend keys off `code`.
 *
 * Logging (Phase 1.5):
 *  - Known HttpExceptions are logged at WARN with method/url/status/traceId (no stack — safe).
 *  - Unexpected (non-Http) exceptions are logged at ERROR with the FULL stack so a 500
 *    is never a black box. The stack is never returned to the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = req?.traceId ?? '-';
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = '服务器内部错误';
    if (exception instanceof HttpException) {
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (resp && typeof resp === 'object' && 'message' in resp) {
        const m = (resp as Record<string, unknown>).message;
        message = Array.isArray(m) ? (m as string[]).join('; ') : String(m);
      }
    }

    if (exception instanceof HttpException) {
      this.logger.warn(
        `${req.method} ${req.originalUrl} ${status} ${message} tid=${traceId}`,
      );
    } else {
      const stack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`Unhandled exception: ${message}`, stack, `tid=${traceId}`);
    }

    res.status(status).json({ code: status, message, data: null });
  }
}
