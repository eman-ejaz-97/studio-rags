"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorMessages, isCsrfRefusal, safeNext, session } from "@/lib/session";
import { FormAlert, FormNotice, TextField } from "./form-fields";
import { buttonOutline, buttonPrimary, textLink } from "./ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;

type Errors = Record<string, string>;
type Failure = { message: string; details?: string[]; extra?: React.ReactNode };

const OFFLINE =
  "We couldn’t reach Studio Rags. Check your internet connection and try again.";
const WAKING =
  "The booking system is waking up after a quiet spell. Please try again in a minute.";
// session.ts has already fetched a fresh security token and tried again, so
// a browser refusing cookies is the likely reason left.
const COOKIES =
  "We couldn’t send this safely. Please check that cookies are allowed for this site, then try again.";

/** The words for a refusal the form could not prevent itself. */
async function describe(
  res: Response,
  own: Partial<Record<number, string>>,
): Promise<Failure> {
  if (await isCsrfRefusal(res)) return { message: COOKIES };
  if (own[res.status]) return { message: own[res.status]! };
  if (res.status >= 500) return { message: WAKING };
  return { message: "Some details need another look.", details: await errorMessages(res) };
}

/**
 * Shared by all four forms: validate first and focus the first bad field, so
 * most mistakes never leave the page; then post, and never submit twice.
 */
function useAuthForm<F extends string>(order: readonly F[]) {
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sending, setSending] = useState(false);

  function read(form: HTMLFormElement) {
    const data = new FormData(form);
    return Object.fromEntries(order.map((f) => [f, String(data.get(f) ?? "")])) as Record<
      F,
      string
    >;
  }

  function check(form: HTMLFormElement, found: Errors) {
    setErrors(found);
    const first = order.find((f) => found[f]);
    if (first) {
      form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return false;
    }
    return true;
  }

  async function send(run: () => Promise<Failure | null>) {
    if (sending) return;
    setSending(true);
    setFailure(null);
    try {
      setFailure(await run());
    } catch {
      setFailure({ message: OFFLINE });
    } finally {
      setSending(false);
    }
  }

  function clearOnEdit(event: React.FormEvent<HTMLFormElement>) {
    const { name } = event.target as EventTarget & { name?: string };
    if (name && errors[name]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
  }

  return { errors, failure, sending, read, check, send, clearOnEdit };
}

function passwordError(password: string) {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters`;
  return undefined;
}

function Submit({ sending, idle, busy }: { sending: boolean; idle: string; busy: string }) {
  return (
    <button
      type="submit"
      className={`${buttonPrimary} w-full`}
      disabled={sending}
      aria-disabled={sending}
    >
      {sending ? busy : idle}
    </button>
  );
}

function Alt({ children }: { children: React.ReactNode }) {
  return <p className="text-center">{children}</p>;
}

// ── Sign in ─────────────────────────────────────────────────────────────────

const SIGN_IN = ["email", "password"] as const;

export function SignInForm({
  next,
  passwordChanged = false,
}: {
  next?: string;
  passwordChanged?: boolean;
}) {
  const router = useRouter();
  const f = useAuthForm(SIGN_IN);
  const destination = safeNext(next);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const v = f.read(form);
    const found: Errors = {};
    if (!EMAIL.test(v.email.trim())) found.email = "Enter your email address, like name@example.com";
    if (!v.password) found.password = "Enter your password";
    if (!f.check(form, found)) return;

    await f.send(async () => {
      const res = await session.post("/auth/login", { email: v.email, password: v.password });
      if (res.ok) {
        router.replace(destination);
        router.refresh();
        return null;
      }
      return describe(res, {
        401: "Email or password is incorrect. Please try again.",
        429: "Too many attempts to sign in. Please wait a minute and try again.",
      });
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} onChange={f.clearOnEdit} className="flex flex-col gap-6">
      {passwordChanged && !f.failure && (
        <FormNotice>
          <p className="font-semibold">Your password has been changed. Please sign in.</p>
        </FormNotice>
      )}
      {f.failure && <FormAlert message={f.failure.message} details={f.failure.details} />}
      <TextField
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        error={f.errors.email}
      />
      <TextField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        error={f.errors.password}
      />
      <Submit sending={f.sending} idle="Sign in" busy="Signing in…" />
      <Alt>
        <Link href="/forgot-password" className={textLink}>
          Forgot your password?
        </Link>
      </Alt>
      <Alt>
        New here?{" "}
        <Link href={`/register?next=${encodeURIComponent(destination)}`} className={textLink}>
          Create an account
        </Link>
      </Alt>
    </form>
  );
}

// ── Create an account ───────────────────────────────────────────────────────

const REGISTER = ["firstName", "lastName", "email", "password"] as const;

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const f = useAuthForm(REGISTER);
  const destination = safeNext(next);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const v = f.read(form);
    const consent = new FormData(form).get("marketingConsent") === "on";
    const found: Errors = {};
    if (!v.firstName.trim()) found.firstName = "Enter your first name";
    else if (v.firstName.trim().length > 80) found.firstName = "Use at most 80 characters";
    if (!v.lastName.trim()) found.lastName = "Enter your last name";
    else if (v.lastName.trim().length > 80) found.lastName = "Use at most 80 characters";
    if (!EMAIL.test(v.email.trim())) found.email = "Enter your email address, like name@example.com";
    const weak = passwordError(v.password);
    if (weak) found.password = weak;
    if (!f.check(form, found)) return;

    await f.send(async () => {
      const res = await session.post("/auth/register", {
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        password: v.password,
        marketingConsent: consent,
      });
      if (res.ok) {
        router.replace(destination);
        router.refresh();
        return null;
      }
      if (res.status === 409) {
        return {
          message: "There is already an account with that email address.",
          extra: (
            <p className="mt-2 font-normal">
              <Link href={`/sign-in?next=${encodeURIComponent(destination)}`} className={textLink}>
                Sign in
              </Link>{" "}
              or{" "}
              <Link href="/forgot-password" className={textLink}>
                set a new password
              </Link>
              .
            </p>
          ),
        };
      }
      return describe(res, {
        429: "Too many accounts created from here in a short time. Please wait a minute and try again.",
      });
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} onChange={f.clearOnEdit} className="flex flex-col gap-6">
      {f.failure && (
        <FormAlert message={f.failure.message} details={f.failure.details}>
          {f.failure.extra}
        </FormAlert>
      )}
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          name="firstName"
          label="First name"
          autoComplete="given-name"
          error={f.errors.firstName}
        />
        <TextField
          name="lastName"
          label="Last name"
          autoComplete="family-name"
          error={f.errors.lastName}
        />
      </div>
      <TextField
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        error={f.errors.email}
      />
      <TextField
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters. A short phrase works well."
        error={f.errors.password}
      />
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          name="marketingConsent"
          className="mt-1 h-5 w-5 flex-none accent-purple"
        />
        <span>Email me when Studio Rags adds new classes or dates.</span>
      </label>
      <Submit sending={f.sending} idle="Create account" busy="Creating your account…" />
      <Alt>
        Already have one?{" "}
        <Link href={`/sign-in?next=${encodeURIComponent(destination)}`} className={textLink}>
          Sign in
        </Link>
      </Alt>
    </form>
  );
}

// ── Forgot password ─────────────────────────────────────────────────────────

const FORGOT = ["email"] as const;

export function ForgotPasswordForm() {
  const f = useAuthForm(FORGOT);
  const [sent, setSent] = useState<string | null>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);

  // The form disappears on success, so focus would otherwise fall to <body>.
  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const v = f.read(form);
    if (!f.check(form, EMAIL.test(v.email.trim()) ? {} : { email: "Enter your email address, like name@example.com" })) {
      return;
    }
    await f.send(async () => {
      const res = await session.post("/auth/forgot-password", { email: v.email });
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        setSent(json?.message ?? "If that email address has an account, a reset link is on its way.");
        return null;
      }
      return describe(res, {
        429: "You’ve asked for several links in a short time. Please wait five minutes and try again.",
      });
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <h2 ref={sentRef} tabIndex={-1} className="font-display text-2xl font-semibold text-plum">
          Check your email
        </h2>
        <FormNotice>
          <p className="font-semibold">{sent}</p>
        </FormNotice>
        <p className="text-subtle">
          The link works once and expires after an hour. If it does not arrive in a few minutes,
          check your junk folder.
        </p>
        <Link href="/sign-in" className={`${buttonOutline} w-full`}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} onChange={f.clearOnEdit} className="flex flex-col gap-6">
      {f.failure && <FormAlert message={f.failure.message} details={f.failure.details} />}
      <TextField
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        error={f.errors.email}
      />
      <Submit sending={f.sending} idle="Send me a link" busy="Sending…" />
      <Alt>
        <Link href="/sign-in" className={textLink}>
          Back to sign in
        </Link>
      </Alt>
    </form>
  );
}

// ── Choose a new password ───────────────────────────────────────────────────

const RESET = ["password", "confirm"] as const;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const f = useAuthForm(RESET);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const v = f.read(form);
    const found: Errors = {};
    const weak = passwordError(v.password);
    if (weak) found.password = weak;
    else if (v.confirm !== v.password) found.confirm = "These don’t match. Type the same password in both boxes";
    if (!f.check(form, found)) return;

    await f.send(async () => {
      const res = await session.post("/auth/reset-password", { token, password: v.password });
      if (res.ok) {
        router.replace("/sign-in?reset=1");
        return null;
      }
      if (res.status === 401) {
        return {
          message: "That reset link has expired or has already been used.",
          extra: (
            <p className="mt-2 font-normal">
              <Link href="/forgot-password" className={textLink}>
                Ask for a new link
              </Link>
            </p>
          ),
        };
      }
      return describe(res, {
        429: "Too many attempts in a short time. Please wait five minutes and try again.",
      });
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} onChange={f.clearOnEdit} className="flex flex-col gap-6">
      {f.failure && (
        <FormAlert message={f.failure.message} details={f.failure.details}>
          {f.failure.extra}
        </FormAlert>
      )}
      <TextField
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
        error={f.errors.password}
      />
      <TextField
        name="confirm"
        label="Type it again"
        type="password"
        autoComplete="new-password"
        error={f.errors.confirm}
      />
      <p className="text-subtle">Changing your password signs you out everywhere else.</p>
      <Submit sending={f.sending} idle="Save new password" busy="Saving…" />
    </form>
  );
}
