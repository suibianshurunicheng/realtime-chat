import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { randomUUID } from 'crypto';

/**
 * Request logging interceptor. Assigns a trace id (carried on `req.traceId` so
 * the exception filter can correlate) and logs method/url/status/responseTime
 * after each request completes. Uses the built-in Logger — no extra deps.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Request');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    req.traceId = randomUUID();
    const start = Date.now();

    return next.handle().pipe(
      finalize(() => {
        const ms = Date.now() - start;
        this.logger.log(
          `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms tid=${req.traceId ?? '-'}`,
        );
      }),
    );
  }
}
