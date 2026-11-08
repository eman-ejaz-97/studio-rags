import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_SEATS_PER_BOOKING } from '../booking-rules';
import type { BookingRequest } from '../bookings.types';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * One child at the kids class. Only the shape is checked here; whether the
 * class wants attendees, how many, and whether the ages fit it depend on the
 * workshop, and BookingsService checks those with messages in plain words.
 */
export class AttendeeDto {
  @IsString()
  @Transform(trim)
  @MaxLength(60)
  firstName: string;

  @IsInt()
  @Min(0)
  @Max(120)
  age: number;
}

export class CreateBookingDto {
  @IsString({ message: 'Choose a class date' })
  @Length(1, 64, { message: 'Choose a class date' })
  sessionId: string;

  @IsInt({ message: 'Choose how many places to book' })
  @Min(1, { message: 'Book at least one place' })
  @Max(MAX_SEATS_PER_BOOKING, {
    message: `One booking can take up to ${MAX_SEATS_PER_BOOKING} places. For a bigger group, send us a message.`,
  })
  seats: number;

  /** The kids class: one entry per child, in the order they were entered. */
  @IsOptional()
  @IsArray({ message: 'List each child with their first name and age' })
  @ArrayMaxSize(MAX_SEATS_PER_BOOKING, {
    message: `List at most ${MAX_SEATS_PER_BOOKING} children`,
  })
  @ValidateNested({ each: true })
  @Type(() => AttendeeDto)
  attendees?: AttendeeDto[];

  /**
   * Required, never defaulted: the customer answers the photography question
   * at booking rather than consenting by silence (ADR-018).
   */
  @IsBoolean({
    message: 'Tell us whether you would rather not appear in photos or video',
  })
  photoConsentOptOut: boolean;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'Keep notes to 500 characters' })
  notes?: string;
}

/** The validated body in the shape the service works with. */
export function toBookingRequest(dto: CreateBookingDto): BookingRequest {
  return {
    sessionId: dto.sessionId,
    seats: dto.seats,
    attendees: (dto.attendees ?? []).map((a) => ({
      firstName: a.firstName,
      age: a.age,
    })),
    photoConsentOptOut: dto.photoConsentOptOut,
    notes: dto.notes || null,
  };
}
