import { IsString, Length } from 'class-validator';

export class SendRequestDto {
  @IsString()
  @Length(1, 64)
  addresseeId: string;
}
