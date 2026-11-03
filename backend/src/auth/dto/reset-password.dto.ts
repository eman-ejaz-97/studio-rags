import { IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @Length(10, 512)
  token: string;

  // Same rule and wording as RegisterDto.password.
  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  password: string;
}
