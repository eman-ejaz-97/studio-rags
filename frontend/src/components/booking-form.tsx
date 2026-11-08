"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { COOKIES, OFFLINE, WAKING } from "@/lib/api-messages";
import {
  type BookingDraft,
  type DraftErrors,
  type PhotoChoice,
  HOLD_MINUTES,
  MAX_PLACES,
  ageRange,
  bookPath,
  bookingPath,
  childField,
  draftFromBooking,
  fieldOrder,
  isLiveHold,
  placesLimit,
  refusalOf,
  takesAttendees,
  toBookingRequest,
  validateDraft,
} from "@/lib/booking";
import type { AvailabilityView, BookingView } from "@/lib/booking-types";
import type { DeliveryMode, ProductType } from "@/lib/catalogue-types";
import { formatPlaces, formatPrice, formatPriceBreakdown, formatSeatsLeft } from "@/lib/format";
import { errorMessages, isCsrfRefusal, session } from "@/lib/session";
import { useHydrated } from "@/lib/use-hydrated";
import { useSignedInName } from "@/lib/use-signed-in-name";
import { ActionBar, Icon, Loading, SignInToBook, actionButton } from "./booking-parts";
import { FieldError, FormAlert, FormNotice, fieldClass } from "./form-fields";
import { buttonOutline, textLink } from "./ui";

/** What the form needs to know about the class: picked from WorkshopDetail. */
export interface BookableClass {
  slug: string;
  title: string;
  productType: ProductType;
  deliveryMode: DeliveryMode;
  minAge: number | null;
  maxAge: number | null;
}

/** And about the date: picked from SessionView. */
export interface BookableDate {
  id: string;
  startsAt: string;
  priceCents: number;
  seatsLeft: number;
}

type Failure = { message: string; details?: string[]; fix?: React.ReactNode };

/**
 * Step 1 of booking. The page around it is rendered on the server; this part
 * waits for the browser, because only the browser knows whether someone is
 * signed in (ADR-042). A visitor is asked to sign in and comes back here.
 */
export function BookingForm({
  workshop,
  date,
  from,
}: {
  workshop: BookableClass;
  date: BookableDate;
  /** An earlier booking's reference, to start from its answers. */
  from?: string;
}) {
  const hydrated = useHydrated();
  const name = useSignedInName();

  if (!hydrated) return <Loading>Loading the booking form…</Loading>;
  if (name === null) return <SignInToBook next={bookPath(workshop.slug, date.id, from)} />;
  return <DetailsForm workshop={workshop} date={date} from={from} />;
}

const EMPTY_CHILD = { firstName: "", age: "" };

function DetailsForm({
  workshop,
  date,
  from,
}: {
  workshop: BookableClass;
  date: BookableDate;
  from?: string;
}) {
  const router = useRouter();
  const withChildren = takesAttendees(workshop);
  const kids = workshop.productType === "KIDS";
  const classDates = `/classes/${encodeURIComponent(workshop.slug)}#dates-heading`;

  const [draft, setDraft] = useState<BookingDraft>({
    seats: 1,
    children: [EMPTY_CHILD],
    photo: null,
    notes: "",
  });
  const [seatsLeft, setSeatsLeft] = useState(date.seatsLeft);
  const [onSale, setOnSale] = useState(true);
  /** The booking named by ?from=, when it is this customer's and for this date. */
  const [earlier, setEarlier] = useState<{ reference: string; seats: number; live: boolean } | null>(
    null,
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sending, setSending] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  // The server's count can be a minute old (ADR-034); this one is live.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/sessions/${encodeURIComponent(date.id)}/availability`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then((res) => (res.ok ? (res.json() as Promise<AvailabilityView>) : null))
      .then((a) => {
        if (!a) return;
        setSeatsLeft(a.seatsLeft);
        setOnSale(a.onSale);
      })
      .catch(() => {
        // Aborted, or the API is asleep: the server's count stands, and the
        // API checks again when the places are held.
      });
    return () => controller.abort();
  }, [date.id]);

  // "Change the details" and "Start again" bring the earlier answers back.
  useEffect(() => {
    if (!from) return;
    let live = true;
    session
      .request(`/bookings/${encodeURIComponent(from)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ booking: BookingView }>) : null))
      .then((body) => {
        const b = body?.booking;
        if (!live || !b || b.session.id !== date.id) return;
        const answers = draftFromBooking(b);
        setDraft({
          ...answers,
          children: answers.children.length > 0 ? answers.children : [EMPTY_CHILD],
        });
        setEarlier({ reference: b.reference, seats: b.seats, live: isLiveHold(b, Date.now()) });
      })
      .catch(() => {
        // Only a convenience: the form still works empty.
      });
    return () => {
      live = false;
    };
  }, [from, date.id]);

  useEffect(() => {
    if (failure) alertRef.current?.scrollIntoView({ block: "nearest" });
  }, [failure]);

  // Places this customer already holds on the date count as theirs to change.
  const alreadyHeld = earlier?.live ? earlier.seats : 0;
  const placesLeft = seatsLeft + alreadyHeld;
  const limit = placesLimit(seatsLeft, alreadyHeld);

  if (!onSale) {
    return (
      <DateUnavailable
        title="This date can no longer be booked"
        body="It may have started already, or Rehana has had to cancel it."
        classDates={classDates}
      />
    );
  }
  if (limit === 0) {
    return (
      <DateUnavailable
        title="This date has just filled up"
        body="Someone booked the last places a moment ago. Another date may still have room."
        classDates={classDates}
      />
    );
  }

  function clearError(key: string) {
    if (!errors[key]) return;
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function setSeats(seats: number) {
    setDraft((d) => ({
      ...d,
      seats,
      // Kept when the number goes down, so going back up restores a name.
      children:
        d.children.length >= seats
          ? d.children
          : [...d.children, ...Array.from({ length: seats - d.children.length }, () => EMPTY_CHILD)],
    }));
    clearError("seats");
  }

  function setChild(index: number, field: "firstName" | "age", value: string) {
    setDraft((d) => ({
      ...d,
      children: d.children.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    }));
    clearError(childField(index, field));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const form = event.currentTarget;
    const found = validateDraft(draft, { ...workshop, placesLeft });
    setErrors(found);
    const first = fieldOrder(draft, withChildren).find((key) => found[key]);
    if (first) {
      setFailure(null);
      form.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }

    setSending(true);
    setFailure(null);
    try {
      const res = await session.post("/bookings", toBookingRequest(date.id, draft, withChildren));
      if (res.ok) {
        const { booking } = (await res.json()) as { booking: BookingView };
        // Stays "Holding…" until the next page arrives.
        router.push(bookingPath(booking.reference));
        return;
      }
      setFailure(await describe(res));
    } catch {
      setFailure({ message: OFFLINE });
    }
    setSending(false);
  }

  /** The words, and where possible a way forward, for a refused hold. */
  async function describe(res: Response): Promise<Failure> {
    if (await isCsrfRefusal(res)) return { message: COOKIES };
    if (res.status === 401) {
      // Signed out elsewhere, or the session ran out. Asking the API clears
      // the hint, and the form gives way to "Sign in to book".
      await session.me().catch(() => null);
      return { message: "Please sign in again to book." };
    }
    if (res.status === 429) {
      return {
        message: "You’ve tried several times in a minute. Please wait a minute, then try again.",
      };
    }
    if (res.status >= 500) return { message: WAKING };

    const body = (await res.clone().json().catch(() => null)) as {
      seatsLeft?: number;
      detail?: string;
    } | null;
    const otherDate = (
      <p className="mt-2 font-normal">
        <Link href={classDates} className={textLink}>
          Choose another date
        </Link>
      </p>
    );

    if (refusalOf(body) === "session-full" && typeof body?.seatsLeft === "number") {
      const left = body.seatsLeft;
      setSeatsLeft(Math.max(0, left - alreadyHeld));
      if (left === 0) return { message: "Sorry, this date has just filled up.", fix: otherDate };
      return {
        message:
          left === 1
            ? "Only 1 place is left on this date now."
            : `Only ${left} places are left on this date now.`,
        fix: (
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-normal">
            <button
              type="button"
              className={buttonOutline}
              onClick={() => {
                setSeats(Math.min(left, MAX_PLACES));
                setFailure(null);
              }}
            >
              Change to {formatPlaces(Math.min(left, MAX_PLACES), kids)}
            </button>
            <Link href={classDates} className={textLink}>
              Choose another date
            </Link>
          </p>
        ),
      };
    }
    if (refusalOf(body) === "session-not-on-sale") {
      return { message: body?.detail ?? "This date can no longer be booked.", fix: otherDate };
    }
    if (res.status === 404) {
      return { message: "This date is no longer on sale.", fix: otherDate };
    }
    return { message: "Some details need another look.", details: await errorMessages(res) };
  }

  const total = date.priceCents * draft.seats;
  const seatsHint = "seats-hint";
  const seatsError = errors.seats ? "seats-error" : undefined;

  // The total and the button sit after the form, not in it: a sticky bar
  // cannot rise above the top of its container, and the form starts too low
  // on a phone for the bar to reach the foot of the screen. The page's column
  // is its container instead, and `form=` keeps the button submitting this.
  return (
    <>
      <form id={FORM_ID} noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        {earlier && (
          <FormNotice>
            <p>
              {earlier.live
                ? `You’re changing booking ${earlier.reference}. Its places stay yours until you hold the new ones.`
                : `We’ve kept your answers from booking ${earlier.reference}. Check them, then hold your places again.`}
            </p>
          </FormNotice>
        )}

        {/* How many: a stepper, so a thumb never needs the keyboard. */}
        <fieldset
          aria-describedby={[seatsHint, seatsError].filter(Boolean).join(" ")}
          className="rounded-[var(--radius-card)] border-2 border-line bg-card p-5 sm:p-6"
        >
          <legend className="float-left w-full font-display text-[1.35rem] font-semibold text-plum">
            {kids ? "How many children?" : "How many places?"}
          </legend>
          <div className="clear-both flex items-center gap-4 pt-4">
            <StepButton
              icon="minus"
              label={kids ? "One child fewer" : "One place fewer"}
              disabled={draft.seats <= 1}
              onClick={() => setSeats(draft.seats - 1)}
              field="seats"
            />
            <output aria-live="polite" className="min-w-[6.5rem] text-center">
              <span className="block font-display text-[2.2rem] leading-none font-black text-plum">
                {draft.seats}
              </span>
              <span className="text-muted">
                {kids ? (draft.seats === 1 ? "child" : "children") : draft.seats === 1 ? "place" : "places"}
              </span>
            </output>
            <StepButton
              icon="plus"
              label={kids ? "One child more" : "One place more"}
              disabled={draft.seats >= limit}
              onClick={() => setSeats(draft.seats + 1)}
            />
          </div>
          <div id={seatsHint} className="mt-4 flex flex-col gap-1 text-subtle">
            {kids && <p>Each child comes with one adult, and one place covers you both.</p>}
            <p>
              {formatSeatsLeft(placesLeft)} on this date. One booking takes up to {MAX_PLACES}; for a
              bigger group,{" "}
              <Link href="/contact" className={textLink}>
                send Rehana a message
              </Link>
              .
            </p>
          </div>
          <div className="mt-2">
            <FieldError id="seats-error" error={errors.seats} />
          </div>
        </fieldset>

        {withChildren && (
          <fieldset className="rounded-[var(--radius-card)] border-2 border-line bg-card p-5 sm:p-6">
            <legend className="float-left w-full font-display text-[1.35rem] font-semibold text-plum">
              {kids ? "About the children" : "Who’s coming"}
            </legend>
            <p className="clear-both pt-2 text-subtle">
              First names and ages, so Rehana knows who’s coming. This class is for{" "}
              {ageRange(workshop)}.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              {draft.children.slice(0, draft.seats).map((child, i) => (
                <ChildFields
                  key={i}
                  index={i}
                  child={child}
                  noun={kids ? "Child" : "Guest"}
                  errors={errors}
                  onChange={setChild}
                />
              ))}
            </div>
          </fieldset>
        )}

        <PhotoQuestion
          kids={kids}
          value={draft.photo}
          error={errors.photo}
          onChange={(photo) => {
            setDraft((d) => ({ ...d, photo }));
            clearError("photo");
          }}
        />

        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border-2 border-line bg-card p-5 sm:p-6">
          <label htmlFor="notes" className="font-display text-[1.35rem] font-semibold text-plum">
            Anything Rehana should know?{" "}
            <span className="font-sans text-base font-normal text-subtle">(optional)</span>
          </label>
          <p id="notes-hint" className="text-subtle">
            Access needs, allergies, or a question. Up to 500 characters.
          </p>
          <textarea
            id="notes"
            name="notes"
            data-field="notes"
            rows={3}
            value={draft.notes}
            onChange={(e) => {
              setDraft((d) => ({ ...d, notes: e.target.value }));
              clearError("notes");
            }}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={["notes-hint", errors.notes && "notes-error"].filter(Boolean).join(" ")}
            className={fieldClass(Boolean(errors.notes))}
          />
          <FieldError id="notes-error" error={errors.notes} />
        </div>

        <p className="flex gap-3 text-body">
          <Icon name="clock" className="mt-0.5 size-6 text-purple" />
          <span>
            Next, you’ll check everything and confirm. We’ll hold your places for {HOLD_MINUTES}{" "}
            minutes while you do.
          </span>
        </p>
      </form>

      {failure && (
        // Scrolled into view clear of the action bar below it.
        <div ref={alertRef} className="scroll-mb-40">
          <FormAlert message={failure.message} details={failure.details}>
            {failure.fix}
          </FormAlert>
        </div>
      )}

      <ActionBar
        total={formatPrice(total)}
        breakdown={formatPriceBreakdown(draft.seats, date.priceCents, kids)}
      >
        {/* aria-disabled, not disabled, while sending: a disabled button drops
            focus to the page, and onSubmit already ignores a second press. */}
        <button type="submit" form={FORM_ID} className={actionButton} aria-disabled={sending}>
          {sending ? "Holding your places…" : `Hold ${formatPlaces(draft.seats)}`}
        </button>
      </ActionBar>
    </>
  );
}

const FORM_ID = "booking-details";

/**
 * − and +. Stays focusable at the ends (aria-disabled rather than disabled),
 * so focus is not lost to the page when the last press reaches the limit.
 */
function StepButton({
  icon,
  label,
  disabled,
  onClick,
  field,
}: {
  icon: "minus" | "plus";
  label: string;
  disabled: boolean;
  onClick: () => void;
  field?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      data-field={field}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={`grid size-12 shrink-0 place-items-center rounded-full border-2 transition-colors ${
        disabled
          ? "cursor-not-allowed border-field-line text-subtle"
          : "border-purple text-purple hover:bg-lilac"
      }`}
    >
      <Icon name={icon} className="size-6" />
    </button>
  );
}

function ChildFields({
  index,
  child,
  noun,
  errors,
  onChange,
}: {
  index: number;
  child: { firstName: string; age: string };
  noun: string;
  errors: DraftErrors;
  onChange: (index: number, field: "firstName" | "age", value: string) => void;
}) {
  const nameKey = childField(index, "firstName");
  const ageKey = childField(index, "age");
  const nameError = errors[nameKey];
  const ageError = errors[ageKey];
  return (
    <fieldset className="rounded-[var(--radius-field)] bg-paper p-4">
      <legend className="float-left w-full font-semibold text-plum">
        {noun} {index + 1}
      </legend>
      {/* The age box is narrow, so both errors sit under the pair, full width. */}
      <div className="clear-both grid grid-cols-[minmax(0,1fr)_6rem] gap-3 pt-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={nameKey} className="text-muted">
            First name
          </label>
          <input
            id={nameKey}
            name={nameKey}
            data-field={nameKey}
            type="text"
            autoComplete="off"
            autoCapitalize="words"
            value={child.firstName}
            onChange={(e) => onChange(index, "firstName", e.target.value)}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${nameKey}-error` : undefined}
            className={fieldClass(Boolean(nameError))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ageKey} className="text-muted">
            Age
          </label>
          <input
            id={ageKey}
            name={ageKey}
            data-field={ageKey}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={child.age}
            onChange={(e) => onChange(index, "age", e.target.value)}
            aria-invalid={ageError ? true : undefined}
            aria-describedby={ageError ? `${ageKey}-error` : undefined}
            className={fieldClass(Boolean(ageError))}
          />
        </div>
      </div>
      {(nameError || ageError) && (
        <div className="mt-2 flex flex-col gap-1">
          <FieldError id={`${nameKey}-error`} error={nameError} />
          <FieldError id={`${ageKey}-error`} error={ageError} />
        </div>
      )}
    </fieldset>
  );
}

/**
 * Asked outright, with neither answer chosen, rather than consent assumed by
 * turning up (ADR-018). The answer is shown to Rehana before the class.
 */
function PhotoQuestion({
  kids,
  value,
  error,
  onChange,
}: {
  kids: boolean;
  value: PhotoChoice | null;
  error?: string;
  onChange: (value: PhotoChoice) => void;
}) {
  const options: Array<{ value: PhotoChoice; title: string; detail: string }> = [
    {
      value: "in",
      title: kids ? "We’re happy to be in photos" : "I’m happy to be in photos",
      detail: kids
        ? "You and your children may appear in photos or videos she shares."
        : "You may appear in photos or videos she shares.",
    },
    {
      value: "out",
      title: kids ? "Please leave us out" : "Please leave me out",
      detail: kids
        ? "Rehana will keep you and your children out of photos and videos."
        : "Rehana will keep you out of photos and videos.",
    },
  ];
  return (
    <fieldset
      aria-describedby={["photo-hint", error && "photo-error"].filter(Boolean).join(" ")}
      className="rounded-[var(--radius-card)] border-2 border-line bg-card p-5 sm:p-6"
    >
      <legend className="float-left w-full font-display text-[1.35rem] font-semibold text-plum">
        Photos at the class
      </legend>
      <p id="photo-hint" className="clear-both pt-2 text-subtle">
        Rehana sometimes takes photos and short videos in class to share online. Choose one, so
        she knows before the day.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {options.map((option, i) => (
          <label
            key={option.value}
            className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-[var(--radius-field)] border-2 p-4 transition-colors ${
              value === option.value
                ? "border-purple bg-lilac"
                : error
                  ? "border-error-ink bg-field"
                  : "border-field-line bg-field hover:border-purple"
            }`}
          >
            <input
              type="radio"
              name="photo"
              value={option.value}
              data-field={i === 0 ? "photo" : undefined}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-1 size-5 shrink-0 accent-purple"
            />
            <span className="flex flex-col">
              <span className="font-semibold text-plum">{option.title}</span>
              <span className="text-muted">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-2">
        <FieldError id="photo-error" error={error} />
      </div>
    </fieldset>
  );
}

/** In place of the form when the date cannot take a booking. */
function DateUnavailable({
  title,
  body,
  classDates,
}: {
  title: string;
  body: string;
  classDates: string;
}) {
  return (
    <section
      aria-labelledby="unavailable-heading"
      className="rounded-[var(--radius-card)] border-2 border-line bg-card p-6 sm:p-8"
    >
      <h2 id="unavailable-heading" className="font-display text-2xl font-semibold text-plum">
        {title}
      </h2>
      <p className="mt-2 text-body">{body}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link href={classDates} className={actionButton}>
          Choose another date
        </Link>
        <Link href="/contact" className={buttonOutline}>
          Ask Rehana
        </Link>
      </div>
    </section>
  );
}
