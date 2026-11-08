import { Button, Link, Section, Text } from '@react-email/components';
import { DeliveryMode } from '@prisma/client';
import { Fragment } from 'react';
import {
  formatLongDay,
  formatPrice,
  formatShortDay,
  formatTime,
} from './format';
import { EmailLayout } from './layout';
import * as theme from './theme';

export const BOOKING_CONFIRMATION_TEMPLATE = 'booking-confirmation';

/**
 * Everything the confirmation says, as the booking stood when it was
 * confirmed. Values are passed in rather than read here, so the email shows
 * exactly what the customer booked even if the class changes later.
 */
export interface BookingConfirmationProps {
  /**
   * Whether money was taken for this booking. False for the interim
   * confirmation without payment (PAYMENT_MODE=none); the Stripe webhook
   * passes true. The caller says which, because only it knows: the email
   * must never claim a payment that did not happen.
   */
  paid: boolean;
  firstName: string;
  /** Human-readable, e.g. SR-7K4M2. */
  reference: string;
  workshopTitle: string;
  startsAt: Date;
  endsAt: Date;
  deliveryMode: DeliveryMode;
  /** The in-person venue. Ignored for an online class. */
  location: string | null;
  /**
   * The Zoom link for an online class (ADR-015). Only ever sent to the holder
   * of a confirmed booking, which this email is for.
   */
  onlineJoinUrl: string | null;
  /** Places booked. For a kids class, the number of children (ADR-016). */
  seats: number;
  requiresAccompanyingAdult: boolean;
  /**
   * The booking's total in cents, snapshotted on the booking: what was paid
   * when `paid`, otherwise the price still to pay.
   */
  totalCents: number;
  whatToBring: string | null;
  /** The site's contact page, for changes and questions. */
  contactUrl: string;
}

export const bookingConfirmationSubject = ({
  workshopTitle,
  startsAt,
}: Pick<BookingConfirmationProps, 'workshopTitle' | 'startsAt'>) =>
  `You're booked in: ${workshopTitle}, ${formatShortDay(startsAt)}`;

function describePlaces(seats: number, withAdult: boolean): string {
  if (withAdult) {
    return seats === 1
      ? '1 child, with one accompanying adult'
      : `${seats} children, each with one accompanying adult`;
  }
  return seats === 1 ? '1 place' : `${seats} places`;
}

/** One labelled line of the booking summary. */
function Detail({ label, children }: { label: string; children: string }) {
  return (
    <Text style={{ ...theme.text, margin: '0 0 12px' }}>
      <strong style={{ color: theme.colour.plum }}>{label}</strong>
      <br />
      {children}
    </Text>
  );
}

export function BookingConfirmationEmail(props: BookingConfirmationProps) {
  const online = props.deliveryMode === DeliveryMode.ONLINE;
  const when =
    `${formatLongDay(props.startsAt)}, ` +
    `${formatTime(props.startsAt)} to ${formatTime(props.endsAt)} (Adelaide time)`;
  const where = online
    ? 'Online, over Zoom'
    : (props.location ?? 'The studio in Sefton Park');
  const bring = props.whatToBring
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // A free class owes nothing, so it gets no word about paying.
  const toPay = !props.paid && props.totalCents > 0;
  const confirmed =
    props.seats === 1 ? 'Your place is confirmed' : 'Your places are confirmed';

  return (
    <EmailLayout
      title="You're booked in"
      preview={`${props.workshopTitle} on ${formatLongDay(props.startsAt)}. Your booking reference is ${props.reference}.`}
    >
      <Text style={theme.text}>Hi {props.firstName},</Text>
      <Text style={theme.text}>
        {props.paid
          ? `Thank you for booking. ${confirmed} and paid for. Here are the details to keep.`
          : `Thank you for booking. ${confirmed}. Here are the details to keep.`}
      </Text>

      <Section style={{ margin: '8px 0 8px' }}>
        <Detail label="Class">{props.workshopTitle}</Detail>
        <Detail label="When">{when}</Detail>
        <Detail label="Where">{where}</Detail>
        <Detail label="Places">
          {describePlaces(props.seats, props.requiresAccompanyingAdult)}
        </Detail>
        <Detail label={props.paid ? 'Paid' : 'Price'}>
          {formatPrice(props.totalCents)}
        </Detail>
        <Detail label="Booking reference">{props.reference}</Detail>
      </Section>

      {toPay && (
        <Text style={theme.text}>
          Payment is not taken online yet, and Rehana will let you know how to
          pay.
        </Text>
      )}

      {online && props.onlineJoinUrl && (
        <>
          <Text style={theme.subheading}>Joining online</Text>
          <Text style={theme.text}>
            The class runs live on Zoom. Keep this email: the same link opens
            the class on the day.
          </Text>
          <Section style={{ margin: '8px 0 16px' }}>
            <Button href={props.onlineJoinUrl} style={theme.button}>
              Join the class on Zoom
            </Button>
          </Section>
          <Text style={theme.muted}>
            If the button does not work, copy this link into your browser:{' '}
            <Link href={props.onlineJoinUrl} style={theme.link}>
              {props.onlineJoinUrl}
            </Link>
          </Text>
        </>
      )}
      {online && !props.onlineJoinUrl && (
        <>
          <Text style={theme.subheading}>Joining online</Text>
          <Text style={theme.text}>
            The class runs live on Zoom. You will get the link to join by email
            before the class.
          </Text>
        </>
      )}

      {bring && bring.length > 0 && (
        <>
          <Text style={theme.subheading}>What to bring</Text>
          <Text style={theme.text}>
            {bring.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </Text>
        </>
      )}

      <Text style={theme.subheading}>Need to change something?</Text>
      <Text style={theme.text}>
        Get in touch through the{' '}
        <Link href={props.contactUrl} style={theme.link}>
          contact page
        </Link>{' '}
        and mention your booking reference. Changes and cancellations follow the
        terms shown on the class page.
      </Text>

      <Text style={{ ...theme.text, margin: '24px 0 0' }}>
        See you soon,
        <br />
        Studio Rags
      </Text>
    </EmailLayout>
  );
}
