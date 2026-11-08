import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import {
  BookingStatus,
  DeliveryMode,
  Prisma,
  ProductType,
  SessionStatus,
  WorkshopStatus,
} from '@prisma/client';
import { ProblemException } from '../common/filters/problem-details.filter';
import type { PrismaService } from '../prisma/prisma.service';
import type { BookingViewRow } from './booking-view';
import { BookingsService, MAX_REFERENCE_ATTEMPTS } from './bookings.service';
import type { BookingRequest } from './bookings.types';

/**
 * The service against a stand-in transaction. These pin the order of the
 * steps and every branch; the e2e suites prove the same against Postgres,
 * locks and trigger included.
 */

const NOW = new Date('2026-11-14T00:00:00.000Z');
const clientVersion = '6.19.3';

function sessionRow(
  overrides: {
    status?: SessionStatus;
    startsAt?: Date;
    capacity?: number;
    priceCentsOverride?: number | null;
    workshop?: Partial<{
      status: WorkshopStatus;
      productType: ProductType;
      basePriceCents: number;
      minAge: number | null;
      maxAge: number | null;
    }>;
  } = {},
) {
  return {
    status: SessionStatus.SCHEDULED,
    startsAt: new Date(NOW.getTime() + 7 * 24 * 3_600_000),
    capacity: 8,
    priceCentsOverride: null,
    ...overrides,
    workshop: {
      status: WorkshopStatus.PUBLISHED,
      productType: ProductType.ONE_OFF,
      basePriceCents: 8200,
      minAge: null,
      maxAge: null,
      ...overrides.workshop,
    },
  };
}

/** What booking.create hands back, built from what it was given. */
function viewRow(data: {
  reference: string;
  status?: BookingStatus;
  seats: number;
  subtotalCents: number;
  totalCents: number;
  holdExpiresAt?: Date | null;
  photoConsentOptOut?: boolean;
  attendeeNotes?: string | null;
  attendees?: { create: { firstName: string; age: number }[] };
}): BookingViewRow {
  return {
    reference: data.reference,
    status: data.status ?? BookingStatus.PENDING,
    seats: data.seats,
    subtotalCents: data.subtotalCents,
    discountCents: 0,
    totalCents: data.totalCents,
    holdExpiresAt: data.holdExpiresAt ?? null,
    photoConsentOptOut: data.photoConsentOptOut ?? false,
    attendeeNotes: data.attendeeNotes ?? null,
    confirmedAt: null,
    cancelledAt: null,
    createdAt: NOW,
    attendees: data.attendees?.create ?? [],
    session: {
      id: 'session_1',
      startsAt: new Date('2026-11-21T00:00:00.000Z'),
      endsAt: new Date('2026-11-21T03:00:00.000Z'),
      location: 'Studio Rags',
      onlineJoinUrl: null,
      workshop: {
        slug: 'batik',
        title: 'Batik',
        productType: ProductType.ONE_OFF,
        deliveryMode: DeliveryMode.IN_PERSON,
        requiresAccompanyingAdult: false,
      },
    },
  };
}

const request = (overrides: Partial<BookingRequest> = {}): BookingRequest => ({
  sessionId: 'session_1',
  seats: 1,
  attendees: [],
  photoConsentOptOut: false,
  notes: null,
  ...overrides,
});

interface Setup {
  locked?: boolean;
  session?: ReturnType<typeof sessionRow>;
  existing?: (BookingViewRow & { id: string }) | null;
  taken?: number;
}

function setup(options: Setup = {}) {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue(
        options.locked === false ? [] : [{ id: 'session_1', now: NOW }],
      ),
    session: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(options.session ?? sessionRow()),
    },
    booking: {
      findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
      update: jest.fn().mockResolvedValue({}),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { seats: options.taken ?? 0 } }),
      create: jest
        .fn()
        .mockImplementation(
          ({ data }: { data: Parameters<typeof viewRow>[0] }) =>
            Promise.resolve(viewRow(data)),
        ),
    },
  };
  const transaction = jest.fn((fn: (client: typeof tx) => unknown) => fn(tx));
  const prisma = {
    $transaction: transaction,
    session: { findUnique: jest.fn().mockResolvedValue({ capacity: 8 }) },
    booking: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { seats: 8 } }),
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ now: NOW }]),
  };
  const service = new BookingsService(prisma as unknown as PrismaService);
  const draw = jest.spyOn(service, 'newReference').mockReturnValue('SR-7K4M2');
  return { service, tx, prisma, transaction, draw };
}

function problemOf(error: unknown) {
  expect(error).toBeInstanceOf(ProblemException);
  return (error as ProblemException).getResponse() as Record<string, unknown>;
}

describe('BookingsService.create', () => {
  afterEach(() => jest.restoreAllMocks());

  it('locks the session row first, in the same statement that reads the database clock', async () => {
    const { service, tx } = setup();

    await service.create('user_1', request());

    const [strings, sessionId] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    expect(strings.join('?')).toMatch(
      /SELECT id, now\(\) AS now FROM sessions WHERE id = \? FOR UPDATE/,
    );
    expect(sessionId).toBe('session_1');
    const lockedAt = tx.$queryRaw.mock.invocationCallOrder[0];
    for (const later of [
      tx.session.findUniqueOrThrow,
      tx.booking.findFirst,
      tx.booking.aggregate,
      tx.booking.create,
    ]) {
      expect(later.mock.invocationCallOrder[0]).toBeGreaterThan(lockedAt);
    }
  });

  it('holds the places for 15 minutes from the database’s clock, at the session price', async () => {
    const { service, tx } = setup({
      session: sessionRow({ priceCentsOverride: 9500 }),
      taken: 3,
    });

    const result = await service.create(
      'user_1',
      request({ seats: 2, photoConsentOptOut: true, notes: 'Left-handed' }),
    );

    expect(result.created).toBe(true);
    expect(tx.booking.create).toHaveBeenCalledWith({
      data: {
        reference: 'SR-7K4M2',
        sessionId: 'session_1',
        userId: 'user_1',
        seats: 2,
        status: BookingStatus.PENDING,
        holdExpiresAt: new Date('2026-11-14T00:15:00.000Z'),
        subtotalCents: 19000,
        discountCents: 0,
        totalCents: 19000,
        photoConsentOptOut: true,
        attendeeNotes: 'Left-handed',
        attendees: { create: [] },
      },
      select: expect.any(Object) as unknown,
    });
    // Counted with the catalogue's rule, at the database's instant.
    expect(tx.booking.aggregate).toHaveBeenCalledWith({
      where: {
        sessionId: 'session_1',
        OR: [
          { status: BookingStatus.CONFIRMED },
          { status: BookingStatus.PENDING, holdExpiresAt: { gt: NOW } },
        ],
      },
      _sum: { seats: true },
    });
  });

  it('creates one attendee per child, in order', async () => {
    const { service } = setup({
      session: sessionRow({
        workshop: { productType: ProductType.KIDS, minAge: 7, maxAge: 15 },
      }),
    });
    const attendees = [
      { firstName: 'Sam', age: 8 },
      { firstName: 'Noor', age: 12 },
    ];

    const { booking } = await service.create(
      'user_1',
      request({ seats: 2, attendees }),
    );

    expect(booking.attendees).toEqual(attendees);
  });

  it('answers 404 when there is no such session, before reading anything else', async () => {
    const { service, tx } = setup({ locked: false });

    await expect(service.create('user_1', request())).rejects.toThrow(
      new NotFoundException('Session not found'),
    );
    expect(tx.session.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it.each([WorkshopStatus.DRAFT, WorkshopStatus.ARCHIVED])(
    'answers 404 for a session of a %s class',
    async (status) => {
      const { service } = setup({
        session: sessionRow({ workshop: { status } }),
      });

      await expect(service.create('user_1', request())).rejects.toThrow(
        NotFoundException,
      );
    },
  );

  it('refuses a cancelled session with a not-on-sale problem', async () => {
    const { service, tx } = setup({
      session: sessionRow({ status: SessionStatus.CANCELLED }),
    });

    const error: unknown = await service
      .create('user_1', request())
      .catch((e: unknown) => e);

    expect(problemOf(error)).toMatchObject({
      type: '/problems/session-not-on-sale',
      status: 409,
      reason: 'cancelled',
    });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  it('refuses attendee details that do not suit the class with a 400 in words', async () => {
    const { service } = setup({
      session: sessionRow({
        workshop: { productType: ProductType.KIDS, minAge: 7, maxAge: 15 },
      }),
    });

    await expect(
      service.create(
        'user_1',
        request({ attendees: [{ firstName: 'Sam', age: 5 }] }),
      ),
    ).rejects.toThrow(
      new BadRequestException(['Sam is 5. This class is for ages 7 to 15.']),
    );
  });

  it('refuses more places than are left with a problem saying how many remain', async () => {
    const { service, tx } = setup({ taken: 6 });

    const error: unknown = await service
      .create('user_1', request({ seats: 3 }))
      .catch((e: unknown) => e);

    expect(problemOf(error)).toMatchObject({
      type: '/problems/session-full',
      status: 409,
      seatsLeft: 2,
      detail: 'Only 2 places are left in this class.',
    });
    expect(tx.booking.create).not.toHaveBeenCalled();
  });

  describe('when the customer already holds places on the session', () => {
    const existingHold = (seats: number) => ({
      id: 'booking_old',
      ...viewRow({
        reference: 'SR-AAAAA',
        seats,
        subtotalCents: 8200 * seats,
        totalCents: 8200 * seats,
        holdExpiresAt: new Date(NOW.getTime() + 5 * 60_000),
      }),
    });

    it('answers the same request with that hold, unchanged', async () => {
      const { service, tx } = setup({ existing: existingHold(2) });

      const result = await service.create('user_1', request({ seats: 2 }));

      expect(result.created).toBe(false);
      expect(result.booking.reference).toBe('SR-AAAAA');
      expect(tx.booking.update).not.toHaveBeenCalled();
      expect(tx.booking.create).not.toHaveBeenCalled();
    });

    it('cancels it before counting, so its places go towards the new request', async () => {
      const { service, tx } = setup({ existing: existingHold(2) });

      const result = await service.create('user_1', request({ seats: 3 }));

      expect(result.created).toBe(true);
      expect(tx.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking_old' },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: NOW,
          cancellationReason: 'Replaced by SR-7K4M2',
        },
      });
      expect(tx.booking.update.mock.invocationCallOrder[0]).toBeLessThan(
        tx.booking.aggregate.mock.invocationCallOrder[0],
      );
    });

    it('says how many places it could have, counting its own hold, when the new request does not fit', async () => {
      // Capacity 8; after its own two are released, six are held by others.
      const { service } = setup({ existing: existingHold(2), taken: 6 });

      const error: unknown = await service
        .create('user_1', request({ seats: 3 }))
        .catch((e: unknown) => e);

      expect(problemOf(error)).toMatchObject({
        seatsLeft: 2,
        detail:
          'Only 2 places are left in this class, counting the 2 places you are already holding.',
      });
    });
  });

  describe('reference clashes', () => {
    const clash = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion,
        meta: { target: ['reference'] },
      });

    // The insert fails inside the transaction, as Postgres would report it.
    it('starts again with a new reference', async () => {
      const { service, tx, transaction, draw } = setup();
      tx.booking.create.mockRejectedValueOnce(clash());

      await expect(service.create('user_1', request())).resolves.toMatchObject({
        created: true,
      });
      expect(draw).toHaveBeenCalledTimes(2);
      expect(transaction).toHaveBeenCalledTimes(2);
    });

    it(`gives up after ${MAX_REFERENCE_ATTEMPTS} clashes in a row`, async () => {
      const { service, tx, transaction } = setup();
      tx.booking.create.mockRejectedValue(clash());

      await expect(service.create('user_1', request())).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      expect(transaction).toHaveBeenCalledTimes(MAX_REFERENCE_ATTEMPTS);
    });

    it('does not retry a clash on anything else', async () => {
      const { service, tx, transaction } = setup();
      tx.booking.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion,
          meta: { target: ['id'] },
        }),
      );

      await expect(service.create('user_1', request())).rejects.toThrow();
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  it('turns a refusal from the capacity trigger into the usual 409, and logs it as a bug', async () => {
    const { service, tx } = setup();
    tx.booking.create.mockRejectedValue(
      new Prisma.PrismaClientUnknownRequestError(
        'bookings_session_capacity: session session_1 would be overbooked, 9 seats taken of 8',
        { clientVersion },
      ),
    );
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const error: unknown = await service
      .create('user_1', request())
      .catch((e: unknown) => e);

    expect(problemOf(error)).toMatchObject({
      type: '/problems/session-full',
      seatsLeft: 0,
    });
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('Capacity trigger refused a hold'),
      expect.stringContaining('would be overbooked'),
    );
  });
});

describe('BookingsService.list', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `booking_${i}`,
      ...viewRow({
        reference: `SR-AAAA${i}`,
        status: BookingStatus.CONFIRMED,
        seats: 1,
        subtotalCents: 8200,
        totalCents: 8200,
      }),
    }));

  it('asks for one row more than the page, and hands out a cursor only when it came back', async () => {
    const { service, prisma } = setup();
    prisma.booking.findMany.mockResolvedValueOnce(rows(3));

    const page = await service.list('user_1', { limit: 2 }, NOW);

    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(page.bookings).toHaveLength(2);
    expect(page.nextCursor).toEqual(expect.any(String));

    prisma.booking.findMany.mockResolvedValueOnce(rows(2));
    const last = await service.list('user_1', { limit: 2 }, NOW);
    expect(last.nextCursor).toBeNull();
  });

  it('refuses a cursor it did not issue', async () => {
    const { service } = setup();

    await expect(
      service.list('user_1', { cursor: 'garbage', limit: 2 }, NOW),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('BookingsService.get', () => {
  it('does not query the database for something that cannot be a reference', async () => {
    const { service, prisma } = setup();
    const findFirst = jest.fn();
    (prisma.booking as unknown as { findFirst: jest.Mock }).findFirst =
      findFirst;

    await expect(service.get('user_1', "SR-1' OR '1'='1", NOW)).rejects.toThrow(
      new NotFoundException('Booking not found'),
    );
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('BookingsService.expireLapsedHolds', () => {
  it('expires PENDING rows whose hold ended by the database’s clock, or never had one', async () => {
    const { service, prisma } = setup();

    await expect(service.expireLapsedHolds()).resolves.toBe(3);

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: {
        status: BookingStatus.PENDING,
        OR: [{ holdExpiresAt: { lte: NOW } }, { holdExpiresAt: null }],
      },
      data: { status: BookingStatus.EXPIRED },
    });
  });
});

describe('BookingsService.confirmBooking', () => {
  const MINUTE_MS = 60_000;

  function confirmSetup(
    booking: {
      status?: BookingStatus;
      session?: Partial<{
        status: SessionStatus;
        startsAt: Date;
        capacity: number;
      }>;
    } = {},
  ) {
    const row = {
      reference: 'SR-7K4M2',
      status: booking.status ?? BookingStatus.PENDING,
      seats: 1,
      holdExpiresAt: new Date(NOW.getTime() + 5 * MINUTE_MS),
      session: {
        status: SessionStatus.SCHEDULED,
        startsAt: new Date(NOW.getTime() + 7 * 24 * 60 * MINUTE_MS),
        capacity: 8,
        ...booking.session,
      },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'session_1', now: NOW }]),
      booking: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
        aggregate: jest.fn().mockResolvedValue({ _sum: { seats: 0 } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      booking: {
        findUnique: jest.fn().mockResolvedValue({ sessionId: 'session_1' }),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new BookingsService(prisma as unknown as PrismaService);
    return { service, tx };
  }

  const started = { startsAt: new Date(NOW.getTime() - MINUTE_MS) };

  it('confirms a live hold at the database’s instant', async () => {
    const { service, tx } = confirmSetup();

    await expect(service.confirmBooking('booking_1')).resolves.toEqual({
      kind: 'confirmed',
      bookingId: 'booking_1',
      reference: 'SR-7K4M2',
    });
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      data: { status: BookingStatus.CONFIRMED, confirmedAt: NOW },
    });
  });

  it('still honours a payment once the session has started, unless asked not to', async () => {
    const { service } = confirmSetup({ session: started });

    await expect(service.confirmBooking('booking_1')).resolves.toMatchObject({
      kind: 'confirmed',
    });
  });

  it('refuses a started session when asked, saying so, and changes nothing', async () => {
    const { service, tx } = confirmSetup({ session: started });

    await expect(
      service.confirmBooking('booking_1', { refuseStarted: true }),
    ).resolves.toEqual({
      kind: 'refused',
      reason: 'session-unavailable',
      notOnSale: 'started',
      bookingId: 'booking_1',
    });
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it.each([
    [SessionStatus.CANCELLED, 'cancelled', false],
    [SessionStatus.CANCELLED, 'cancelled', true],
    [SessionStatus.COMPLETED, 'completed', false],
    [SessionStatus.COMPLETED, 'completed', true],
  ] as const)(
    'refuses a %s session as %s (refuseStarted: %s)',
    async (status, notOnSale, refuseStarted) => {
      const { service, tx } = confirmSetup({ session: { status } });

      await expect(
        service.confirmBooking('booking_1', { refuseStarted }),
      ).resolves.toEqual({
        kind: 'refused',
        reason: 'session-unavailable',
        notOnSale,
        bookingId: 'booking_1',
      });
      expect(tx.booking.update).not.toHaveBeenCalled();
    },
  );

  it('answers a booking already confirmed as such, even after the start', async () => {
    const { service, tx } = confirmSetup({
      status: BookingStatus.CONFIRMED,
      session: started,
    });

    await expect(
      service.confirmBooking('booking_1', { refuseStarted: true }),
    ).resolves.toEqual({
      kind: 'already-confirmed',
      bookingId: 'booking_1',
      reference: 'SR-7K4M2',
    });
    expect(tx.booking.update).not.toHaveBeenCalled();
  });
});
