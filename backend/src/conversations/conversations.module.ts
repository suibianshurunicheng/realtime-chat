import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Friendship } from '../friends/entities/friendship.entity';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { Attachment } from '../attachments/entities/attachment.entity';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { RedisModule } from '../redis/redis.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, ConversationMember, Message, Attachment, User, Friendship]),
    RedisModule,
  ],
  providers: [ConversationsService, JwtAuthGuard],
  controllers: [ConversationsController],
  exports: [ConversationsService],
})
export class ConversationsModule {}
