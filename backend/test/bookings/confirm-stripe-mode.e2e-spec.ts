// Must stay the first import: it sets PAYMENT_MODE=stripe before AppModule
// is imported. See the module for why.
import './support/stripe-mode';
import { BookingStatus } from '@prisma/client';
import { MailService } from '../../src/mail/mail.service';
import {
  bookingBody,
  bookingRow,
  getBooking,
  hold,
  postConfirm,
  signedInCustomer,
} from '../utils/bookings';
import { createSession, createWorkshop } from '../utils/catalogue';
import { useTestApp } from '../utils/test-app';

/**
 * PAYMENT_MODE=stripe, reserved for the payments step: confirming without
 * paying is refused, and a hold stays a hold.
 */
describe('bookings: POST /bookings/:reference/confirm under PAYMENT_MODE=stripe', () => {
  const ctx = useTestApp();

  it('runs with PAYMENT_MODE=stripe', () => {
    expect(ctx().config.get('PAYMENT_MODE')).toBe('stripe');
  });

  it('refuses with payment-required, and the hold stays as it was', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const s = await createSession(t, w.id, 7);
    const ada = await signedInCustomer(t);
    const booking = await hold(t, ada, bookingBody(s.id));

    const res = await postConfirm(t, ada, booking.reference).expect(409);
    await t.app.get(MailService).whenIdle();

    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const detail = 'This booking is confirmed once it is paid for.';
    expect(res.body).toEqual({
      type: '/problems/payment-required',
      title: 'Payment is needed',
      status: 409,
      detail,
      statusCode: 409,
      message: detail,
    });
    await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
      status: BookingStatus.PENDING,
      confirmedAt: null,
    });
    const fetched = await getBooking(t, ada, booking.reference).expect(200);
    expect(
      (fetched.body as { booking: { status: string } }).booking.status,
    ).toBe('PENDING');
    await expect(t.prisma.emailLog.count()).resolves.toBe(0);
  });

  it('still needs a signed-in customer', async () => {
    await ctx().http().post('/api/v1/bookings/SR-22222/confirm').expect(401);
  });
});
