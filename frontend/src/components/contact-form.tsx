"use client";

import { useEffect, useRef, useState } from "react";
import { FieldError, FormAlert, TextField, fieldClass } from "./form-fields";
import { buttonPrimary } from "./ui";

type Kind = "GENERAL" | "PRIVATE_EVENT";
type Field =
  | "name"
  | "email"
  | "phone"
  | "message"
  | "preferredDate"
  | "guestCount";
type Errors = Partial<Record<Field, string>>;

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; message: string }
  | { state: "failed"; message: string; details?: string[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The same rules the API applies, so most mistakes never leave the page. */
function validate(values: Record<Field, string>, kind: Kind): Errors {
  const errors: Errors = {};
  if (!values.name.trim()) errors.name = "Enter your name";
  if (!EMAIL.test(values.email.trim()))
    errors.email = "Enter a valid email address, like name@example.com";
  if (values.phone.trim().length > 40)
    errors.phone = "Phone number is too long";
  if (values.message.trim().length < 10)
    errors.message = "Tell us a little more: at least 10 characters";
  if (kind === "PRIVATE_EVENT" && values.guestCount) {
    const n = Number(values.guestCount);
    if (!Number.isInteger(n) || n < 1 || n > 200)
      errors.guestCount = "Enter a number of guests between 1 and 200";
  }
  return errors;
}

const ORDER: Field[] = [
  "name",
  "email",
  "phone",
  "preferredDate",
  "guestCount",
  "message",
];

/**
 * Posts from the browser to /api/v1/contact on this site's own address, rather
 * than through a server action: the API's limit of five messages per ten
 * minutes is counted per visitor, and a server action would make every
 * visitor arrive from the same Vercel server.
 */
export function ContactForm({
  initialMessage = "",
}: {
  initialMessage?: string;
}) {
  const [kind, setKind] = useState<Kind>("GENERAL");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const sentRef = useRef<HTMLHeadingElement>(null);

  // The submit button disappears with the form, so focus would fall to <body>.
  useEffect(() => {
    if (status.state === "sent") sentRef.current?.focus();
  }, [status.state]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "");
    const values = Object.fromEntries(ORDER.map((f) => [f, value(f)])) as Record<
      Field,
      string
    >;

    const found = validate(values, kind);
    setErrors(found);
    const first = ORDER.find((f) => found[f]);
    if (first) {
      form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      setStatus({ state: "idle" });
      return;
    }

    setStatus({ state: "sending" });
    const body: Record<string, unknown> = {
      kind,
      name: values.name,
      email: values.email,
      message: values.message,
    };
    if (value("website")) body.website = value("website");
    if (values.phone.trim()) body.phone = values.phone;
    if (kind === "PRIVATE_EVENT") {
      if (values.preferredDate) body.preferredDate = values.preferredDate;
      if (values.guestCount) body.guestCount = Number(values.guestCount);
    }

    try {
      const res = await fetch("/api/v1/contact", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as {
        message?: string | string[];
      } | null;

      if (res.ok) {
        setStatus({
          state: "sent",
          message: typeof json?.message === "string" ? json.message : "Thank you.",
        });
        form.reset();
        return;
      }
      if (res.status === 429) {
        setStatus({
          state: "failed",
          message:
            "You’ve sent several messages in a short time. Please wait ten minutes and try again.",
        });
        return;
      }
      setStatus({
        state: "failed",
        message: "Some details need another look.",
        details: Array.isArray(json?.message) ? json.message : undefined,
      });
    } catch {
      setStatus({
        state: "failed",
        message:
          "We couldn’t send your message. Check your internet connection and try again.",
      });
    }
  }

  if (status.state === "sent") {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-field)] border-2 border-ok-line bg-ok-bg p-6 text-ok-ink"
      >
        <h2
          ref={sentRef}
          tabIndex={-1}
          className="font-display text-2xl font-semibold"
        >
          Message sent
        </h2>
        <p className="mt-2">{status.message}</p>
        <button
          type="button"
          className={`${buttonPrimary} mt-5`}
          onClick={() => setStatus({ state: "idle" })}
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      onChange={(event) => {
        // Once someone edits a field, its old error stops being true.
        const { name } = event.target as EventTarget & { name?: string };
        if (name && errors[name as Field]) {
          setErrors((current) => {
            const next = { ...current };
            delete next[name as Field];
            return next;
          });
        }
      }}
      className="flex flex-col gap-6"
    >
      {status.state === "failed" && (
        <FormAlert message={status.message} details={status.details} />
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold text-plum">
          What is your message about?
        </legend>
        {(
          [
            ["GENERAL", "A question about classes or bookings"],
            ["PRIVATE_EVENT", "A private event or group booking"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-center gap-3"
          >
            <input
              type="radio"
              name="kind"
              value={value}
              checked={kind === value}
              onChange={() => setKind(value)}
              className="h-5 w-5 accent-purple"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <TextField name="name" label="Your name" autoComplete="name" error={errors.name} />
      <TextField
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        hint="Rehana replies by email."
        error={errors.email}
      />
      <TextField
        name="phone"
        label="Phone (optional)"
        type="tel"
        autoComplete="tel"
        error={errors.phone}
      />

      {kind === "PRIVATE_EVENT" && (
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            name="preferredDate"
            label="Preferred date (optional)"
            type="date"
            error={errors.preferredDate}
          />
          <TextField
            name="guestCount"
            label="Number of guests (optional)"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            error={errors.guestCount}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="message" className="font-semibold text-plum">
          Your message
        </label>
        <textarea
          id="message"
          name="message"
          rows={6}
          defaultValue={initialMessage}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "message-error" : undefined}
          className={fieldClass(Boolean(errors.message))}
        />
        <FieldError id="message-error" error={errors.message} />
      </div>

      {/* Honeypot: hidden from people and screen readers, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <button
          type="submit"
          className={buttonPrimary}
          disabled={status.state === "sending"}
          aria-disabled={status.state === "sending"}
        >
          {status.state === "sending" ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}
