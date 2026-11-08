import { Role } from '@prisma/client';
import { ACCESS_COOKIE } from '../../src/auth/auth.cookies';
import { BookingsService } from '../../src/bookings/bookings.service';
import type {
  BookingPage,
  BookingView,
} from '../../src/bookings/bookings.types';
import type { TestApp } from './test-app';

export const BOOKINGS = '/api/v1/bookings';

export interface Customer {
  id: string;
  email: string;
  /** The Cookie header a signed-in browser sends. */
  cookie: string;
}

/** An RFC 9457 body as the bookings API sends it. */
export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  statusCode: number;
  message: string;
  seatsLeft?: number;
  reason?: string;
}

let counter = 0;

/**
 * A customer written straight into the table and signed in with a real access
 * token. Registering through the API would hash a password per customer and
 * run into the registration throttle, which the 50-customer race cannot wait
 * for; the token is exactly what sign-in would issue.
 */
export async function signedInCustomer(
  t: TestApp,
  firstName = 'Guest',
): Promise<Customer> {
  counter += 1;
  const user = await t.prisma.user.create({
    data: {
      email: `customer-${counter}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName,
      lastName: `Customer ${counter}`,
    },
  });
  const token = await t.tokens.signAccessToken({
    sub: user.id,
    email: user.email,
    role: Role.CUSTOMER,
  });
  return {
    id: user.id,
    email: user.email,
    cookie: `${ACCESS_COOKIE}=${token}`,
  };
}

/** One place, photography answered, unless overridden. */
export function bookingBody(
  sessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return { sessionId, seats: 1, photoConsentOptOut: false, ...overrides };
}

export function postBooking(
  t: TestApp,
  customer: Customer,
  body: object,
  headers: Record<string, string> = {},
) {
  return t
    .http()
    .post(BOOKINGS)
    .set('Cookie', customer.cookie)
    .set(headers)
    .send(body);
}

/** POST /bookings that must succeed with a new hold; returns the hold. */
export async function hold(
  t: TestApp,
  customer: Customer,
  body: object,
): Promise<BookingView> {
  const res = await postBooking(t, customer, body).expect(201);
  return (res.body as { booking: BookingView }).booking;
}

export function getBooking(t: TestApp, customer: Customer, reference: string) {
  return t
    .http()
    .get(`${BOOKINGS}/${encodeURIComponent(reference)}`)
    .set('Cookie', customer.cookie);
}

export async function listBookings(
  t: TestApp,
  customer: Customer,
  query: Record<string, string | number> = {},
): Promise<BookingPage> {
  const res = await t
    .http()
    .get(BOOKINGS)
    .query(query)
    .set('Cookie', customer.cookie)
    .expect(200);
  return res.body as BookingPage;
}

/** POST /bookings/:reference/confirm, the interim no-payment step. */
export function postConfirm(t: TestApp, customer: Customer, reference: string) {
  return t
    .http()
    .post(`${BOOKINGS}/${encodeURIComponent(reference)}/confirm`)
    .set('Cookie', customer.cookie);
}

export function bookingsService(t: TestApp): BookingsService {
  return t.app.get(BookingsService);
}

/** The booking row behind a reference, straight from the table. */
export function bookingRow(t: TestApp, reference: string) {
  return t.prisma.booking.findUniqueOrThrow({ where: { reference } });
}

/** Seats held on a session by the same rule as the catalogue, from the API. */
export async function seatsLeftOn(
  t: TestApp,
  sessionId: string,
): Promise<number> {
  const res = await t
    .http()
    .get(`/api/v1/sessions/${sessionId}/availability`)
    .expect(200);
  return (res.body as { seatsLeft: number }).seatsLeft;
}

/** Moves a hold's expiry into the past, as fifteen minutes passing would. */
export function lapse(t: TestApp, reference: string) {
  return t.prisma.booking.update({
    where: { reference },
    data: { holdExpiresAt: new Date(Date.now() - 1_000) },
  });
}
