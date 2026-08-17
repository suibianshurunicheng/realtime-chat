import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

/** Wraps every successful response in `{ code: 0, message: 'success', data }`. */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // Binary downloads return a StreamableFile. Bypass the envelope so NestJS
        // streams the raw bytes; wrapping it would JSON-serialize the underlying
        // stream/socket object instead of sending the file content.
        if (data instanceof StreamableFile) {
          return data as unknown as ApiResponse<T>;
        }
        return {
          code: 0,
          message: 'success',
          data: data === undefined ? null : data,
        };
      }),
    );
  }
}
