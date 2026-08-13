import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';
import { AppDataSource } from '../data-source';

/**
 * Builds a fully-wired Nest app from AppModule for e2e tests, mirroring main.ts:
 * cookie parsing, global validation, the unified exception filter, request
 * logging and the response wrapper. Reads DB/Redis targets from process.env so
 * tests can point at a dedicated `realtime_chat_test` database.
 *
 * Schema is rebuilt from migrations (no synchronize): drop our tables, then
 * apply all pending migrations — repeatable and independent of prior runs.
 */
export async function createApp(): Promise<INestApplication> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');
  for (const meta of AppDataSource.entityMetadatas) {
    await AppDataSource.query(`DROP TABLE IF EXISTS \`${meta.tableName}\``);
  }
  // Also drop the migration history so migrations re-apply on every run (idempotent rebuild).
  await AppDataSource.query('DROP TABLE IF EXISTS `migrations`');
  await AppDataSource.query('SET FOREIGN_KEY_CHECKS=1');
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseInterceptor());
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}
