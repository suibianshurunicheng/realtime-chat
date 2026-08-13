import 'reflect-metadata';
import * as process from 'process';
import { DataSource } from 'typeorm';

/**
 * Standalone TypeORM DataSource for the CLI (migration:generate / run / revert).
 * NOT imported by the running app and NOT compiled by `nest build` — it is a
 * dev/CI tool. DB coordinates come from the same env vars the app uses
 * (see src/config/configuration.ts), so `DB_DATABASE` etc. apply here too.
 *
 * Run in dev/CI via ts-node: `npm run migration:run` (uses this file directly).
 * In production, compile and point the CLI at `dist/data-source.js` instead.
 */
export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: parseInt(process.env.DB_PORT ?? '3306', 10),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_DATABASE ?? 'realtime_chat',
  charset: 'utf8mb4',
  entities: [__dirname + '/src/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/src/migrations/*{.ts,.js}'],
  // Schema is owned by migrations from now on — never auto-sync.
  synchronize: false,
  logging: false,
});
