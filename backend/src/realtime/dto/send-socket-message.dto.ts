import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Socket `send_message` payload. Reuses the same content bounds as the REST
 * `SendMessageDto` (`text`, 1–2000 chars) and additionally carries the
 * `conversationId` the client wants to post to. The sender is NEVER taken from
 * here — the gateway forces it to the verified socket identity.
 */
export class SendSocketMessageDto {
  @IsString()
  @Length(1, 64)
  conversationId: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 2000)
  content: string;
}
