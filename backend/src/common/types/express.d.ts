import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: { sub: string; username: string; jti: string; sid: string; exp?: number };
      /** Request-scoped trace id, set by LoggingInterceptor for log correlation. */
      traceId?: string;
    }
  }
}

export {};
