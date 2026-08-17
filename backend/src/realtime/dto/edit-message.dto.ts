import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 3.5 Client -> Server `edit_message` payload.
 * `content` reuses the exact bounds of the send path (trimmed, 1–2000 chars) so
 * an edit can never produce a message the send path would have rejected. The
 * actor is never taken from here (gateway forces the socket identity).
 */
export class EditMessageDto {
  @IsString()
  @Length(1, 64)
  conversationId: string;

  @IsString()
  @Length(1, 64)
  messageId: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 2000)
  content: string;
}
