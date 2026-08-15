import { IsString, Length } from 'class-validator';

/**
 * Socket `typing_start` / `typing_stop` payload. Mirrors the `conversationId`
 * shape of `SendSocketMessageDto` (1–64 chars). Membership is enforced by the
 * gateway against the verified socket identity — the client is never trusted
 * to supply the typing user.
 */
export class TypingDto {
  @IsString()
  @Length(1, 64)
  conversationId: string;
}
