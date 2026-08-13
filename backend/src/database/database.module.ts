import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig>) => {
        const db = config.get('db', { infer: true })!;
        return {
          type: 'mysql',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          charset: 'utf8mb4',
          entities: [__dirname + '/../**/*.entity{.ts,.js}'],
          // Phase 1.5: schema is owned by migrations. synchronize is OFF in every
          // environment (dev/test/prod) — see src/migrations + data-source.ts.
          synchronize: false,
          autoLoadEntities: true,
          logging: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
