import { IsOptional, IsString } from 'class-validator';

/** Phase 3.4 REST read-receipt fallback (the socket `read_messages` is primary). */
export class MarkReadDto {
  /** Mark only messages with id <= this value. Omit to mark all unread. */
  @IsOptional()
  @IsString()
  upToMessageId?: string;
}
