import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(64)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  nickname: string;
}
