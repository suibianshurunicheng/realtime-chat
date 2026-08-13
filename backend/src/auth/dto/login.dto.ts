import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
