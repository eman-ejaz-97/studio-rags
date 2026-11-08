import { BookingStatus, DeliveryMode, ProductType } from '@prisma/client';
import { effectiveStatus, toBookingView } from './booking-view';
import type { BookingViewRow } from './booking-view';

const now = new Date('2026-11-14T00:00:00.000Z');
const in10 = new Date(now.getTime() + 10 * 60_000);
const ZOOM = 'https://zoom.us/j/1234567890?pwd=secret';

function row(overrides: Partial<BookingViewRow> = {}): BookingViewRow {
  return {
    reference: 'SR-7K4M2',
    status: BookingStatus.PENDING,
    seats: 2,
    subtotalCents: 9000,
    discountCents: 0,
    totalCents: 9000,
    holdExpiresAt: in10,
    photoConsentOptOut: false,
    attendeeNotes: null,
    confirmedAt: null,
    cancelledAt: null,
    createdAt: now,
    attendees: [],
    session: {
      id: 'session_1',
      startsAt: new Date('2026-11-20T00:30:00.000Z'),
      endsAt: new Date('2026-11-20T02:30:00.000Z'),
      location: null,
      onlineJoinUrl: ZOOM,
      workshop: {
        slug: 'batik-online',
        title: 'Batik Online',
        productType: ProductType.ONLINE,
        deliveryMode: DeliveryMode.ONLINE,
        requiresAccompanyingAdult: false,
      },
    },
    ...overrides,
  };
}

describe('effectiveStatus', () => {
  it.each([
    [BookingStatus.PENDING, in10, BookingStatus.PENDING],
    [BookingStatus.PENDING, now, BookingStatus.EXPIRED],
    [BookingStatus.PENDING, null, BookingStatus.EXPIRED],
    [BookingStatus.CONFIRMED, now, BookingStatus.CONFIRMED],
    [BookingStatus.CANCELLED, in10, BookingStatus.CANCELLED],
    [BookingStatus.EXPIRED, in10, BookingStatus.EXPIRED],
  ])('%s with a hold to %s reads %s', (status, holdExpiresAt, expected) => {
    expect(effectiveStatus({ status, holdExpiresAt }, now)).toBe(expected);
  });
});

describe('toBookingView', () => {
  it('shows a live hold with its expiry and without the Zoom link', () => {
    const view = toBookingView(row(), now);

    expect(view.status).toBe('PENDING');
    expect(view.holdExpiresAt).toBe(in10.toISOString());
    expect(view.session.onlineJoinUrl).toBeNull();
    expect(JSON.stringify(view)).not.toContain(ZOOM);
  });

  it('releases the Zoom link to a confirmed booking only (ADR-015)', () => {
    const view = toBookingView(
      row({ status: BookingStatus.CONFIRMED, confirmedAt: now }),
      now,
    );

    expect(view.session.onlineJoinUrl).toBe(ZOOM);
    expect(view.holdExpiresAt).toBeNull();
    expect(view.confirmedAt).toBe(now.toISOString());
  });

  it.each([
    BookingStatus.CANCELLED,
    BookingStatus.REFUNDED,
    BookingStatus.EXPIRED,
  ])('withholds the Zoom link from a %s booking', (status) => {
    expect(JSON.stringify(toBookingView(row({ status }), now))).not.toContain(
      ZOOM,
    );
  });

  it('shows a lapsed hold as EXPIRED with no expiry, before the sweep marks it', () => {
    const view = toBookingView(row({ holdExpiresAt: now }), now);

    expect(view.status).toBe('EXPIRED');
    expect(view.holdExpiresAt).toBeNull();
  });

  it('passes the notes and the children through in order', () => {
    const view = toBookingView(
      row({
        attendeeNotes: 'Bringing an apron',
        attendees: [
          { firstName: 'Sam', age: 8 },
          { firstName: 'Noor', age: 9 },
        ],
      }),
      now,
    );

    expect(view.notes).toBe('Bringing an apron');
    expect(view.attendees).toEqual([
      { firstName: 'Sam', age: 8 },
      { firstName: 'Noor', age: 9 },
    ]);
  });
});
