import { IsString, Length } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @Length(10, 512)
  token: string;

  @IsString()
  @Length(10, 128, { message: 'Password must be at least 10 characters' })
  password: string;
}
