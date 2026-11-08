import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export class ListBookingsDto {
  /** The nextCursor of the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  // Query values arrive as strings, and implicit conversion is off (app.setup).
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be a whole number' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(MAX_PAGE_SIZE, { message: `limit can be at most ${MAX_PAGE_SIZE}` })
  limit?: number;
}
