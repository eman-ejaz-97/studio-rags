import { DeliveryMode } from '@prisma/client';
import {
  BookingConfirmationEmail,
  type BookingConfirmationProps,
  bookingConfirmationSubject,
} from './booking-confirmation';
import {
  formatLongDay,
  formatPrice,
  formatShortDay,
  formatTime,
} from './format';
import { PasswordResetEmail, passwordResetSubject } from './password-reset';
import { renderEmail } from './render';

const RESET_URL =
  'http://localhost:3000/reset-password?token=AbC123-the-raw-token';

const BOOKING: BookingConfirmationProps = {
  paid: true,
  firstName: 'Ada',
  reference: 'SR-7K4M2',
  workshopTitle: 'Batik for Beginners',
  // 10:30 am to 1:30 pm on a Saturday in Adelaide summer time (UTC+10:30).
  startsAt: new Date('2027-01-16T00:00:00.000Z'),
  endsAt: new Date('2027-01-16T03:00:00.000Z'),
  deliveryMode: DeliveryMode.IN_PERSON,
  location: 'Sefton Park studio',
  onlineJoinUrl: null,
  seats: 2,
  requiresAccompanyingAdult: false,
  totalCents: 16400,
  whatToBring: 'An apron\nOld clothes you do not mind marking',
  contactUrl: 'http://localhost:3000/contact',
};

/** Every font-size in the HTML, in px. */
function fontSizes(html: string): number[] {
  return [...html.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
}

/** Shared by both templates: the house rules from CLAUDE.md. */
function expectHouseRules(html: string) {
  expect(html).toMatch(/^<!DOCTYPE html PUBLIC/);
  expect(html).toContain('lang="en-AU"');
  // Body text never below 16px.
  expect(Math.min(...fontSizes(html))).toBeGreaterThanOrEqual(16);
  // Gold and ochre fail AA on a light ground; neither belongs in an email.
  expect(html.toUpperCase()).not.toContain('#E8A134');
  expect(html.toUpperCase()).not.toContain('#CA7F3A');
}

describe('password reset email', () => {
  const render = () =>
    renderEmail(
      <PasswordResetEmail
        firstName="Ada"
        resetUrl={RESET_URL}
        expiresInMinutes={60}
      />,
    );

  it('has a plain subject', () => {
    expect(passwordResetSubject()).toBe('Reset your Studio Rags password');
  });

  it('puts the link in the button and in words, in both parts', () => {
    const { html, text } = render();

    expect(html).toContain(`href="${RESET_URL.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('Choose a new password');
    expect(text).toContain(RESET_URL);
    expect(text).toContain('Hi Ada,');
    expect(text).toContain('stops working after one hour');
    expect(text).toContain('If you did not ask for this');
  });

  it('keeps the preview line out of the plain-text part', () => {
    const { text } = render();

    expect(text).not.toContain('The link inside works for one hour');
  });

  it('follows the house rules', () => {
    expectHouseRules(render().html);
  });

  it('escapes what it is given', () => {
    const { html } = renderEmail(
      <PasswordResetEmail
        firstName={'<script>alert(1)</script>'}
        resetUrl={RESET_URL}
        expiresInMinutes={60}
      />,
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('booking confirmation email', () => {
  const render = (overrides: Partial<BookingConfirmationProps> = {}) =>
    renderEmail(<BookingConfirmationEmail {...BOOKING} {...overrides} />);

  it('names the class and the day in the subject', () => {
    expect(bookingConfirmationSubject(BOOKING)).toBe(
      "You're booked in: Batik for Beginners, Sat 16 Jan",
    );
  });

  it('gives every detail in Adelaide time, in the plain-text part too', () => {
    const { text } = render();

    expect(text).toContain('Batik for Beginners');
    expect(text).toContain(
      'Saturday 16 January 2027, 10:30 am to 1:30 pm (Adelaide time)',
    );
    expect(text).toContain('Sefton Park studio');
    expect(text).toContain('2 places');
    expect(text).toContain('$164');
    expect(text).toContain('SR-7K4M2');
    expect(text).toContain('An apron');
    expect(text).toContain('Old clothes you do not mind marking');
    expect(text).toContain('http://localhost:3000/contact');
  });

  describe('payment', () => {
    const PAY_LATER =
      'Payment is not taken online yet, and Rehana will let you know how to pay.';

    it('says the place is paid for, and what was paid, when payment was taken', () => {
      const { html, text } = render({ paid: true });

      for (const part of [html, text]) {
        expect(part).toContain(
          'Thank you for booking. Your place is confirmed and paid for. Here are the details to keep.',
        );
        expect(part).not.toContain(PAY_LATER);
      }
      expect(text).toMatch(/Paid\s+\$164/);
      expect(text).not.toMatch(/Price\s+\$/);
    });

    it('says the place is confirmed, gives the price and how paying will work, when nothing was paid', () => {
      const { html, text } = render({ paid: false });

      for (const part of [html, text]) {
        expect(part).toContain(
          'Thank you for booking. Your place is confirmed. Here are the details to keep.',
        );
        expect(part).toContain(PAY_LATER);
        expect(part).not.toMatch(/paid for/i);
      }
      expect(text).toMatch(/Price\s+\$164/);
      expect(text).not.toMatch(/\bPaid\b/);
    });

    it('says nothing about paying for a free class booked without payment', () => {
      const { text } = render({ paid: false, totalCents: 0 });

      expect(text).toMatch(/Price\s+\$0/);
      expect(text).not.toContain(PAY_LATER);
      expect(text).not.toMatch(/paid for/i);
    });
  });

  it('counts children, each with an adult, for the kids class', () => {
    expect(render({ requiresAccompanyingAdult: true }).text).toContain(
      '2 children, each with one accompanying adult',
    );
    expect(
      render({ requiresAccompanyingAdult: true, seats: 1 }).text,
    ).toContain('1 child, with one accompanying adult');
  });

  it('gives the Zoom link for an online class (ADR-015)', () => {
    const zoom = 'https://us02web.zoom.us/j/123456789';
    const { html, text } = render({
      deliveryMode: DeliveryMode.ONLINE,
      onlineJoinUrl: zoom,
      location: 'ignored for online classes',
    });

    expect(text).toContain('Online, over Zoom');
    expect(text).toContain(zoom);
    expect(html).toContain('Join the class on Zoom');
    expect(text).not.toContain('ignored for online classes');
  });

  it('says the link will follow when an online class has none yet', () => {
    const { text } = render({
      deliveryMode: DeliveryMode.ONLINE,
      onlineJoinUrl: null,
    });

    expect(text).toContain('You will get the link to join by email');
  });

  it('leaves out what to bring when there is nothing', () => {
    expect(render({ whatToBring: null }).text).not.toMatch(/what to bring/i);
  });

  it('follows the house rules', () => {
    expectHouseRules(render().html);
    expectHouseRules(render({ paid: false }).html);
    expectHouseRules(
      render({
        deliveryMode: DeliveryMode.ONLINE,
        onlineJoinUrl: 'https://zoom.us/j/1',
      }).html,
    );
  });
});

describe('formatting', () => {
  // Winter (UTC+9:30) and summer (UTC+10:30) in Adelaide.
  const winter = new Date('2027-07-10T00:30:00.000Z');
  const summer = new Date('2027-01-16T08:00:00.000Z');

  it('shows Adelaide time whatever the server runs in', () => {
    expect(formatTime(winter)).toBe('10:00 am');
    expect(formatTime(summer)).toBe('6:30 pm');
  });

  it('writes days in the words the website uses', () => {
    expect(formatLongDay(summer)).toBe('Saturday 16 January 2027');
    expect(formatShortDay(summer)).toBe('Sat 16 Jan');
  });

  it('writes money as the website does', () => {
    expect(formatPrice(8200)).toBe('$82');
    expect(formatPrice(8250)).toBe('$82.50');
    expect(formatPrice(8205)).toBe('$82.05');
  });
});
