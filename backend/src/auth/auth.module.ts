import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';
import { UsersModule } from '../users/users.module';
import { RedisModule } from '../redis/redis.module';
import { TokenSocketRegistryModule } from '../realtime/token-socket-registry.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AppConfig } from '../config/configuration';

@Module({
  imports: [
    UsersModule,
    RedisModule,
    TokenSocketRegistryModule,
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig>) => ({
        secret: config.get('jwt.accessSecret', { infer: true }),
        signOptions: { expiresIn: config.get('jwt.accessExpiresIn', { infer: true }) },
      }),
    }),
  ],
  providers: [AuthService, TokenService, JwtAuthGuard],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
