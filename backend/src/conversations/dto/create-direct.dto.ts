import { IsString, Length } from 'class-validator';

export class CreateDirectDto {
  @IsString()
  @Length(1, 64)
  userId: string;
}
