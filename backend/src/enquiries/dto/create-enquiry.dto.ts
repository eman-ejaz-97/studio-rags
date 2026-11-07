import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { EnquiryKind } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateEnquiryDto {
  @IsOptional()
  @IsEnum(EnquiryKind, { message: 'Choose what your enquiry is about' })
  kind?: EnquiryKind;

  @IsString()
  @Transform(trim)
  @Length(1, 120, { message: 'Enter your name' })
  name: string;

  @IsEmail({}, { message: 'Enter a valid email address' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(40, { message: 'Phone number is too long' })
  phone?: string;

  @IsString()
  @Transform(trim)
  @Length(10, 4000, {
    message: 'Tell us a little more: at least 10 characters',
  })
  message: string;

  /** Private events only (ADR-019). Ignored for a general enquiry. */
  @ValidateIf((o: CreateEnquiryDto) => o.kind === EnquiryKind.PRIVATE_EVENT)
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Enter a valid date' })
  preferredDate?: string;

  @ValidateIf((o: CreateEnquiryDto) => o.kind === EnquiryKind.PRIVATE_EVENT)
  @IsOptional()
  @IsInt({ message: 'Enter the number of guests as a whole number' })
  @Min(1, { message: 'At least one guest' })
  @Max(200, { message: 'For more than 200 guests, say so in your message' })
  guestCount?: number;

  /**
   * Honeypot. The form hides this field from people and from screen readers;
   * a bot filling every input fills it too. Not stored.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;
}
