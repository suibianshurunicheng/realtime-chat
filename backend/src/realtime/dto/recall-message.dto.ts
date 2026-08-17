import { IsString, Length } from 'class-validator';

/**
 * Phase 3.5 Client -> Server `recall_message` payload.
 * Carries only WHICH message to recall — the actor is never taken from here,
 * the gateway forces it to the verified socket identity (only the sender of a
 * message may recall it).
 */
export class RecallMessageDto {
  @IsString()
  @Length(1, 64)
  conversationId: string;

  @IsString()
  @Length(1, 64)
  messageId: string;
}
