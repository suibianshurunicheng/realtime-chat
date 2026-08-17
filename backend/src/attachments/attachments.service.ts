import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { Attachment } from './entities/attachment.entity';
import { toAttachmentView, AttachmentView } from './attachment.view';
import {
  validateFileContent,
  sanitizeFileName,
  kindOf,
} from './attachment-validation';
import { StorageService } from '../storage/storage.service';
import { ConversationsService } from '../conversations/conversations.service';
import { AppConfig } from '../config/configuration';

const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;
const DEFAULT_ORPHAN_TTL_SEC = 86400;

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachments: Repository<Attachment>,
    private readonly conversations: ConversationsService,
    private readonly storage: StorageService,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  /**
   * Upload + persist an attachment. The attachment is UNBOUND at this point
   * (messageId = NULL, expiresAt = now + TTL). Membership of `conversationId`
   * is enforced up front so you cannot stage files for conversations you're not
   * in. Validation is CONTENT-based (magic bytes), never the client's declared
   * type. On DB failure after the file was written, the orphaned file is deleted.
   */
  async upload(
    me: string,
    conversationId: string,
    file: Express.Multer.File,
  ): Promise<AttachmentView> {
    await this.conversations.assertMember(conversationId, me); // 403 if not a member

    const max = this.config.get('storage.maxFileSize', { infer: true }) ?? DEFAULT_MAX_FILE_SIZE;
    if (file.size > max) {
      throw new PayloadTooLargeException('文件超过大小限制');
    }

    const checked = validateFileContent(file.originalname, file.buffer);
    if (!checked) {
      throw new UnsupportedMediaTypeException('不支持的文件类型');
    }

    const fileName = sanitizeFileName(file.originalname);
    const { storageKey } = await this.storage.save(file.buffer);

    try {
      const ttl = this.config.get('storage.orphanTtlSec', { infer: true }) ?? DEFAULT_ORPHAN_TTL_SEC;
      const att = this.attachments.create({
        conversationId,
        senderId: me,
        kind: kindOf(checked.mime),
        fileName,
        storageKey,
        mimeType: checked.mime,
        fileSize: file.size,
        width: null,
        height: null,
        messageId: null,
        expiresAt: new Date(Date.now() + ttl * 1000),
      });
      const saved = await this.attachments.save(att);
      return toAttachmentView(saved);
    } catch (err) {
      // Storage write succeeded but the DB insert failed -> clean up the file.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Authorize + stream an attachment for download.
   *  - 404 if the attachment does not exist,
   *  - 403 if the caller is not a member of the attachment's conversation,
   *  - 410 Gone if the owning message was recalled (never serve recalled media).
   * The physical file is read by the opaque `storageKey`, never by any client
   * path, so traversal / arbitrary-file attacks are impossible here.
   */
  async getForDownload(
    me: string,
    id: string,
  ): Promise<{ attachment: Attachment; stream: Readable }> {
    const attachment = await this.attachments.findOne({ where: { id } });
    if (!attachment) {
      throw new NotFoundException('附件不存在');
    }
    if (!(await this.conversations.isMember(attachment.conversationId, me))) {
      throw new ForbiddenException('你不是该会话的成员');
    }
    if (attachment.messageId) {
      const message = await this.conversations.getMessageById(attachment.messageId);
      if (message?.recalledAt != null) {
        throw new GoneException('消息已撤回');
      }
    }
    const stream = await this.storage.getStream(attachment.storageKey);
    return { attachment, stream };
  }

  /**
   * Delete expired, still-unbound attachments (orphans): remove the physical
   * file first, then the row. File-delete failures are tolerated so one bad
   * file can never abort the whole sweep — the row is still removed and the
   * next sweep re-attempts the (now idempotent) file delete.
   */
  async sweepOrphans(): Promise<number> {
    const orphans = await this.attachments.find({
      where: { messageId: IsNull(), expiresAt: LessThanOrEqual(new Date()) },
    });
    let removed = 0;
    for (const o of orphans) {
      await this.storage.delete(o.storageKey).catch(() => undefined);
      try {
        await this.attachments.delete(o.id);
        removed += 1;
      } catch {
        // row delete failed (e.g. race) — leave for the next sweep
      }
    }
    return removed;
  }
}
