import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Phase 0 bootstrap — no business modules, guards, pipes, or gateways wired yet.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // TODO(phase1): enableHelmet(), enableCors(), setGlobalPrefix('api'),
  //                useGlobalPipes(ValidationPipe), JWT auth guard, WebSocket adapter.
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
}

void bootstrap();
