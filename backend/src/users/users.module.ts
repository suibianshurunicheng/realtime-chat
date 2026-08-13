import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RedisModule } from '../redis/redis.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User]), RedisModule],
  providers: [UsersService, JwtAuthGuard],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
