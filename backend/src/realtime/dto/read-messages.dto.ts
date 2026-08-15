import { IsOptional, IsString } from 'class-validator';

/** Phase 3.4 Client -> Server: the user read messages in `conversationId`. */
export class ReadMessagesDto {
  @IsString()
  conversationId: string;

  /** Mark only messages with id <= this value. Omit to mark all unread. */
  @IsOptional()
  @IsString()
  upToMessageId?: string;
}
