# Studio Rags

Workshop booking and payment platform for **Studio Rags** — a textile-arts studio
in Sefton Park, South Australia, run by Rehana Usman.

Customers browse workshops, pick a session, pay in full, and get confirmation and
reminder emails — all without leaving the site. Rehana manages workshops,
sessions, bookings, and customers from an admin dashboard.

Built as an ICT capstone project, but developed to production standard: on the
client's approval this goes live as the real business platform.

> `Rags` is the studio's name, not retrieval-augmented generation.

## Stack

| Layer       | Choice                                                  |
| ----------- | ------------------------------------------------------- |
| Backend     | NestJS 11 + TypeScript                                  |
| Database    | PostgreSQL 17 + Prisma                                  |
| Auth        | JWT (access + refresh) in httpOnly cookies, argon2      |
| Payments    | Stripe (Payment Intents + webhooks), AUD                |
| Email       | React Email templates; Mailpit in dev, Resend in prod   |
| Frontend    | Next.js 16 (App Router) + TypeScript + Tailwind CSS 4   |
| UI          | shadcn/ui (Radix primitives) + Motion                   |
| Local infra | Docker Compose                                          |

## Layout

```
studio_rags/
├── backend/        NestJS API — auth, workshops, sessions, bookings, payments
├── frontend/       Next.js web client — public site + admin dashboard
├── docs/           Spec, ADRs, client-facing documents  ← start at docs/SPEC.md
└── docker-compose.yml
```

## Prerequisites

- Node.js 24 LTS (`.nvmrc` pins it — run `nvm use`)
- Docker Desktop
- A Stripe account in test mode

## Getting started

```bash
nvm use                      # switches to Node 24
cp .env.example .env         # then fill in the secrets

docker compose up -d         # Postgres on :5432, Mailpit on :8025

cd backend  && npm install && npm run db:deploy && npm run start:dev   # API on :3001
cd frontend && npm install && npm run dev         # Web on :3000
```

## Tests

```bash
cd backend
npm run lint:check && npm run typecheck
npx jest                                     # unit tests
npm run test:e2e:prepare && npm run test:e2e # end-to-end, real Postgres
```

The end-to-end suite runs against `studio_rags_test` (create it once:
`docker exec studio_rags_db psql -U studio -d studio_rags -c 'CREATE DATABASE studio_rags_test'`).
It refuses to touch any database whose name does not end in `_test`.

CI (`.github/workflows/ci.yml`) runs all of this, the frontend checks and both
Docker builds on every pull request and on `main`.

## Staging

A free staging site for client demos: Vercel (frontend) → Render (API, Docker)
→ Neon (Postgres + file storage). Nothing here is production, and nothing costs
the client. Setup, operation and troubleshooting: [docs/deploy/README.md](docs/deploy/README.md).

## Documentation

[docs/SPEC.md](docs/SPEC.md) is the single source of truth — scope, data model,
API contract, design system, and decision log. It is kept current at all times.
Everything else in [docs/](docs/) is either an ADR or a client-facing document.

## Environment

All configuration lives in a single root `.env`. See [.env.example](.env.example)
for the full list. Never commit `.env` — it is gitignored.
