# Studio Rags — Living Specification

**Status:** v0.1 · Last updated 2026-07-28
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

### The workshops

Indonesian Batik · Japanese Shibori · Woodblock Printing · Kids & Parents
Painting. Regular Tie-Dye is being **removed** (low demand). Chunri dyeing is
unconfirmed — see § 10.

### Seasonality

Peak is the **Adelaide Fringe Festival, mid-February to mid-March**. Booking
volume rises sharply and Kids & Parents Painting is especially popular. Note that
this lands immediately after our February 2027 finish — the platform's first real
test is a peak period, so load behaviour and overbooking safety are not
theoretical concerns.

---

## 2. Scope

Scope is governed by the client-signed SRS at
[`docs/client/04_SRS_StudioRags.docx`](client/). This section restates it for
traceability; the SRS wins on *what* is in scope, this spec owns *how*.

### Decision: deliver the full MoSCoW set

The SRS ranks requirements Must/Should/Could. **We are targeting all of them**,
including gift cards and reviews. If schedule pressure appears, the deferral
order is: online classes (FR-C15) → gift cards (FR-C12/FR-P4) → reviews
(FR-C11). Nothing marked Must is negotiable.

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
| FR-C15 | Online sessions | ⚠ unconfirmed |
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
`PUBLISHED` | `ARCHIVED`), `sortOrder`, timestamps.

**`WorkshopImage`** — `id`, `workshopId`, `url`, `alt` (required, non-empty —
accessibility is not optional), `width`, `height`, `position`, `isHero`.

**`Session`** — a specific dated instance. `id`, `workshopId`, `startsAt`,
`endsAt`, `capacity`, `priceCentsOverride` (nullable), `location`,
`onlineJoinUrl`, `status` (`SCHEDULED` | `CANCELLED` | `COMPLETED`), timestamps.

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
likely to embarrass us during the Fringe peak. Optimistic checks ("count seats,
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
| NFR-5 | No double bookings; survives Fringe peak | § 5 locking design; load test 50 concurrent → exactly capacity |
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

| # | Question | Blocks | Owner |
| --- | --- | --- | --- |
| 1 | Online classes in scope? Delivery method? | FR-C15 | Client |
| 2 | Final workshop list — is Chunri dyeing included? | Seed data, phase 2 | Client |
| 3 | Does the client have an ABN and business bank account? | Live payments (not test-mode build) | Client |
| 4 | Custom domain owned, or only `wixsite.com`? | Phase 9, email deliverability | Client |
| 5 | Acceptable ongoing budget for hosting/domain/fees? | § 3 hosting | Client |
| 6 | MoSCoW sign-off | Scope | Client — *we propose delivering all* |
| 7 | Does she use Square POS in the studio today? | Confirms ADR-001 | Client |
| 8 | Brand kit: logo, fonts, colours, event photography | Design system, phase 2 | Client — *confirmed available, not yet received* |
| 9 | Cancellation and refund policy — window, fee, who initiates? | Booking rules, phase 3 | Client — **not in the SRS at all; needs asking** |
| 10 | Session price overrides — do prices vary by date (e.g. Fringe)? | Pricing model | Client |
| 11 | Gift card expiry — AU law requires minimum 3 years | Phase 6 | Us, then confirm |
| 12 | Studio physical capacity per workshop type | Default capacities | Client |

Item 9 is the notable gap: the SRS specifies taking money but never says what
happens when a customer cancels. That needs to be settled before phase 3.

---

## 11. Current status

**Phase 0 — Baseline.**

Done:
- Read and analysed the SRS.
- Found the scaffold mismatch: the initial commit built a
  retrieval-augmented-generation app (pgvector, Voyage embeddings, Claude), a
  misreading of "Studio Rags" as "Studio RAGs". Removed pgvector, the Voyage and
  Anthropic configuration, the `data/` corpus directory, and the RAG README.
- Re-baselined `README.md`, `.env.example`, `docker-compose.yml` (Postgres 17 +
  Mailpit), `.gitignore`.
- Wrote this spec.

Next:
- Land ADRs 001–004 in `docs/adr/`.
- Move the SRS into `docs/client/`.
- Phase 1: Prisma schema and the auth module.

---

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
| ADR-008 | Pessimistic row locking + timed seat holds for FR-A5 | 2026-07-28 | § 5; only reliable approach under Fringe-peak concurrency |

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
