import { IsString, Length, IsOptional, IsArray, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Socket `send_message` payload (Phase 4). Reuses the same content bounds as the
 * REST `SendMessageDto` and additionally carries `type` + `attachmentIds`. The
 * sender is NEVER taken from here — the gateway forces it to the verified socket
 * identity.
 */
export class SendSocketMessageDto {
  @IsString()
  @Length(1, 64)
  conversationId: string;

  @IsOptional()
  @IsIn(['text', 'image', 'file'])
  type?: 'text' | 'image' | 'file';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 2000)
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  attachmentIds?: string[];
}
