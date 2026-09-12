import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @Transform(({ value }) =>
    String(value ?? '')
      .trim()
      .toLowerCase(),
  )
  email: string;

  /**
   * Length over complexity. Composition rules push people towards predictable
   * substitutions; a longer minimum is the better trade.
   */
  @IsString()
  @Length(10, 128, { message: 'Password must be at least 10 characters' })
  password: string;

  @IsString()
  @Length(1, 80)
  @Transform(({ value }) => String(value ?? '').trim())
  firstName: string;

  @IsString()
  @Length(1, 80)
  @Transform(({ value }) => String(value ?? '').trim())
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  /** FR-M2 — must be an explicit opt-in, never assumed. */
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}
