import { IsString, Length, IsOptional, IsArray, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * REST `POST /conversations/:id/messages` payload (Phase 4).
 * - text:  `content` required (enforced by the service), `attachmentIds` empty.
 * - image/file: `attachmentIds` required (>=1), `content` optional caption.
 */
export class SendMessageDto {
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
