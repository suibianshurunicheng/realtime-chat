import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';
import { TokenSocketRegistryModule } from './token-socket-registry.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';
import { FriendsModule } from '../friends/friends.module';
import { RedisModule } from '../redis/redis.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

/**
 * Independent realtime layer. Depends on the existing business services
 * (ConversationsService for send/membership, FriendsService for relationships,
 * UsersService for existence, RedisService for the access blacklist) but owns no
 * DB business logic of its own. Presence state is in-process only.
 *
 * Dependency direction is one-way: RealtimeModule → FriendsModule (the gateway
 * needs friend ids to scope presence broadcasts; the REST presence endpoint needs
 * FriendsService too). This avoids a friends↔realtime import cycle.
 */
@Module({
  imports: [
    ConversationsModule,
    UsersModule,
    FriendsModule,
    RedisModule,
    TokenSocketRegistryModule,
  ],
  controllers: [PresenceController],
  providers: [RealtimeGateway, PresenceService, JwtAuthGuard],
  exports: [RealtimeGateway, PresenceService],
})
export class RealtimeModule {}
