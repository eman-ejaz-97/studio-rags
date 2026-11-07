# Studio Rags

Workshop booking and payment platform for a real client, Rehana Usman. It goes
live as her business system on approval — real payments, real customer data.
Not an academic prototype.

[docs/SPEC.md](docs/SPEC.md) is the source of truth for scope, data model, API
contract and decisions. Read it before proposing anything, and update it before
the session ends: § 11 status, § 12 any new decision, § 10 any new open question.

## Visual direction — Fabric Fun (approved 2026-11-03, ADR-021)

The client chose **Fabric Fun** from three directions shown. Build everything in
this direction. Atelier and Indigo Vat remain in
`docs/design/mockups/directions.html` as the rejected alternatives for the
report — do not maintain or extend them.

Warm and playful: cream paper rather than white, plum and ochre display type,
rounded cards, pill buttons, and a quatrefoil border motif traced from the carved
woodblocks in her own photograph.

| Token | Value | Use |
| --- | --- | --- |
| Paper | `#FFFCF6` | page ground — warm, never pure white |
| Plum | `#4E2B4B` | headings, card titles |
| Purple | `#5B3460` | primary buttons, nav, price tags |
| Ochre | `#CA7F3A` | second headline line, links — 24px+ only |
| Gold | `#E8A134` | the *Book a class* button — dark ground only |
| Display | Fraunces SemiBold / Black | substitutes Kozuka Mincho Pro |
| Interface | Inter | forms, buttons, dates, tables, admin |

**The colour rule, and it is easy to get wrong:** the purples carry the text,
gold only ever appears on a dark ground. Gold on white is 2.19:1 and fails AA.
Ochre on white is 3.18:1 — large text only. It is the pairing a designer reaches
for first, so check it in review.

Built screens and the full token set are in Figma, page *Fabric Fun — Home &
Auth*: https://www.figma.com/design/WRSDQ8L6iHupgt77wpV0iP/ — 29 colour styles
and 26 text styles, each swatch carrying its measured contrast ratio. Mirror
those into Tailwind tokens when the frontend build starts; do not re-derive them
by eye.

## Non-negotiables

- Base body text 17–18px, never below 16px. Tap targets ≥ 44px, primary actions
  ≥ 48px tall. WCAG 2.2 AA throughout (NFR-9).
- Forms: labels always visible, never placeholder-as-label. Errors in words next
  to the field, never colour alone.
- Mobile-first. The booking flow must complete one-handed.
- Nothing marked Must ships unverified — payment, seat locking and email each
  get an explicit test before being called done.

## Environments and safety

- **Node 24 LTS** (`.nvmrc`). The shell defaults to 18, so start commands with
  `nvm use`.
- **No production deployment, ever, as part of the capstone, and nothing that
  costs the client** — the professor's rule (ADR-024). There is only a free
  staging site for demos: Vercel → Render → Neon. Never add a payment card to
  any service. Runbook: `docs/deploy/README.md`.
- **`.env.local` at the repo root holds real Neon credentials** for staging.
  Never print, copy or commit it. Do not run migrations or writes against Neon
  without the developer's go-ahead — Render applies migrations when it deploys.
  `vercel link`, `vercel pull` and `vercel env pull` all write a `.env.local`
  where they run, so never run them in the repo root.
- Local dev uses Docker Postgres 17 on port 5433 (`studio_rags`). Never write
  to it from tests. Tests use databases ending in `_test`, and the harness
  refuses anything else.
- Before calling work done: `npm run lint:check`, `npm run typecheck`,
  `npx jest`, `npm run test:e2e:prepare && npm run test:e2e` in `backend/`;
  `npm run lint`, `npm run typecheck`, `npm test`, `npx next build` in
  `frontend/`. CI runs the same and gates staging.

## Phase explainers

The developer owns this project. Every phase ends with an HTML explainer in
`docs/explainers/`: what was built, how it works end to end, why, how it fails,
how to see it running. Use the `explain-the-change` skill's build script so code
excerpts are verified against the repo. A phase is not done without it.

## Schema changes

While in development, migrations may add, rewrite or drop tables freely —
against local Docker Postgres. Neon rules above still apply, and flag any
destructive migration before it merges to `main`.

## Client communication

Everything the client sees goes in `docs/client/`, in plain language, written for
a non-technical reader. Dated drafts, reviewed before sending. We owe her a
fortnightly progress note — that was promised on 2026-09-12 and it matters more
than any single requirement.
