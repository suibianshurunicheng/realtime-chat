import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../config/configuration';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig>): Redis => {
        const redis = config.get('redis', { infer: true })!;
        return new Redis({
          host: redis.host,
          port: redis.port,
          password: redis.password || undefined,
          db: redis.db,
          // Fail fast in tests if Redis is unavailable rather than hanging.
          maxRetriesPerRequest: 2,
          lazyConnect: false,
        });
      },
    },
    RedisService,
  ],
  exports: [RedisService, ConfigModule],
})
export class RedisModule {}
