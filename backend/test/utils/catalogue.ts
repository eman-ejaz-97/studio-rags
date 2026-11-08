import {
  BookingStatus,
  DeliveryMode,
  Prisma,
  ProductType,
  SessionStatus,
  WorkshopStatus,
} from '@prisma/client';
import type { TestApp } from './test-app';

const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const ZOOM_URL = 'https://zoom.us/j/1234567890?pwd=never-in-public-json';

let counter = 0;
const nextId = () => (counter += 1);

/** A published in-person class unless overridden. */
export async function createWorkshop(
  t: TestApp,
  overrides: Partial<Prisma.WorkshopUncheckedCreateInput> = {},
) {
  const n = nextId();
  return t.prisma.workshop.create({
    data: {
      slug: `class-${n}`,
      title: `Class ${n}`,
      summary: `Summary ${n}`,
      description: `Description ${n}`,
      productType: ProductType.ONE_OFF,
      deliveryMode: DeliveryMode.IN_PERSON,
      status: WorkshopStatus.PUBLISHED,
      durationMinutes: 180,
      basePriceCents: 8200,
      defaultCapacity: 8,
      sortOrder: n,
      ...overrides,
    },
  });
}

/** A scheduled session `daysAhead` from now, at the workshop's default size. */
export async function createSession(
  t: TestApp,
  workshopId: string,
  daysAhead: number,
  overrides: Partial<Prisma.SessionUncheckedCreateInput> = {},
) {
  const startsAt = new Date(Date.now() + daysAhead * DAY_MS);
  return t.prisma.session.create({
    data: {
      workshopId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * HOUR_MS),
      capacity: 8,
      location: 'Studio Rags, Sefton Park SA',
      status: SessionStatus.SCHEDULED,
      ...overrides,
    },
  });
}

async function customer(t: TestApp) {
  const n = nextId();
  return t.prisma.user.create({
    data: {
      email: `guest-${n}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Guest',
      lastName: `${n}`,
    },
  });
}

/**
 * A booking straight into the table, past the booking service, so a test can
 * set up any mix of statuses. The capacity trigger still applies.
 */
export async function createBooking(
  t: TestApp,
  sessionId: string,
  seats: number,
  status: BookingStatus,
  holdExpiresAt: Date | null = null,
) {
  const user = await customer(t);
  return t.prisma.booking.create({
    data: {
      reference: `SR-T${nextId().toString().padStart(4, '0')}`,
      sessionId,
      userId: user.id,
      seats,
      status,
      subtotalCents: 8200 * seats,
      totalCents: 8200 * seats,
      holdExpiresAt,
    },
  });
}

export const inMinutes = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000);
