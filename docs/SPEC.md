# Studio Rags — Living Specification

**Status:** v0.7 · Last updated 2026-09-12
**Source of truth.** If this file and any other document disagree, this file wins
(except the client-signed SRS on scope — see § 2).

> **Read this first if you are an AI assistant joining a fresh session.**
> This file is written to bring you fully up to speed with no prior context.
> Read it top to bottom before touching code. When you finish a work session,
> update § 11 (Status) and § 12 (Decision log) before the conversation ends.

---

## 1. Project at a glance

| | |
| --- | --- |
| **Product** | Workshop booking and payment platform for Studio Rags |
| **Client** | Rehana Usman, Founder — Studio Rags, Sefton Park, SA, Australia |
| **Developer** | Eman Ejaz (sole developer; team of 5 on documentation/analysis) |
| **Timeline** | Two trimesters, concluding **February 2027** |
| **Nature** | **Production platform**, not an academic prototype. On the client's approval it goes live as the real business system. Treat every decision accordingly — real payments, real customer data, real deliverability. |
| **Repo** | Monorepo: `backend/` (NestJS), `frontend/` (Next.js), `docs/` |

### The problem

Studio Rags advertises on Facebook/Instagram → a basic Wix site → **off-site to
Eventbrite** to book and pay. Consequences: customers abandon mid-journey, Meta
cannot attribute conversions, and the business owns no customer email list.

### The goal

Keep the entire journey on Studio Rags' own domain: browse → workshop detail →
pick a session → pay in full → confirmed, with automated email and a dashboard
Rehana can run without a developer.

### The client

~20 years in textiles, bachelor's in Textile Design, former fashion designer and
university lecturer, moved from Pakistan to Australia. **The only artist teaching
Indonesian Batik in the Adelaide area.** Limited technical background — the admin
side must be genuinely simple, not merely functional. Communication is by email,
her stated preference, for record-keeping.

### The catalog — 8 classes, three product types

**Superseded 2026-09-12 (second email).** The client sent her live Eventbrite
listings with real prices. This is her actual trading catalogue and it is the
authority — it replaces every earlier list, including the "9 offers" of
2026-08-04 and the "6 offers" derived after the Master Class withdrawal.

| # | Class (her wording) | Type | Price | Source |
| --- | --- | --- | --- | --- |
| 1 | Batik workshop | One-off, in-person | $82 | Eventbrite 388035002137 |
| 2 | Shibori workshop | One-off, in-person | $82 | Eventbrite 344599956747 |
| 3 | Pakistani Woodblock Printing | One-off, in-person | $65 | Eventbrite 1993227812042 |
| 4 | **Paint with Mate** mixed media class | One-off, in-person | $65 | Eventbrite 1992272302086 |
| 5 | Batik Online class | Online (Zoom) | $102 | Eventbrite 1547211293629 |
| 6 | Shibori online class | Online (Zoom) | $102 | Eventbrite 669256643637 |
| 7 | Kids and parents paint together | In-person, ages 7–15, adult accompanies | $42 | Eventbrite 409857463707 |
| 8 | **Kids' Tie Dye class** | In-person, kids | $38 | Eventbrite 623394107557 |

**Two rows contradict what she told us earlier** (§ 10 items 1 and 2):

- **Paint with Mate** has never appeared in any requirements document. It is new.
- **Kids' Tie Dye** was explicitly removed on 2026-08-04 — *"Tie-dye for kids and
  Chunri workshop for adults is not needed"* — yet it is here with a price and a
  live listing. Either she changed her mind or it is a stale Eventbrite link.

Naming also drifted: the SRS says "Woodblock Printing", her listing says
"**Pakistani** Woodblock Printing". Use her wording.

Still confirmed out: regular adult tie-dye, Chunri dyeing, the three four-week
Master Classes (withdrawn 2026-09-12), and council/school/library bookings.

Prices above are her current Eventbrite prices. They are **seed data, not
constants** — she edits them in the admin (ADR-012).

**Build scope, decided 2026-09-12 (ADR-020): rows 1, 2, 3, 5, 6 and 7 — six
classes.** Paint with Mate and Kids' Tie Dye are excluded from the initial build,
not from the product. Both are ordinary classes in shapes we already support, so
she adds them herself from the dashboard after launch with no development work.
Six is the design and test set, not a ceiling.

**The Master Class withdrawal (2026-09-12)** removed the prepaid-entitlement
model entirely: no `Enrolment`, no credits, no 6-month expiry, no `COURSE`
product type. Every remaining offer is a straightforward "pick a date, pay,
attend" booking. See ADR-013.

The two online offers are separate `Workshop` rows from their in-person
namesakes, not variants: different price, different page, different delivery.

### Seasonality

**Corrected 2026-08-04.** The SRS named the Adelaide Fringe as the peak. The
client has since clarified that Fringe bookings are taken through the Fringe's
*own* website, not hers. Her active season is **spring and summer** —
roughly September through February in South Australia.

That still puts peak load across our final months and immediately at go-live, so
overbooking safety and load behaviour remain first-order concerns (NFR-5); only
the reason has changed.

---

## 2. Scope

Scope is governed by the client-signed SRS at
[`docs/client/04_SRS_StudioRags.docx`](client/). This section restates it for
traceability; the SRS wins on *what* is in scope, this spec owns *how*.

### Decision: deliver the full MoSCoW set

The SRS ranks requirements Must/Should/Could. **We are targeting all of them**,
including gift cards, which the client re-confirmed on 2026-09-12. If schedule
pressure appears, the deferral order is: reviews (FR-C11) → gift cards
(FR-C12/FR-P4). Nothing marked Must is negotiable.

Online classes are no longer a deferral candidate. They turned out to be trivial
— a Zoom link field on the session (ADR-015) — so there is nothing to defer.

The Master Class was withdrawn by the client on 2026-09-12 (ADR-013). That is a
scope *reduction*, not a deferral: roughly a phase of work removed.

### Requirement traceability

| ID | Requirement | Phase |
| --- | --- | --- |
| FR-C1 | List available workshops | 2 |
| FR-C2 | Workshop detail page | 2 |
| FR-C3 | Calendar of available sessions | 2 |
| FR-C4 | Register and log in | 1 |
| FR-C5 | Password reset | 1 |
| FR-C6 | Book a session | 3 |
| FR-C7 | Pay in full before confirmation, no deposits | 3 |
| FR-C8 | Automated booking confirmation email | 3 |
| FR-C9 | Automated reminder email(s) before workshop | 4 |
| FR-C10 | Profile and booking history | 4 |
| FR-C11 | Leave/view reviews | 7 |
| FR-C12 | Purchase gift cards | 6 |
| FR-C13 | Contact page | 2 |
| FR-C14 | Mobile-first responsive | all |
| FR-C15 | Online sessions — Batik and Shibori, live over Zoom | 2 |
| FR-X1 | Cancellation and refund handling — admin-configurable window and rate | 3 |
| FR-X2 | Accompanying-adult rule for the kids class | 3 |
| FR-A1 | Secure admin login, role-based | 1 |
| FR-A2 | Dashboard: upcoming classes and bookings | 5 |
| FR-A3 | CRUD workshops | 5 |
| FR-A4 | Manage session calendar (dates & seats) | 5 |
| FR-A5 | Prevent double booking / overbooking | 3 |
| FR-A6 | Manage customers | 5 |
| FR-A7 | Booking history and status | 5 |
| FR-A8 | Payment info per booking | 5 |
| FR-A9 | Admin notification emails | 4 |
| FR-A10 | Dashboard as a simpler ClassBento | 5 |
| FR-P1 | Secure payment gateway | 3 |
| FR-P2 | Full payment before confirmation | 3 |
| FR-P3 | No deposits | 3 |
| FR-P4 | Gift card purchase and redemption | 6 |
| FR-N1–N4 | Transactional email set | 3–4 |
| FR-M1 | Tracking-ready pages | 7 |
| FR-M2 | Consented email collection | 7 |
| FR-M3 | Privacy/cookie notice | 7 |

### Explicitly out of scope

Council/school/library bookings (stay phone and email — the client is happy with
this) · native mobile apps · running Facebook or Google ad campaigns (the site is
built tracking-*ready*; the campaigns are the client's business).

### Private events — recommended out of scope (ADR-019)

Her policy document revealed a part of the business no requirements document
mentions: **private events** (corporate, hens parties, birthdays). Minimum 10
paid guests, a **$200 deposit** four weeks ahead, and the balance due 7 days
before.

This **directly contradicts FR-P3, a Must requirement**: "No deposits or part
payments." Her real business takes deposits; the specified system refuses them.

Two ways out:

1. **Private events stay offline.** The website carries an enquiry form and the
   published terms; she quotes, invoices and takes the deposit herself, exactly
   as she already does for councils and schools. FR-P3 survives untouched.
2. **Build a deposit-and-balance flow.** A second payment model, partial
   payments, balance-due reminders, forfeiture rules, and a per-event quote
   because of the travel surcharge.

**Decided 2026-09-12: option 1.** Option 2 is a substantial subsystem serving the
one part of her business she already handles comfortably offline, and it would
land in a schedule that has five months left. Option 1 also keeps the site's
payment story consistent: one price, paid in full, booking confirmed.

The website carries a private-events page, the published terms (10-guest minimum,
travel surcharge) and an enquiry form that emails her. Nothing more.

The same reasoning covers the **travel surcharge** ($50 for 12–20 km, $75 for
20–35 km). It only applies to mobile/private bookings. If private events stay
offline, distance-based pricing never reaches the website.

Needs her agreement — § 10 item 3.

---

## 3. Architecture

```
                    ┌──────────────────────────────┐
   Browser ────────▶│  Next.js 16 (App Router)     │
                    │  public site + admin SPA     │
                    └──────────┬───────────────────┘
                               │ REST /api/v1, cookie auth
                    ┌──────────▼───────────────────┐        ┌──────────┐
                    │  NestJS 11 API               │───────▶│  Stripe  │
                    │  auth · catalog · booking    │◀───────┤ webhooks │
                    │  payments · email · admin    │        └──────────┘
                    └──────────┬───────────────────┘
                               │ Prisma                     ┌──────────┐
                    ┌──────────▼───────────────────┐        │  Resend  │
                    │  PostgreSQL 17               │        │  email   │
                    └──────────────────────────────┘        └──────────┘
```

Two deployables, one database. The frontend never talks to Postgres and never
holds a Stripe secret key.

### Chosen stack and why

**Payments — Stripe.** Chosen over Square. Reasoning:

- Payment Intents plus webhooks map exactly onto FR-P2 ("no confirmed booking
  without full payment") — the booking is only confirmed by a server-side
  webhook, never by the browser saying so.
- Stripe Elements/Checkout hosts the card fields in an iframe, so no raw card
  data ever reaches our servers. That satisfies NFR-4 and reduces PCI obligation
  to SAQ-A, the lightest tier.
- Test mode is complete — we can build and demo the entire payment flow before
  the client's ABN and business bank account exist (§ 10).
- Australian support is first class: AUD settlement, Apple/Google Pay, and BECS.
- Documentation and TypeScript SDK quality materially affect a solo developer's
  velocity, and Stripe leads here.

Square would only win if Rehana already runs a Square POS in the studio and
wanted one merged ledger. **Still to confirm with her** (§ 10) — but even then,
Stripe's fee for domestic cards (1.7% + A$0.30) versus Square online (2.2%) plus
the integration cost favours Stripe. Recorded as ADR-001.

**ORM — Prisma**, over TypeORM which you already know. Reasoning: the generated
client gives the *frontend* accurate types with no hand-maintained duplicate
interfaces, which matters because one person is writing both sides; migrations
are file-based, reviewable, and deterministic (TypeORM's `synchronize` is a known
production footgun and its migration story is rougher); and `prisma studio` gives
the client's data a browsable UI for free during development. Cost is roughly a
day of ramp-up. Raw SQL is available via `$queryRaw` for the one place we need it
(§ 5, seat locking). Recorded as ADR-002.

**Auth — JWT in httpOnly cookies, issued by Nest.** Access token 15 min, refresh
token 30 days, refresh tokens stored hashed and rotated on every use so a stolen
token is single-use. Passwords hashed with **argon2id**. No third-party auth
provider: it keeps customer PII on infrastructure the business owns (relevant to
the Australian Privacy Act posture in NFR-7), avoids per-MAU cost on a small
business, and gives the capstone report something substantive to document.
httpOnly cookies rather than `localStorage` because XSS then cannot exfiltrate
the session. CSRF handled by `SameSite=Lax` plus a double-submit token on
state-changing routes. Recorded as ADR-003.

**Email — React Email templates**, rendered by Nest. Mailpit in development
(nothing can escape to a real inbox), Resend in production. Every send is
recorded in an `email_log` row so the admin can prove a confirmation went out.

**Hosting — decided (ADR-004).** All three components in or near Sydney, because
every user is in South Australia and a US region adds ~200 ms to each round trip:

| Component | Host | Region |
| --- | --- | --- |
| Frontend | Vercel | `syd1` |
| API | Fly.io | `syd` |
| Database | Neon | `ap-southeast-2` |
| Media | Cloudflare R2 | auto |
| Email | Resend | — |

Rough running cost: A$40–70/month at this scale. Domain and any Wix migration
are the client's call (§ 10).

---

## 4. Repository layout

```
studio_rags/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   └── src/
│       ├── common/          guards, interceptors, filters, decorators
│       ├── prisma/          PrismaService
│       ├── auth/            register, login, refresh, reset, roles
│       ├── users/           profile, admin customer management
│       ├── workshops/       catalog CRUD
│       ├── sessions/        scheduled instances, availability
│       ├── bookings/        the seat-locking core
│       ├── payments/        Stripe intents + webhook handler
│       ├── gift-cards/
│       ├── reviews/
│       ├── mail/            React Email templates + transport
│       └── admin/           dashboard aggregates
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── (site)/      public marketing + booking journey
│       │   ├── (auth)/      login, register, reset
│       │   ├── account/     customer profile and bookings
│       │   └── admin/       the dashboard
│       ├── components/
│       │   ├── ui/          shadcn primitives
│       │   └── ...          feature components
│       └── lib/             api client, hooks, utils
└── docs/
    ├── SPEC.md              ← this file
    ├── adr/                 architecture decision records
    ├── client/              client-facing docs and meeting packs
    └── design/              personas, sitemap, wireframes, design system
```

---

## 5. Data model

Money is **always integer cents in AUD**. Never a float, anywhere, ever.
All timestamps are `timestamptz` stored in UTC; Adelaide (`Australia/Adelaide`,
UTC+9:30/+10:30 with DST) is a presentation concern only.

### Entities

**`User`** — `id`, `email` (unique, citext), `passwordHash`, `firstName`,
`lastName`, `phone`, `role` (`CUSTOMER` | `ADMIN`), `emailVerifiedAt`,
`marketingConsentAt` (null = no consent — FR-M2 requires explicit opt-in),
`createdAt`, `updatedAt`.

**`RefreshToken`** — `id`, `userId`, `tokenHash`, `expiresAt`, `revokedAt`,
`userAgent`, `ip`. Rotated on use.

**`PasswordResetToken`** — `id`, `userId`, `tokenHash`, `expiresAt`, `usedAt`.

**`Workshop`** — the catalog entry, not a dated event. `id`, `slug` (unique),
`title`, `summary`, `description` (rich text), `durationMinutes`,
`basePriceCents`, `defaultCapacity`, `skillLevel`, `whatsIncluded`,
`whatToBring`, `deliveryMode` (`IN_PERSON` | `ONLINE`), `status` (`DRAFT` |
`PUBLISHED` | `ARCHIVED`), `sortOrder`, timestamps, plus:

- `productType` — `ONE_OFF` | `ONLINE` | `KIDS`. Drives which booking flow the
  frontend renders and which rules the backend applies.
- `minAge` / `maxAge` — null except Kids & Parents Painting (7 / 15).
- `requiresAccompanyingAdult` — true only for the kids class. See § 5.
- `refundPolicyOverride` — nullable. Null means the studio-wide policy applies.

The two online offers are separate `Workshop` rows from their in-person
namesakes, not variants: different price, different page, different delivery.

### Cancellations, refunds and credit vouchers (ADR-014, rewritten 2026-09-12)

**The client supplied her existing written policy** (`docs/client/Policies.pdf`).
We implement hers. Our earlier proposal of 7 days / 50% / 48 hours is withdrawn —
it was a guess, and she already had a real policy in force.

Everything below is measured in **business days** before `Session.startsAt`.

| Event | More than 14 business days before | 14 business days or less |
| --- | --- | --- |
| Customer cancels | Full refund to the original payment method, **or** a credit voucher valid 6 months. Customer chooses. | **$15 per person** fee — see the open question below |
| Customer reschedules | Free | **$15 per person** fee |
| Customer no-shows | — | Nothing. No refund, no voucher, no reschedule. |
| **Studio** cancels | Full refund, or reschedule, or a gift card. Customer chooses. | Same |

**`RefundPolicy`** — one studio-wide row, optionally overridden per workshop:
`cutoffBusinessDays` (14), `lateFeeCentsPerPerson` (1500),
`voucherValidityMonths` (6), `allowVoucherInsteadOfRefund` (true). Admin-editable
(ADR-012) so she changes her own terms without a developer.

**Business days, not calendar days.** This is her published wording and customers
have booked under it, so we should not quietly convert it to calendar days. It
needs a South Australian public-holiday calendar, seeded and admin-editable. 14
business days is roughly three calendar weeks — the difference is large enough
that getting it wrong changes real refund outcomes.

**`CreditVoucher`** — a new entity, and distinct from a gift card:

`id`, `code`, `userId`, `originBookingId`, `initialValueCents`,
`balanceCents`, `issuedAt`, `expiresAt` (issued + 6 months), `status`.

It shares the redemption path with `GiftCard` — both are a balance applied at
checkout — so build one credit mechanism with two sources rather than two
parallel systems. They differ only in origin and expiry.

**Open question on late cancellations (§ 10 item 4).** Her policy is ambiguous.
The reschedule paragraph says a *"cancellation/reschedule fee of $15 per person"*
and then talks about using "your credit voucher". That reads as: a late
cancellation yields a **voucher** minus $15, not cash minus $15. It is not
stated outright. Confirm before building, because the two answers produce very
different customer outcomes.

Rules that hold regardless of the numbers:

- The refund is calculated from the amount **stored on the booking**, never from
  the workshop's current price (§ 5, price snapshotting).
- Refunds are issued through Stripe and recorded against the `Payment` row.
  `Booking` gains `refundedAmountCents`, `refundedAt` and `cancellationReason`.
- Cancelling releases the seat inside the same locking transaction that took it.
- The admin can always override and issue a full refund. The policy is the
  default, not a cage — she runs the business.
- Whatever numbers she picks must be published on the site before launch. Taking
  money under an unstated refund policy is consumer-law exposure (NFR-7).

### Gift card expiry — a legal problem to raise (ADR-017)

Her policy states gift cards bought on the website are **valid for 12 months**.

Australian Consumer Law sets a **minimum three-year** expiry on gift cards sold
to consumers. A 12-month term on a card sold through the website is very likely
non-compliant.

This is her call and her risk, not ours to decide silently. But we must raise it
in writing, and the system should default to 36 months. See § 10 item 5.

Note the distinction: a **credit voucher** issued as an alternative to a refund
is not the same instrument as a gift card sold for money, and the 6-month term on
vouchers is a separate question. Keep the two entities separate partly for this
reason.

### Policy pages and photo consent (ADR-018)

`docs/client/Policies.pdf` is not only refund rules. It carries content the site
must publish and, in one case, behaviour the site must implement.

**Must be published as pages before launch** — refunds and reschedules, no-show,
studio cancellation, gift cards, courtesy and conduct (all sessions are alcohol
free), comments and reviews, photography, private events, travel surcharge.

**Photography consent is a functional requirement, not just a page.** Her policy
is that attending implies consent to being photographed and filmed for social
media and advertising, with an opt-out by telling staff on arrival.

Implied consent buried in a policy page is weak. It should be a visible,
unticked checkbox at booking — "I understand photos and video may be taken" —
with an opt-out flag stored on the booking and shown to the admin on the
attendee list, so she knows before the class starts rather than at the door.
That is better for her and better for the customer. Costs almost nothing.

`Booking` gains `photoConsentOptOut` (boolean).

**Reviews:** her policy reserves the right to edit or remove comments and
reviews. That matches the moderation design already specced for FR-C11.

### Online sessions (ADR-015)

Confirmed 2026-09-12: online classes are **live over Zoom**, and the client
pastes the join link in herself. Nothing is posted to the customer, so there is
no shipping address and no dispatch cut-off — a useful simplification.

`Session.onlineJoinUrl` carries it. Rules:

- The admin enters the link when creating or editing an online session.
- It is returned **only** to a customer holding a `CONFIRMED` booking for that
  session, and to admins. It never appears in the public catalog API.
- It goes in the confirmation email and in every reminder email, because that is
  where people look for it.
- An online session with no link set cannot be published. The admin UI blocks it
  rather than letting a customer pay for a class they cannot join.

### The kids class and accompanying adults (ADR-016)

Confirmed 2026-09-12: every child at Kids & Parents Painting is accompanied by an
adult.

This is a **capacity** question before it is a pricing one. If the room holds 12
people and every child brings an adult, the class is 6 children, not 12.

Decision: for a workshop with `requiresAccompanyingAdult`, **capacity is counted
in children**, and the accompanying adult is implied by the booking. The client
sets "6" and means six children, twelve people. That matches how she thinks about
her own room, and it is the only reading that cannot silently overfill it.

The admin UI states this explicitly on the capacity field for that workshop, so
there is no ambiguity when she sets the number.

**`BookingAttendee`** — `id`, `bookingId`, `firstName`, `age`. Captured at
booking for the kids class so the admin knows who is coming, and so the 7–15 age
range is validated at the point of sale rather than at the door.

Still open: whether the accompanying adult pays, or the price covers the pair
(§ 10 item 2). That is a pricing question only — it does not change this model.

**`WorkshopImage`** — `id`, `workshopId`, `url`, `alt` (required, non-empty —
accessibility is not optional), `width`, `height`, `position`, `isHero`.

**`Session`** — a specific dated instance. `id`, `workshopId`, `startsAt`,
`endsAt`, `capacity`, `priceCentsOverride` (nullable), `location`,
`onlineJoinUrl`, `status` (`SCHEDULED` | `CANCELLED` | `COMPLETED`), timestamps.

### Pricing and capacity are client-owned data, not constants (ADR-012)

Price and class size are **never** hardcoded, seeded as fixed truth, or treated
as requirements to be gathered. They are fields Rehana sets herself.

Two levels, resolved at booking time:

1. `Workshop.basePriceCents` / `Workshop.defaultCapacity` — the default, set once
   when she creates the workshop, pre-filled into every new session.
2. `Session.priceCentsOverride` / `Session.capacity` — per-date, editable at
   session creation and afterwards. Override wins when present.

This covers seasonal pricing and the fact that studio capacity varies with the
workshop (§ 10 item 12 dissolves into this). It also means we do not block any
build work waiting on the client to supply numbers.

**Price is snapshotted onto the `Booking` at purchase.** `subtotalCents` /
`totalCents` are copied from the resolved price at the moment of booking and
never recomputed. Editing a session's price afterwards must not retroactively
change what a past customer paid, what the payment record says, or what her
revenue reports show. This is the single easiest way to corrupt financial history
and it is prevented by construction.

Capacity may be edited downward below the number already booked — the admin UI
warns, but does not block, since she may genuinely need to. Existing bookings are
never cancelled automatically; the session simply shows as over capacity until
she resolves it.

**`Booking`** — `id`, `reference` (human-readable, e.g. `SR-7K4M2`), `sessionId`,
`userId`, `seats`, `status` (`PENDING` | `CONFIRMED` | `CANCELLED` |
`REFUNDED` | `EXPIRED`), `subtotalCents`, `discountCents`, `totalCents`,
`attendeeNotes`, `holdExpiresAt`, `confirmedAt`, `cancelledAt`, timestamps.

**`Payment`** — `id`, `bookingId`, `stripePaymentIntentId` (unique),
`amountCents`, `currency`, `status`, `receiptUrl`, `failureReason`,
`rawEvent` (jsonb, for audit).

**`GiftCard`** — `id`, `code` (unique, high-entropy), `initialValueCents`,
`balanceCents`, `purchaserUserId`, `recipientName`, `recipientEmail`, `message`,
`status` (`ACTIVE` | `REDEEMED` | `EXPIRED` | `VOID`), `expiresAt`, `issuedAt`.

**`GiftCardRedemption`** — `id`, `giftCardId`, `bookingId`, `amountCents`. A
ledger, so partial redemptions reconcile.

**`Review`** — `id`, `workshopId`, `userId`, `bookingId` (unique — one review per
attended booking, which makes reviews verified by construction), `rating` 1–5,
`body`, `status` (`PENDING` | `APPROVED` | `REJECTED`), timestamps.

**`EmailLog`** — `id`, `to`, `template`, `bookingId`, `providerMessageId`,
`status`, `sentAt`, `error`.

**`ContactMessage`** — `id`, `name`, `email`, `phone`, `message`, `handledAt`.

### FR-A5: how overbooking is actually prevented

This is the highest-risk requirement in the system and the single thing most
likely to embarrass us during the spring/summer peak. Optimistic checks ("count seats,
then insert") lose a race under concurrency. The design:

1. **Hold, don't hope.** Creating a booking inserts a `PENDING` row with
   `holdExpiresAt = now() + 15 minutes`. That row *occupies* seats from the
   moment it exists — before any card is charged.
2. **Serialise per session.** The insert happens inside a transaction that begins
   with `SELECT id FROM sessions WHERE id = $1 FOR UPDATE`. Every concurrent
   booking attempt for the same session queues behind that row lock; attempts on
   *different* sessions never contend. Seats are counted and the row inserted
   inside the same transaction.
3. **Seats taken** = sum of `seats` over bookings for the session where
   `status = CONFIRMED` **or** (`status = PENDING` and `holdExpiresAt > now()`).
4. **Confirmation is server-side only.** The booking flips to `CONFIRMED`
   solely in the Stripe `payment_intent.succeeded` webhook handler, keyed on
   `stripePaymentIntentId` for idempotency. The browser returning from checkout
   is a *hint* to poll, never proof of payment. This is FR-P2 enforced where it
   cannot be bypassed.
5. **Sweep.** A cron every minute expires `PENDING` bookings past
   `holdExpiresAt`, releasing seats. A late-arriving webhook for an expired
   booking triggers an automatic Stripe refund and alerts the admin, rather than
   silently overbooking.
6. **Backstop.** A DB constraint trigger re-checks capacity on insert/update of
   bookings, so even a future code path that forgets the lock cannot overbook.

Load test this before go-live: 50 concurrent bookings against a 10-seat session
must yield exactly 10 confirmations.

---

## 6. API contract

REST under `/api/v1`. Cookie auth. Errors follow RFC 9457 problem+json. Every
list endpoint is cursor-paginated. Validated with `class-validator` DTOs and a
global `ValidationPipe({ whitelist: true, transform: true })`. OpenAPI generated
by `@nestjs/swagger`, served at `/api/docs` in non-production.

```
Auth
  POST   /auth/register                 create account, send verification
  POST   /auth/login                    set access + refresh cookies
  POST   /auth/refresh                  rotate refresh token
  POST   /auth/logout                   revoke refresh token
  POST   /auth/forgot-password          FR-C5
  POST   /auth/reset-password
  POST   /auth/verify-email
  GET    /auth/me

Catalog (public)
  GET    /workshops                     FR-C1  — published only
  GET    /workshops/:slug               FR-C2
  GET    /workshops/:slug/sessions      FR-C3  — future, non-full, with seatsLeft
  GET    /sessions?from=&to=            FR-C3  — calendar view across workshops
  GET    /sessions/:id/availability     live seat count

Bookings (customer)
  POST   /bookings                      FR-C6 — creates PENDING hold + intent
  GET    /bookings                      FR-C10 — own history
  GET    /bookings/:reference
  POST   /bookings/:id/cancel

Payments
  POST   /payments/intent               client secret for a held booking
  POST   /payments/webhook              Stripe → raw body, signature verified

Gift cards
  POST   /gift-cards/purchase           FR-C12
  GET    /gift-cards/:code/validate
  POST   /gift-cards/redeem             FR-P4 — applied at booking time

Reviews
  GET    /workshops/:slug/reviews       FR-C11 — approved only
  POST   /reviews                       requires an attended booking

Contact
  POST   /contact                       FR-C13 — rate limited

Admin (role: ADMIN)
  GET    /admin/dashboard               FR-A2/A10 aggregates
  CRUD   /admin/workshops               FR-A3
  CRUD   /admin/sessions                FR-A4
  GET    /admin/bookings                FR-A7/A8
  POST   /admin/bookings/:id/refund
  GET    /admin/customers               FR-A6
  GET    /admin/customers/:id
  PATCH  /admin/reviews/:id             moderate
  GET    /admin/export/customers.csv    email list for FR-M2
```

---

## 7. Frontend

Next.js 16 App Router. **This project's Next.js is newer than most training
data** — `frontend/AGENTS.md` requires reading `node_modules/next/dist/docs/`
before writing frontend code. Do that; do not write Next.js from memory.

### Rendering strategy

| Surface | Strategy | Why |
| --- | --- | --- |
| Home, workshop list, workshop detail | Server Components, statically generated, revalidated on admin edit | NFR-3 sub-3s on mobile; these are also the SEO and ad-landing pages |
| Session calendar / availability | Server shell + client island fetching live seat counts | Seat counts must never be stale |
| Checkout | Client | Stripe Elements |
| Account, admin | Client, auth-gated | Personalised, no caching value |

### UI stack

- **shadcn/ui** — Radix primitives, copied into the repo rather than installed.
  Accessible by construction (focus management, ARIA, keyboard) and fully
  restyleable, which matters because this must look like Studio Rags' brand and
  not like a component library.
- **Motion** (`motion/react`) for animation, respecting
  `prefers-reduced-motion` everywhere.
- **Lucide** icons · **Embla** carousel · **react-day-picker** for the calendar ·
  **TanStack Query** for client-side server state · **react-hook-form** + **zod**
  for forms, with the zod schemas shared between form and API DTO shape.
- **next/font** self-hosting the brand typefaces once the kit arrives.

### Design direction

The audience is **all age groups** — the SRS names women 50+ as primary and 30+
as secondary, but the platform is designed for everyone Rehana teaches, including
parents booking Kids & Parents Painting. So: no "senior-friendly" aesthetic
compromise. The approach is a design that is simply *well made* — generous type,
clear hierarchy, real contrast, unambiguous buttons — which serves a 55-year-old
first-time online booker and a 32-year-old on a phone equally.

Craft-first visual language: the product is a tactile, dyed, hand-made thing. The
site should feel like the studio — warm neutrals, indigo drawn from Shibori and
Batik, full-bleed photography of actual work and actual hands, editorial type,
restrained motion. Nothing that looks like a SaaS dashboard on the public side.

Concrete rules, to be enforced in review:

- Base body text **17–18px**, line-height ≥ 1.6, never below 16px anywhere.
- Tap targets ≥ **44×44px**; primary actions ≥ 48px tall.
- Contrast **WCAG 2.2 AA minimum** (4.5:1 body, 3:1 large text and UI edges).
- Every interactive element has a visible focus ring. Full keyboard operation.
- Motion is decoration only — nothing important is conveyed by animation alone,
  and everything is disabled under `prefers-reduced-motion`.
- Forms: labels always visible (never placeholder-as-label), errors in text next
  to the field, never colour alone.
- Mobile-first: design at 375px, then scale up. The booking flow must complete
  one-handed.
- Every image needs meaningful `alt`. This is enforced at the DB level (§ 5).

The design system — tokens, type scale, spacing, component inventory — will live
at `docs/design/design-system.md` once the brand kit arrives.

### Admin dashboard

FR-A10 asks for "a simpler ClassBento". Design intent: Rehana opens it and
immediately sees *today and this week* — upcoming classes, who is coming, who has
paid. Everything else is one click away. Calendar-first, not table-first. Plain
language, no jargon, destructive actions confirmed, and no state she can reach
that she cannot reverse.

---

## 8. Non-functional commitments

| ID | Commitment | How it is met and verified |
| --- | --- | --- |
| NFR-1 | Usable by non-technical customers and admin | § 7 rules; usability test with 5 real users incl. the client before go-live |
| NFR-2 | Mobile-first, cross-browser | Test matrix: iOS Safari, Chrome Android, desktop Chrome/Safari/Edge |
| NFR-3 | Core pages < ~3s on mobile | Static generation, `next/image`, Sydney hosting; Lighthouse mobile ≥ 90 in CI |
| NFR-4 | Secure auth and payments | argon2id, httpOnly rotating JWTs, Stripe-hosted card fields (SAQ-A), helmet, rate limiting, no raw PAN ever |
| NFR-5 | No double bookings; survives spring/summer peak | § 5 locking design; load test 50 concurrent → exactly capacity |
| NFR-6 | Client self-manages | Admin covers 100% of routine ops; written handover guide + recorded walkthrough |
| NFR-7 | Privacy compliant | Explicit marketing consent, privacy + cookie notice, data export/deletion path, AU Privacy Act posture |
| NFR-8 | On-brand | Brand kit tokens; client sign-off at design review |

---

## 9. Roadmap

Two trimesters, finishing February 2027. Each phase ends with a demo-able
increment and a client-facing document, since there is a client meeting cadence
to feed.

**Trimester 1 — foundations and the booking spine**

| # | Phase | Delivers |
| --- | --- | --- |
| 0 | Baseline | Repo re-baselined, spec written, tooling, CI, ADRs ← *we are here* |
| 1 | Auth & data | Prisma schema, migrations, seed, register/login/reset, roles |
| 2 | Catalog | Workshops, sessions, public site: home, list, detail, calendar, contact |
| 3 | Booking & payment | Seat holds, Stripe intents, webhook confirmation, confirmation email |
| 4 | Customer account | Booking history, profile, reminder emails, admin notifications |

**Trimester 2 — admin, extras, production**

| # | Phase | Delivers |
| --- | --- | --- |
| 5 | Admin dashboard | Full FR-A set — the client's daily tool |
| 6 | Gift cards | Purchase, delivery, redemption at checkout |
| 7 | Reviews, marketing, compliance | Reviews + moderation, pixel readiness, consent, privacy pages |
| 8 | Hardening | Load test, security review, accessibility audit, Lighthouse, usability test |
| 9 | Launch | Production deploy, domain cutover, client training, handover docs |

Design work (personas, sitemap, wireframes, design system) runs alongside phases
1–2 and needs client sign-off before phase 2 UI is built.

---

## 10. Open items

Items 1–6 are the SRS's own open list; the rest are ours.

### Closed 2026-08-04 by the client's email

| Was | Outcome |
| --- | --- |
| Online classes in scope? | **Yes** — Batik and Shibori only. FR-C15 is in scope. Delivery method still unanswered (reopened as item 3 below). |
| Final workshop list / Chunri? | **Closed** — was 9 offers; now **6** after the Master Class withdrawal of 2026-09-12. § 1. Chunri and all tie-dye removed. |
| ABN and business bank account? | **Yes** — registered small business with ABN. Live Stripe payments are viable; `.com.au` is available to her. |
| Council/school/library bookings? | **Confirmed out of scope.** |
| Ongoing cost acceptable? | **Yes in principle** — no figure given, but she accepts recurring cost as a business expense. Treated as settled. |
| Square POS in the studio? | Not raised by her; no evidence of Square. ADR-001 (Stripe) stands. |
| Fringe as peak season? | **Corrected** — Fringe books through its own site. Peak is spring/summer. See § 1. |

### Open

Reordered 2026-09-12 after the client's second email. Items 1–3 are the ones that
change what gets built.

| # | Question | Blocks | Owner |
| --- | --- | --- | --- |
| ~~1~~ | ~~"Paint with Mate", $65~~ — **closed 2026-09-12 (ADR-020).** Not in the initial build. She adds it herself post-launch; it is an ordinary one-off in-person class and needs no new code. | — | Closed |
| ~~2~~ | ~~Kids' Tie Dye, $38~~ — **closed 2026-09-12 (ADR-020).** Same as above. Flagged to her in the reply, since she had previously said it was not needed. | — | Closed |
| ~~3~~ | ~~Private events and travel surcharge~~ — **closed 2026-09-12 by the developer.** Offline, enquiry form only. ADR-019 confirmed; FR-P3 stands unchanged. | — | Closed |
| 4 | **Late cancellation — cash or voucher?** Inside 14 business days, is it a refund minus $15 per person, or a credit voucher minus $15? Her policy implies voucher but does not say it. | Refund logic, phase 3 | Client |
| 5 | **Gift card expiry.** Hers says 12 months. Australian Consumer Law requires a minimum of 3 years on gift cards sold to consumers. Must be raised in writing. | Phase 6; legal exposure | Us to raise → Client decides |
| 6 | **Kids class price, $42** — is that per child, or does it cover the child and the accompanying adult together? Capacity is settled (ADR-016); this is pricing. | Pricing display, phase 2 | Client |
| 7 | **Master Class — withdrawn or postponed?** If she still teaches it, we keep `productType` open so it can return without a migration. | Schema tidiness only | Client |
| 8 | Public-holiday calendar for South Australia, to compute "14 business days". | Refund logic, phase 3 | Us — seed it, she can edit |
| 9 | Domain purchase — `studiorags.com.au` recommended, supervisor endorsement pending. | Phase 9 | Us → supervisor → Client |
| 10 | Supervisor contact details to pass to the client | Client relationship | Team |
| 11 | Plain-language explainer for **MoSCoW** and **Meta ads / pixel tracking** | Next meeting | Us |
| 12 | **Has she approved SRS v1.0?** Issued 2026-08-04. No recorded response, and the scope has moved twice since. | Baseline for change control | Team to chase |

### Closed by the second email of 2026-09-12

| Was | Outcome |
| --- | --- |
| Brand kit **fonts** | **Closed.** She cannot export them from Canva and has given us permission to substitute: *"we can use the similar fonts"*. We choose close open-licensed equivalents for her approval. No longer blocks design. |
| Prices for the catalogue | **Closed.** Real prices supplied, $38–$102. Seeded as starting data; she edits them in the admin. |
| Cancellation and refund policy | **Closed.** Her written policy supplied and implemented as specified — § 5. Only the late-cancellation ambiguity remains (item 4). |
| Workshop photography rights | **Closed.** *"all the images that I share are permitted to be on the website as I only picture those who allow"*. Images to follow in a separate email. |

Nothing on the open list blocks Phase 1. Item 3 is the one that changes the shape
of the build, and it affects Phase 3, not Phase 1.

**Note on the Canva fonts (item 7).** Fonts bought or bundled inside Canva are
licensed for use *within Canva*. That licence generally does not extend to
self-hosting the file on a public website, so downloading the file is both
technically awkward and possibly not the right move. The practical path: get the
font *names* from her Canva brand kit, then source them legitimately — a large
share of Canva's library is Google Fonts or otherwise open-licensed, in which
case we self-host the real thing for free. If a name turns out to be commercially
licensed, we either buy a web licence or substitute a close open equivalent for
her approval. Resolve before the design system is built.

---

## 11. Current status

**Phase 0 — Baseline, complete. Phase 1 not started.** Last updated 2026-09-12.

### Done

- SRS analysed; scaffold mismatch found and removed (the initial commit built a
  retrieval-augmented-generation app — a misreading of "Studio Rags" as "Studio
  RAGs"). Repo re-baselined: `README.md`, `.env.example`, `docker-compose.yml`
  (Postgres 17 + Mailpit), `.gitignore`.
- This spec written, with 16 architecture decisions recorded.
- Consolidated open-items email sent; client replied 2026-08-04. Seven items
  closed, catalog restructured, seasonality corrected, ABN confirmed.
- **SRS v1.0** written and rendered to Word
  (`docs/client/SRS_StudioRags_v1.0.md` / `.docx`). Issued for sign-off
  2026-08-04. No response recorded.
- **Requirements and Deliverables Mapping v2.0** — 8 user stories expanded to 26,
  each carrying an SRS requirement code.
- **NCLAT1 Agile status sheet** generated as a PDF.
- Reusable generators in `tools/`: `md2docx.py`,
  `generate_requirements_mapping.py`, `generate_nclat1.py`.
- **Client answers of 2026-09-12 applied:** Master Class withdrawn (ADR-013),
  refund shape given (ADR-014), online = Zoom links (ADR-015), kids class
  requires an accompanying adult (ADR-016), gift cards re-confirmed in scope.

### Phase 1 — complete (2026-09-12)

**Database.** Full Prisma schema and initial migration applied
(`20260912131458_init`). 17 models covering identity, catalogue, booking,
payments, credits, policy and enquiries. Every entity in § 5 exists, including
the ones later phases need — the schema is the expensive thing to change, so it
was written whole rather than incrementally.

**Seed.** Idempotent, `npm run db:seed`. Loads the six agreed classes at her real
prices ($42–$102), the refund policy from ADR-014, an admin account, and a South
Australian public-holiday calendar.

**Auth module.** Register, login, refresh, logout, forgot-password,
reset-password, and `/auth/me`. Argon2id passwords. JWT access (15m) and refresh
(30d) in httpOnly cookies, refresh scoped to `/api/v1/auth`. Refresh tokens are
stored hashed and rotated on every use.

**Verified by test, not by inspection** — 15 auth-flow checks and a 4-step
password-reset round trip, all passing:

- Routes are protected by default; `@Public()` is opt-out, so a forgotten
  decorator leaves a route locked rather than open.
- `forbidNonWhitelisted` rejects a registration that tries to set its own
  `role: ADMIN`.
- Login failures are indistinguishable between a wrong password and an unknown
  address, and a dummy hash is verified on the miss so the timing matches too.
- `forgot-password` returns the identical 202 whether or not the account exists.
- **Refresh reuse detection works.** Replaying a spent refresh token revokes
  every session for that user, not just the one presented.
- A reset token is single-use, and using it invalidates all other sessions.

Lint clean, typecheck clean, unit tests passing.

### Environment notes

- **Postgres runs on host port 5433**, not 5432. This machine already has a local
  Postgres bound to `127.0.0.1:5432`, so the container was unreachable through
  `localhost`. `docker-compose.yml` now takes `${POSTGRES_PORT:-5432}` and the
  local `.env` sets 5433. Anyone cloning fresh can leave the default.
- Node 20 is required (`nvm use`). The machine defaults to 18, which neither
  NestJS 11 nor Next.js 16 supports.
- Prisma reads the **root** `.env` via `dotenv-cli`; all `db:*` scripts wrap it.
- `tsconfig.build.json` excludes `prisma/`, otherwise the seed file drags
  `rootDir` up and the bundle lands at `dist/src/main.js`.

### Diagrams (2026-09-12)

Eight diagrams in `docs/diagrams/` — SVG for documents, PNG at 2x for slides,
Mermaid sources in `docs/diagrams/src/`. Regenerate with
`./tools/render-diagrams.sh`.

| File | What it shows | Audience |
| --- | --- | --- |
| `01-erd` | Full entity-relationship diagram, 17 entities with keys and constraints | Report, assessor |
| `02-architecture` | Deployment and integration — Vercel, Fly.io, Neon, Stripe, Resend, R2 | Report, assessor |
| `03-sequence-booking-payment` | The seat-locking transaction, Stripe webhook confirmation, and both failure paths | Report — this is the FR-A5 / FR-P2 evidence |
| `04-sequence-auth` | Registration, login, refresh rotation, reuse detection, password reset | Report, security section |
| `05-sequence-cancellation-refund` | Her 14-business-day policy as executable logic, all four outcomes | Report, and useful with the client |
| `06-flow-customer-journey` | End to end, ad click to review published | Report, client |
| `07-flow-current-vs-proposed` | Wix + Eventbrite today versus the new platform, with what each costs or returns | **Client meeting** |
| `08-flow-admin` | What Rehana does day to day without a developer | **Client meeting**, NFR-6 evidence |

Sources are text, so a requirement change edits one file and re-renders rather
than reopening a drawing tool.

### Brand kit (received 2026-09-12)

Assets in `docs/design/brand/`. Policy document at `docs/client/Policies.pdf`.

**Colours.** Contrast measured against WCAG 2.2 AA (NFR-9), not eyeballed:

| Hex | Name | On white | Verdict |
| --- | --- | --- | --- |
| `#3b2955` | dark indigo | 12.85:1 | Body text, headings, UI |
| `#4e2b4b` | deep plum | 11.86:1 | Body text, headings, UI |
| `#5b3460` | mid purple | 9.98:1 | Body text, headings, UI |
| `#ca7f3a` | burnt orange | 3.18:1 | **Large text only** (24px+), never body |
| `#e8a134` | gold | 2.19:1 | **Never text on white.** Decorative, or text on purple |

Gold reaches 4.55–5.86:1 on the three purples, so gold-on-purple — the logo's own
combination — is compliant and is where gold belongs. Gold on white is the trap,
and it is the pairing a designer reaches for first.

Working rule: **purples carry the text, gold only appears on dark ground.**

**Typefaces.** Her brand uses Trajan Pro Bold (wordmark) and Kozuka Mincho Pro
(Heavy, Bold). Both are Adobe commercial fonts and cannot be self-hosted on a
public site — confirming the licence concern raised in August. She has approved
substitutes: *"we can use the similar fonts"*.

Substitution plan, and note it is three tiers rather than two:

| Role | Face | Why |
| --- | --- | --- |
| Brand display | **Cinzel** | Roman inscriptional capitals, the standard open substitute for Trajan. Matches the wordmark closely. Caps only, used sparingly |
| Editorial serif | **Noto Serif** / **Shippori Mincho** | Mincho-style high-contrast serif in the spirit of Kozuka, for headings and lead copy |
| Interface | **Inter** or **Source Sans 3** | Forms, buttons, dates, tables, the admin dashboard |

The third tier is the point. Trajan is all-caps and Kozuka Mincho is a display
face; neither is usable for a checkout form or a data table. A booking platform
is mostly interface, and the audience skews older (NFR-1, NFR-9), so the working
text needs a face built for screen legibility. The brand faces set the tone on
the marketing surfaces; the interface face does the work.

### Still not started

`frontend/src/` is the default Next.js starter. Nothing has been committed since
2026-07-28 — all work is untracked in the working tree.

### Schedule

Roughly five months to the February 2027 finish. Phase 0 of nine is done.

The Master Class withdrawal removed about a phase of work. The second email of
2026-09-12 added some back: policy pages, credit vouchers, a business-day
calendar, photo consent, and possibly two more classes. Net position is roughly
unchanged. The build still has to start now.

### Client relationship — attention needed

Her email of 2026-09-12 opens: *"I was really wondering if your team is still
working on this project."*

Five weeks of silence has made a paying, engaged client doubt the project is
alive. She has since sent detailed prices, her full policy document, and live
listings, and says more is coming. She is holding up her end.

Reply quickly, and with something to show. That matters more than any single
requirement in this document.

### Next, in order

1. ~~Reply to the client~~ — **drafted**, at
   `docs/client/2026-09-12_reply-to-client.md`. Needs placeholders filled, then
   send. Commits to a fortnightly progress note from here on.
2. Commit the working tree. Five weeks of documentation is untracked.
3. ~~Phase 1 — Prisma schema and the auth module~~ — **done 2026-09-12.**
4. **Phase 2 — catalogue and sessions.** Public workshop list, detail pages,
   session calendar with live seat counts, contact and private-event enquiry
   forms. Admin CRUD for workshops and sessions.
5. Re-issue the SRS as **v1.1**: Master Class out, real catalogue and prices in,
   her actual refund policy in, private events decided. Chase the sign-off that
   v1.0 never received.
6. Regenerate the Requirements and Deliverables Mapping to match.
7. Fetch the eight Eventbrite listings for real class descriptions. The seed
   currently carries text marked `PLACEHOLDER` rather than inventing her words.
8. **Verify the SA public-holiday dates** before launch. The seeded list was
   computed, not taken from an authoritative source, and it drives real refund
   outcomes through the 14-business-day rule (§ 10 item 8).

## 12. Decision log

| # | Decision | Date | Rationale |
| --- | --- | --- | --- |
| ADR-001 | Stripe over Square | 2026-07-28 | § 3; pending confirmation of open item 7 |
| ADR-002 | Prisma over TypeORM | 2026-07-28 | § 3; type sharing across a solo-developed monorepo |
| ADR-003 | Self-hosted JWT auth in httpOnly cookies | 2026-07-28 | § 3; data ownership, cost, report substance |
| ADR-004 | Vercel + Fly.io + Neon, all Sydney | 2026-07-28 | § 3; every user is in South Australia |
| ADR-005 | Deliver full MoSCoW set, with a stated deferral order | 2026-07-28 | § 2; client direction |
| ADR-006 | shadcn/ui + Motion + Tailwind 4 | 2026-07-28 | § 7; accessible primitives that can be fully rebranded |
| ADR-007 | Design for all ages, not 50+ specifically | 2026-07-28 | § 7; client direction — Rehana's customer base spans ages |
| ADR-008 | Pessimistic row locking + timed seat holds for FR-A5 | 2026-07-28 | § 5; only reliable approach under peak concurrency |
| ADR-009 | Catalog modelled as product types, not a flat workshop list | 2026-08-04 | § 1; **amended 2026-09-12** — 3 types, 6 offers, after the Master Class withdrawal |
| ~~ADR-010~~ | ~~Master Class as a prepaid `Enrolment` entitlement~~ | 2026-08-04 | **Withdrawn 2026-09-12** — superseded by ADR-013. Never implemented. |
| ADR-011 | Recommend `studiorags.com.au` | 2026-08-04 | § 3; her ABN makes `.com.au` available, and it signals a local AU business to local customers |
| ADR-012 | Price and capacity are admin-editable data with workshop→session override, price snapshotted onto bookings | 2026-08-04 | § 5; serves NFR-6 (self-management), removes three client questions from the critical path, protects financial history |
| ADR-013 | Master Class removed entirely — no `Enrolment`, no credits, no expiry, no `COURSE` type | 2026-09-12 | § 1; client withdrew it. Removes the most complex subsystem in the design |
| ADR-014 | Refund policy is admin-editable data, not constants | 2026-09-12 | § 5; the client gave the shape but no numbers. Same reasoning as ADR-012 — she sets and changes them herself, and we are not blocked waiting |
| ADR-015 | Online sessions carry an admin-entered Zoom link, released only to confirmed bookings | 2026-09-12 | § 5; client pastes links herself. No materials posted, so no shipping address and no dispatch cut-off |
| ADR-016 | For the kids class, capacity counts **children**; the accompanying adult is implied | 2026-09-12 | § 5; every child is accompanied, so counting people would silently halve her usable room. Matches how she thinks about capacity |
| ADR-014a | Refund policy rewritten to the client's own published terms — 14 business days, $15/person late fee, 6-month credit vouchers | 2026-09-12 | § 5; she already had a written policy in force. Our earlier 7-day/50% proposal was a guess and is withdrawn |
| ADR-017 | Gift cards default to 36 months, not her stated 12 | 2026-09-12 | § 5; Australian Consumer Law sets a 3-year minimum. Raised with her in writing; her decision, but the system should not ship a likely-unlawful default |
| ADR-018 | Photo consent is an explicit checkbox at booking, not implied by attendance | 2026-09-12 | § 5; her policy relies on implied consent. A visible opt-out stored on the booking is stronger for her and fairer to the customer, at near-zero cost |
| ADR-019 | Private events and the travel surcharge stay **offline** — enquiry form only | 2026-09-12 | § 2; her $200 deposit contradicts FR-P3. Building a deposit-and-balance subsystem for the one part of her business she already runs comfortably offline is not a good use of five remaining months. **Confirmed by the developer 2026-09-12** |
| ADR-020 | Initial build covers **six** of her eight classes | 2026-09-12 | § 1; Paint with Mate and Kids' Tie Dye are excluded from the first build only. Both fit shapes we already support, so she adds them herself post-launch. Keeps the design and test surface tight without capping the product |

---

## 13. Working agreements

- **This file is updated every session.** Before a conversation ends: § 11 gets
  the real status, § 12 gets any new decision, § 10 gets any new open question.
- **The client sees documents, not code.** Every phase produces something in
  `docs/client/` written in plain language for a non-technical reader.
- **Decisions get recorded with reasoning**, so the capstone report can be
  assembled from the repo rather than reconstructed from memory.
- **Frontend direction is Claude's call**, per the developer's request; backend
  architecture is proposed by Claude and approved by the developer.
- **Nothing marked Must ships unverified.** Payment, seat locking, and email
  each get an explicit test before being called done.
