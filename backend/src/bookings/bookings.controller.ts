import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseFilters,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProblemDetailsFilter } from '../common/filters/problem-details.filter';
import { BookingsService } from './bookings.service';
import type { BookingPage, BookingView } from './bookings.types';
import { CreateBookingDto, toBookingRequest } from './dto/create-booking.dto';
import { DEFAULT_PAGE_SIZE, ListBookingsDto } from './dto/list-bookings.dto';

/**
 * Signed-in customers only: the global JwtAuthGuard covers every route here,
 * and each one acts on the caller's own bookings and nobody else's.
 */
@Controller('bookings')
@UseFilters(ProblemDetailsFilter)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /**
   * FR-C6. Holds places for 15 minutes. 201 with a new hold, or 200 with the
   * caller's existing hold when this is the same request again. 409 as
   * application/problem+json when there are not enough places or the date is
   * not on sale.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBookingDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ booking: BookingView }> {
    const { booking, created } = await this.bookings.create(
      userId,
      toBookingRequest(dto),
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { booking };
  }

  /** FR-C10. Newest first, cursor-paginated. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: ListBookingsDto,
  ): Promise<BookingPage> {
    return this.bookings.list(
      userId,
      { cursor: query.cursor, limit: query.limit ?? DEFAULT_PAGE_SIZE },
      new Date(),
    );
  }

  /** Never cached: a hold's status changes on its own when it runs out. */
  @Get(':reference')
  @Header('Cache-Control', 'private, no-store')
  async get(
    @CurrentUser('id') userId: string,
    @Param('reference') reference: string,
  ): Promise<{ booking: BookingView }> {
    return {
      booking: await this.bookings.get(userId, reference, new Date()),
    };
  }
}
