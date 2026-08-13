import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { FriendRequest } from './entities/friend-request.entity';
import { Friendship } from './entities/friendship.entity';
import { FriendsService } from './friends.service';
import { FriendsController } from './friends.controller';
import { RedisModule } from '../redis/redis.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, FriendRequest, Friendship]),
    RedisModule,
  ],
  providers: [FriendsService, JwtAuthGuard],
  controllers: [FriendsController],
  exports: [FriendsService],
})
export class FriendsModule {}
