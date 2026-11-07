import { BadRequestException } from '@nestjs/common';
import { IsISO8601, IsOptional } from 'class-validator';

/** About three months: enough for any calendar view, small enough to stay cheap. */
export const MAX_RANGE_DAYS = 92;
/** With no `to`, a month from `from`. */
export const DEFAULT_RANGE_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;

export class SessionRangeDto {
  /** Inclusive. An ISO 8601 date or date-time; defaults to now. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from must be an ISO 8601 date' })
  from?: string;

  /** Exclusive. Defaults to 31 days after `from`. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to must be an ISO 8601 date' })
  to?: string;
}

/**
 * Turns the query into a bounded window. A request for a whole year is refused
 * rather than clamped, so a caller never mistakes a partial answer for a full one.
 */
export function resolveRange(
  dto: SessionRangeDto,
  now: Date,
): { from: Date; to: Date } {
  const from = dto.from ? new Date(dto.from) : now;
  const to = dto.to
    ? new Date(dto.to)
    : new Date(from.getTime() + DEFAULT_RANGE_DAYS * DAY_MS);

  if (to <= from) {
    throw new BadRequestException('to must be later than from');
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new BadRequestException(
      `A range can cover at most ${MAX_RANGE_DAYS} days`,
    );
  }
  return { from, to };
}
