# Studio RAGs

Retrieval-Augmented Generation application built for ICT728 Project (MIT-KOI, Jun–Oct 2026).

Single repository (monorepo) holding both the API and the web client.

## Stack

| Layer      | Choice                                                    |
| ---------- | --------------------------------------------------------- |
| Backend    | NestJS 11 + TypeScript                                    |
| Database   | PostgreSQL 17 + `pgvector`                                |
| Embeddings | Voyage AI (`voyage-3`)                                    |
| Generation | Anthropic Claude (`claude-opus-5`)                        |
| Frontend   | Next.js (App Router) + TypeScript + Tailwind CSS          |
| Local infra| Docker Compose                                            |

> Anthropic does not expose an embeddings endpoint. Voyage AI is used for the
> vector side; Claude handles generation only.

## Layout

```
studio_rags/
├── backend/        NestJS API — ingestion, retrieval, chat
│   └── db/init/    SQL run once on first Postgres boot (enables pgvector)
├── frontend/       Next.js web client
├── docs/           Architecture notes, ADRs, report drafts
├── data/           Source corpus (gitignored — see .gitignore)
└── docker-compose.yml
```

## Prerequisites

- Node.js 20 (`.nvmrc` pins it — run `nvm use`)
- Docker Desktop
- API keys for Anthropic and Voyage AI

## Getting started

```bash
nvm use                      # switches to Node 20
cp .env.example .env         # then fill in ANTHROPIC_API_KEY and VOYAGE_API_KEY

docker compose up -d         # Postgres + pgvector on :5432

cd backend  && npm install && npm run start:dev   # API on :3001
cd frontend && npm install && npm run dev         # Web on :3000
```

## Environment

All configuration lives in a single root `.env`. See [.env.example](.env.example)
for the full list. Never commit `.env` — it is gitignored.
