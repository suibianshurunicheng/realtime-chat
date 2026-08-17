import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'path';
import { Attachment } from './entities/attachment.entity';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';
import { OrphanSweeperService } from './orphan-sweeper.service';
import { StorageService } from '../storage/storage.service';
import { LocalStorageService } from '../storage/local-storage.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { RedisModule } from '../redis/redis.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AppConfig } from '../config/configuration';

@Module({
  imports: [TypeOrmModule.forFeature([Attachment]), ConversationsModule, ConfigModule, RedisModule],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    OrphanSweeperService,
    JwtAuthGuard,
    {
      provide: StorageService,
      useFactory: (config: ConfigService<AppConfig>) =>
        new LocalStorageService(
          config.get('storage.localDir', { infer: true }) ??
            join(process.cwd(), '.uploads'),
        ),
      inject: [ConfigService],
    },
  ],
  exports: [AttachmentsService, StorageService],
})
export class AttachmentsModule {}
