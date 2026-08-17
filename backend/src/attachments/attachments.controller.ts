import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AttachmentsService } from './attachments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AppConfig } from '../config/configuration';

const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;

@Controller('attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  private readonly maxFileSize: number;

  constructor(
    private readonly attachments: AttachmentsService,
    private readonly config: ConfigService<AppConfig>,
  ) {
    this.maxFileSize =
      this.config.get('storage.maxFileSize', { infer: true }) ?? DEFAULT_MAX_FILE_SIZE;
  }

  private me(req: Request): string {
    return (req.user as { sub: string }).sub;
  }

  /**
   * Upload one file (multipart, field `file`) staged against `conversationId`.
   * Returns an AttachmentView with an opaque download URL. The file is NOT yet
   * attached to any message — that happens when the message is sent.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DEFAULT_MAX_FILE_SIZE + 1024 * 1024 },
    }),
  )
  async upload(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { conversationId?: string },
  ) {
    if (!file) {
      throw new BadRequestException('缺少文件');
    }
    const conversationId = body?.conversationId;
    if (!conversationId) {
      throw new BadRequestException('缺少 conversationId');
    }
    return this.attachments.upload(this.me(req), conversationId, file);
  }

  /**
   * Auth-gated, membership-checked stream of an attachment. Never a public
   * static route: bytes are resolved from the opaque storageKey and the
   * Content-Type comes from the server-trusted MIME (not the client).
   */
  @Get(':id')
  async download(
    @Req() req: Request,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { attachment, stream } = await this.attachments.getForDownload(this.me(req), id);
    res.setHeader('Content-Type', attachment.mimeType);
    const disposition = attachment.kind === 'image' ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    );
    res.setHeader('Content-Length', String(attachment.fileSize));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }
}
