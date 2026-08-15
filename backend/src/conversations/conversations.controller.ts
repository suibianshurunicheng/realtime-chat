import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ConversationsService } from './conversations.service';
import { CreateDirectDto } from './dto/create-direct.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  private me(req: Request): string {
    return (req.user as { sub: string }).sub;
  }

  /** Create-or-get a 1:1 conversation with another user (must be friends). */
  @Post('direct')
  createDirect(@Req() req: Request, @Body() dto: CreateDirectDto) {
    return this.conversations.createDirect(this.me(req), dto.userId);
  }

  /** List conversations the current user participates in. */
  @Get()
  list(@Req() req: Request) {
    return this.conversations.listMine(this.me(req));
  }

  /** Conversation detail (members). Forbidden unless the caller is a member. */
  @Get(':id')
  detail(@Req() req: Request, @Param('id') id: string) {
    return this.conversations.getOne(this.me(req), id);
  }

  /** Cursor-paginated message history. `before` = message id, `limit` capped at 50. */
  @Get(':id/messages')
  messages(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('limit') limit: string,
    @Query('before') before: string,
  ) {
    return this.conversations.getMessages(this.me(req), id, limit, before);
  }

  /** Send a text message. senderId is forced to the authenticated user. */
  @Post(':id/messages')
  send(@Req() req: Request, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.conversations.sendMessage(this.me(req), id, dto.content);
  }

  /** Phase 3.4 read receipt (REST fallback; the socket is the primary path).
   *  Marks the OTHER party's messages as read; returns the applied `readAt`.
   *  No socket broadcast here — the sender learns via the next `getMessages`. */
  @Post(':id/read')
  markRead(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.conversations.markRead(this.me(req), id, dto.upToMessageId);
  }
}
