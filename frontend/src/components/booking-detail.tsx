"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatLongDay, formatTime, formatTimeRange } from "@/lib/adelaide";
import { COOKIES, OFFLINE, WAKING } from "@/lib/api-messages";
import {
  type Refusal,
  HOLD_MINUTES,
  bookPath,
  bookingPath,
  clockOffset,
  holdMilestone,
  holdTimeLeft,
  milestoneMessage,
  refusalOf,
} from "@/lib/booking";
import type { BookingView } from "@/lib/booking-types";
import { formatPlaces, formatPrice, formatPriceBreakdown } from "@/lib/format";
import { isCsrfRefusal, session } from "@/lib/session";
import { ApiUnavailable } from "./api-unavailable";
import {
  ActionBar,
  BookingSteps,
  ClassSummary,
  DateTile,
  Icon,
  type IconName,
  Loading,
  SignInToBook,
  SummaryRow,
  actionButton,
  pageHeading,
  placeOf,
} from "./booking-parts";
import { FormAlert } from "./form-fields";
import { buttonOutline, textLink } from "./ui";

type Load =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "not-found" }
  | { state: "unavailable" }
  /** `offset`: how far the API's clock is ahead of this device's. */
  | { state: "ready"; booking: BookingView; offset: number };

/**
 * One booking's page, whatever state it is in: a hold to confirm, a hold that
 * ran out, a confirmed booking, or a cancelled one. It is the same address
 * throughout, so "Your bookings" and the confirmation email can both link to
 * it, and refreshing the page always shows the API's answer.
 */
export function BookingDetail({ reference }: { reference: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  /** A refusal from confirming, which the booking alone does not show. */
  const [refusal, setRefusal] = useState<{ kind: Refusal; detail?: string } | null>(null);
  /** True once something on this page changed the view, so focus follows. */
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    let live = true;
    void loadBooking(reference).then((next) => {
      if (live) setLoad(next);
    });
    return () => {
      live = false;
    };
  }, [reference]);

  if (load.state === "loading") return <Loading>Loading your booking…</Loading>;
  if (load.state === "unavailable") return <ApiUnavailable what="your booking" />;
  if (load.state === "signed-out") {
    return (
      <SignInToBook
        next={bookingPath(reference)}
        title="Sign in to see this booking"
        lede="Bookings are kept in the account that made them."
      />
    );
  }
  if (load.state === "not-found") return <NotFound />;

  const { booking, offset } = load;

  function onConfirmed(confirmed: BookingView) {
    setMoved(true);
    setLoad({ state: "ready", booking: confirmed, offset });
  }
  function onRefused(kind: Refusal, detail?: string) {
    setMoved(true);
    setRefusal({ kind, detail });
    // The booking's own status has changed too: fetch it, so the page and
    // the API agree.
    if (kind === "hold-lapsed" || kind === "booking-cancelled") {
      void loadBooking(reference).then((next) => {
        if (next.state === "ready") setLoad(next);
      });
    }
  }

  if (refusal?.kind === "session-not-on-sale") {
    return <NotOnSale booking={booking} detail={refusal.detail} focus={moved} />;
  }
  if (refusal?.kind === "hold-lapsed" || booking.status === "EXPIRED") {
    return <Lapsed booking={booking} focus={moved} />;
  }
  if (
    refusal?.kind === "booking-cancelled" ||
    booking.status === "CANCELLED" ||
    booking.status === "REFUNDED"
  ) {
    return <Cancelled booking={booking} focus={moved} />;
  }
  if (booking.status === "CONFIRMED") return <Confirmed booking={booking} focus={moved} />;
  return (
    <Hold
      booking={booking}
      offset={offset}
      paymentRequired={refusal?.kind === "payment-required"}
      onConfirmed={onConfirmed}
      onRefused={onRefused}
    />
  );
}

/** GET /bookings/:reference, as the page state it leads to. Never throws. */
async function loadBooking(reference: string): Promise<Load> {
  try {
    const res = await session.request(`/bookings/${encodeURIComponent(reference)}`);
    const receivedAt = Date.now();
    if (res.ok) {
      const { booking } = (await res.json()) as { booking: BookingView };
      return { state: "ready", booking, offset: clockOffset(res.headers.get("date"), receivedAt) };
    }
    if (res.status === 401) {
      // Clears the signed-in hint, so the header says "Sign in" too.
      await session.me().catch(() => null);
      return { state: "signed-out" };
    }
    if (res.status === 404) return { state: "not-found" };
    return { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

/** Moves focus to a view's heading when the view replaced another one. */
function useFocusHeading(focus: boolean) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return ref;
}

/** The time now, once a second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const isKids = (b: BookingView) => b.session.workshop.productType === "KIDS";

function Summary({ booking, headingLevel = 2 }: { booking: BookingView; headingLevel?: 2 | 3 }) {
  const s = booking.session;
  const kids = isKids(booking);
  return (
    <ClassSummary
      title={s.workshop.title}
      startsAt={s.startsAt}
      endsAt={s.endsAt}
      deliveryMode={s.workshop.deliveryMode}
      location={s.location}
      headingLevel={headingLevel}
    >
      <dl>
        <SummaryRow label={kids ? "Children" : "Places"}>
          {formatPlaces(booking.seats, kids)}
        </SummaryRow>
        {booking.attendees.length > 0 && (
          <SummaryRow label="Who’s coming">{attendeeList(booking)}</SummaryRow>
        )}
        <SummaryRow label="Photos">
          {booking.photoConsentOptOut
            ? kids
              ? "Please leave us out"
              : "Please leave me out"
            : "Happy to be in photos"}
        </SummaryRow>
        {booking.notes && (
          <SummaryRow label="Your notes" block>
            {booking.notes}
          </SummaryRow>
        )}
        <SummaryRow label="Reference">{booking.reference}</SummaryRow>
      </dl>
    </ClassSummary>
  );
}

/** "Sam (8), Noor (11)" */
function attendeeList(booking: BookingView): string {
  return booking.attendees
    .map((a) => (a.age === null ? a.firstName : `${a.firstName} (${a.age})`))
    .join(", ");
}

/** A booking reference never breaks across lines. */
function Ref({ children }: { children: string }) {
  return <span className="whitespace-nowrap">{children}</span>;
}

function unitCents(booking: BookingView): number {
  return booking.seats > 0 ? Math.round(booking.subtotalCents / booking.seats) : 0;
}

// ─── Step 2: the hold ───────────────────────────────────────────────────────

function Hold({
  booking,
  offset,
  paymentRequired,
  onConfirmed,
  onRefused,
}: {
  booking: BookingView;
  offset: number;
  paymentRequired: boolean;
  onConfirmed: (booking: BookingView) => void;
  onRefused: (kind: Refusal, detail?: string) => void;
}) {
  const now = useNow() + offset;
  const msLeft = booking.holdExpiresAt ? Date.parse(booking.holdExpiresAt) - now : 0;
  const milestone = holdMilestone(msLeft);

  // Time up: the places are going back on sale. The page says so at once,
  // rather than waiting for a confirm that would be refused.
  if (milestone === "over") return <Lapsed booking={booking} focus />;

  const s = booking.session;
  return (
    <div className="flex flex-col gap-6">
      <BookingSteps current={1} />
      <div>
        <h1 className={pageHeading}>Check and confirm</h1>
        <p className="mt-2 text-[1.1rem] text-body">
          Your places are held, but not booked yet.
        </p>
      </div>

      {/* Calm: whole minutes, in words, no ticking seconds and no red. Only
          the five- and one-minute marks are announced to screen readers. */}
      <div className="flex items-center gap-4 rounded-[var(--radius-card)] bg-sand p-4 text-sand-ink sm:p-5">
        <Icon name="clock" className="size-8" />
        <div>
          <p className="font-semibold">
            Held for you: <span className="whitespace-nowrap">{holdTimeLeft(msLeft)}</span>
          </p>
          <p>If you don’t confirm in time, the places go back on sale.</p>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {milestoneMessage(milestone)}
      </p>

      <Summary booking={booking} />

      <p className="flex gap-3 rounded-[var(--radius-card)] bg-lilac p-4 text-purple sm:p-5">
        <Icon name="info" className="mt-0.5 size-6" />
        <span>
          <strong>Online payment isn’t switched on yet,</strong> so there’s nothing to pay here.
          Confirming books your places.
        </span>
      </p>

      <p>
        <Link
          href={bookPath(s.workshop.slug, s.id, booking.reference)}
          className={`${textLink} inline-flex min-h-11 items-center`}
        >
          Change the details
        </Link>
      </p>

      <ConfirmStep
        booking={booking}
        paymentRequired={paymentRequired}
        onConfirmed={onConfirmed}
        onRefused={onRefused}
      />
    </div>
  );
}

/**
 * The action that turns a hold into a booking. Today it confirms without
 * payment (decided 2026-11-08). When payments switch on, a payment form
 * takes this component's place with the same props: the summary, the
 * countdown and every refusal above it stay as they are.
 */
function ConfirmStep({
  booking,
  paymentRequired,
  onConfirmed,
  onRefused,
}: {
  booking: BookingView;
  paymentRequired: boolean;
  onConfirmed: (booking: BookingView) => void;
  onRefused: (kind: Refusal, detail?: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const kids = isKids(booking);

  const message = paymentRequired
    ? "This booking needs to be paid for before it can be confirmed, and that can’t be done here yet."
    : failure;

  useEffect(() => {
    if (message) alertRef.current?.scrollIntoView({ block: "nearest" });
  }, [message]);

  async function confirm() {
    if (sending || paymentRequired) return;
    setSending(true);
    setFailure(null);
    try {
      const res = await session.request(
        `/bookings/${encodeURIComponent(booking.reference)}/confirm`,
        { method: "POST" },
      );
      if (res.ok) {
        const body = (await res.json()) as { booking: BookingView };
        onConfirmed(body.booking);
        return;
      }
      if (await isCsrfRefusal(res)) setFailure(COOKIES);
      else if (res.status === 409) {
        const problem = (await res.json().catch(() => null)) as { detail?: string } | null;
        const kind = refusalOf(problem);
        if (kind) {
          // Most refusals replace this view, but payment-required keeps it.
          setSending(false);
          onRefused(kind, problem?.detail);
          return;
        }
        setFailure(problem?.detail ?? "This booking can’t be confirmed. Please send Rehana a message.");
      } else if (res.status === 401) {
        setFailure("Please sign in again, then confirm. Your places stay held until the time runs out.");
        await session.me().catch(() => null);
      } else if (res.status === 404) {
        setFailure("We couldn’t find this booking. It may belong to another account.");
      } else if (res.status === 429) {
        setFailure("You’ve tried several times in a minute. Please wait a minute, then try again.");
      } else {
        setFailure(WAKING);
      }
    } catch {
      setFailure(OFFLINE);
    }
    setSending(false);
  }

  return (
    <>
      {message && (
        // Scrolled into view clear of the action bar below it.
        <div ref={alertRef} className="scroll-mb-40">
          <FormAlert message={message}>
            {paymentRequired && (
              <p className="mt-2 font-normal">
                <Link href="/contact" className={textLink}>
                  Send Rehana a message
                </Link>
              </p>
            )}
          </FormAlert>
        </div>
      )}
      <ActionBar
        total={formatPrice(booking.totalCents)}
        breakdown={formatPriceBreakdown(booking.seats, unitCents(booking), kids)}
      >
        {/* aria-disabled, not disabled: a disabled button drops focus to
            the page just as the refusal is announced. */}
        <button
          type="button"
          onClick={confirm}
          className={actionButton}
          aria-disabled={sending || paymentRequired}
        >
          {sending ? "Confirming…" : "Confirm booking"}
        </button>
      </ActionBar>
    </>
  );
}

// ─── Refusals ───────────────────────────────────────────────────────────────

function Lapsed({ booking, focus }: { booking: BookingView; focus: boolean }) {
  const heading = useFocusHeading(focus);
  const s = booking.session;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 ref={heading} tabIndex={-1} className={`${pageHeading} focus:outline-none`}>
          Your hold has run out
        </h1>
        <p className="mt-3 text-[1.1rem] text-body">
          We held these places for {HOLD_MINUTES} minutes, and the time is up, so they’ve gone
          back on sale. If the date still has room, you can hold them again. Your answers are kept.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href={bookPath(s.workshop.slug, s.id, booking.reference)} className={actionButton}>
          Start again
        </Link>
        <Link
          href={`/classes/${encodeURIComponent(s.workshop.slug)}#dates-heading`}
          className={buttonOutline}
        >
          Choose another date
        </Link>
      </div>
      <Summary booking={booking} />
    </div>
  );
}

function NotOnSale({
  booking,
  detail,
  focus,
}: {
  booking: BookingView;
  detail?: string;
  focus: boolean;
}) {
  const heading = useFocusHeading(focus);
  const slug = booking.session.workshop.slug;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 ref={heading} tabIndex={-1} className={`${pageHeading} focus:outline-none`}>
          This date can’t be booked now
        </h1>
        <p className="mt-3 text-[1.1rem] text-body">
          {detail ?? "It may have started already, or Rehana has had to cancel it."} Nothing has
          been booked.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href={`/classes/${encodeURIComponent(slug)}#dates-heading`} className={actionButton}>
          Choose another date
        </Link>
        <Link href="/contact" className={buttonOutline}>
          Ask Rehana
        </Link>
      </div>
      <Summary booking={booking} />
    </div>
  );
}

function Cancelled({ booking, focus }: { booking: BookingView; focus: boolean }) {
  const heading = useFocusHeading(focus);
  const s = booking.session;
  // A hold that was never confirmed was replaced by a newer one (ADR-049).
  const replaced = booking.confirmedAt === null;
  const title = replaced
    ? "These places are no longer held"
    : booking.status === "REFUNDED"
      ? "This booking was cancelled and refunded"
      : "This booking was cancelled";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 ref={heading} tabIndex={-1} className={`${pageHeading} focus:outline-none`}>
          {title}
        </h1>
        <p className="mt-3 text-[1.1rem] text-body">
          {replaced ? (
            "The details were changed, so this hold was replaced by a newer one. Your bookings are all in your account."
          ) : (
            <>
              If you didn’t expect this,{" "}
              <Link href="/contact" className={textLink}>
                send Rehana a message
              </Link>{" "}
              and mention <Ref>{booking.reference}</Ref>.
            </>
          )}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/account#bookings" className={actionButton}>
          See your bookings
        </Link>
        {replaced && (
          <Link href={bookPath(s.workshop.slug, s.id, booking.reference)} className={buttonOutline}>
            Book this date again
          </Link>
        )}
      </div>
      <Summary booking={booking} />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={pageHeading}>We couldn’t find that booking</h1>
        <p className="mt-3 text-[1.1rem] text-body">
          Check the reference, or find it among your bookings. A booking made in another account
          only shows there.
        </p>
      </div>
      <div>
        <Link href="/account#bookings" className={actionButton}>
          See your bookings
        </Link>
      </div>
    </div>
  );
}

// ─── Booked ─────────────────────────────────────────────────────────────────

function Confirmed({ booking, focus }: { booking: BookingView; focus: boolean }) {
  const heading = useFocusHeading(focus);
  const s = booking.session;
  const online = s.workshop.deliveryMode === "ONLINE";
  const kids = isKids(booking);
  const [now] = useState(() => Date.now());
  const finished = Date.parse(s.endsAt) <= now;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 ref={heading} tabIndex={-1} className={`${pageHeading} focus:outline-none`}>
          {finished ? "Your booking" : "You’re booked!"}
          {/* Ochre only at display size (24px and up), as CLAUDE.md allows. */}
          <span className="mt-1 block text-[clamp(1.6rem,4.5vw,2.1rem)] font-semibold text-ochre">
            {finished
              ? `This class took place on ${formatLongDay(s.startsAt)}.`
              : `See you on ${formatLongDay(s.startsAt)}.`}
          </span>
        </h1>
        {!finished && (
          <p className="mt-3 text-[1.1rem] text-body">
            A confirmation email is on its way, with everything on this page.
          </p>
        )}
      </div>

      <Ticket booking={booking} />

      {!finished && (
        <section
          aria-labelledby="next-heading"
          className="rounded-[var(--radius-card)] border-2 border-line bg-card p-5 sm:p-6"
        >
          <h2 id="next-heading" className="font-display text-[1.5rem] font-semibold text-plum">
            What happens next
          </h2>
          <ul className="mt-4 flex flex-col gap-5">
            <NextStep icon="mail" title="Check your email">
              Your confirmation has the date, the place and your reference. If it hasn’t arrived
              in a few minutes, check your junk folder.
            </NextStep>
            {online ? (
              <NextStep icon="video" title="Join on Zoom">
                The class starts at {formatTime(s.startsAt)}, Adelaide time.{" "}
                {s.onlineJoinUrl ? (
                  <>
                    Your link is in the email, and here:{" "}
                    <a
                      href={s.onlineJoinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={textLink}
                    >
                      open the Zoom link
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    .
                  </>
                ) : (
                  "Rehana will email you the Zoom link before the class."
                )}
              </NextStep>
            ) : (
              <NextStep icon="pin" title="Come to the studio">
                {placeOf(s.workshop.deliveryMode, s.location)}. Please arrive a few minutes before{" "}
                {formatTime(s.startsAt)}.
                {kids ? " Each child comes with one adult." : ""}
              </NextStep>
            )}
            <NextStep icon="message" title="Need to change or cancel?">
              That can’t be done online yet.{" "}
              <Link href="/contact" className={textLink}>
                Send Rehana a message
              </Link>{" "}
              and mention your reference, <Ref>{booking.reference}</Ref>.
            </NextStep>
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href="/account#bookings" className={actionButton}>
          See your bookings
        </Link>
        <Link href="/classes" className={buttonOutline}>
          Browse more classes
        </Link>
      </div>
    </div>
  );
}

/**
 * The booking as a ticket: purple, with the reference in gold. Gold is only
 * ever on purple here, as the colour rule asks (4.55:1).
 */
function Ticket({ booking }: { booking: BookingView }) {
  const s = booking.session;
  const kids = isKids(booking);
  return (
    <section
      aria-label="Your booking"
      className="on-dark relative overflow-hidden rounded-[var(--radius-card)] bg-purple text-mist"
    >
      <div className="flex gap-4 p-5 sm:p-6">
        <DateTile iso={s.startsAt} tone="gold" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-display text-[1.45rem] leading-tight font-semibold text-white">
            {s.workshop.title}
          </h2>
          <p className="font-semibold text-white">
            <time dateTime={s.startsAt}>{formatLongDay(s.startsAt)}</time>
          </p>
          <p>{formatTimeRange(s.startsAt, s.endsAt)}</p>
          <p>{placeOf(s.workshop.deliveryMode, s.location)}</p>
        </div>
      </div>
      {/* A ticket's tear line, with the paper showing through at each end. */}
      <div aria-hidden="true" className="relative border-t-2 border-dashed border-white/30">
        <span className="absolute -top-3.5 -left-3.5 size-7 rounded-full bg-paper" />
        <span className="absolute -top-3.5 -right-3.5 size-7 rounded-full bg-paper" />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-5 sm:p-6">
        <div className="col-span-2">
          <dt>Reference</dt>
          <dd className="font-display text-[2rem] leading-tight font-black tracking-wide text-gold">
            {booking.reference}
          </dd>
        </div>
        <div>
          <dt>{kids ? "Children" : "Places"}</dt>
          <dd className="font-semibold text-white">{formatPlaces(booking.seats, kids)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd className="font-semibold text-white">{formatPrice(booking.totalCents)}</dd>
        </div>
        {booking.attendees.length > 0 && (
          <div className="col-span-2">
            <dt>Who’s coming</dt>
            <dd className="font-semibold text-white">{attendeeList(booking)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function NextStep({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-lilac text-purple">
        <Icon name={icon} className="size-5" />
      </span>
      <div>
        <h3 className="font-semibold text-plum">{title}</h3>
        <p className="text-body">{children}</p>
      </div>
    </li>
  );
}
