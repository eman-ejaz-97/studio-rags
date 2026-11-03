# Staging deployment runbook

Staging is a free test copy of Studio Rags, for demos and testing only.
It is not production.
The capstone rules forbid a production deployment and anything that costs the client.
A later paid move to AWS is a separate plan: [aws-production.md](aws-production.md).

## How it fits together

Everything runs on free plans, in or next to Singapore.

```
Browser
  │  https://<project>.vercel.app  (pages, and /api/v1/* on the same address)
  ▼
Vercel: Next.js frontend (Hobby plan)
  │  /api/v1/* is passed on server-side by the rewrite in frontend/next.config.ts
  ▼
Render: NestJS API in Docker (free plan, Singapore)
  │                                         │
  │ Prisma                                  │ AWS SDK v3 (S3 API)
  ▼                                         ▼
Neon Postgres 18                        Neon storage, private bucket "assets"
(free plan, aws-ap-southeast-1)         (same Neon project)
```

The browser only ever talks to the Vercel address.
That is deliberate.
The login cookies use `SameSite=Lax`, and `*.vercel.app` and `*.onrender.com` count as different sites.
A cookie set by `onrender.com` would never travel with a request from the Vercel page.
So the frontend proxies `/api/v1/*` to Render, and every cookie belongs to the Vercel address.

The API reaches the database two ways.
`DATABASE_URL` is Neon's pooled connection, for the running app.
`DATABASE_URL_UNPOOLED` is the direct connection, for migrations.

Health has two endpoints.
`/api/v1/health/live` does no I/O at all; Render calls it every few seconds.
`/api/v1/health` checks the database and storage; people and the status page call it.
Each call to `/api/v1/health` wakes Neon, so never point an uptime monitor at it every minute.

## Environments

| | Local | CI | Staging | Production (later) |
| --- | --- | --- | --- | --- |
| Purpose | Development | Every push and pull request | Demos and testing | The live business |
| Frontend | `next dev`, port 3000 | `next build` only | Vercel Hobby | To be decided |
| API | `nest start`, port 3001 | Tests, then `docker build` | Render free, Singapore | AWS, Sydney |
| Database | Docker Postgres, port 5433 | Postgres 18 service container | Neon free, Singapore | RDS or Lightsail Postgres |
| File storage | Not set up | Not set up | Neon storage | S3 |
| `SITE_ENV` | unset | `staging` | `staging` | `production` |
| Cost | Nothing | Nothing | Nothing | Paid by the client |

Production is **not part of the capstone**.
Nothing in this folder deploys it.

## Cost

Staging costs nothing, and it must stay that way.

- **Never add a payment card** to Render, Vercel or Neon.
  Without a card, going over a free limit pauses the service.
  With a card, it sends a bill.
- Render gives 750 free instance hours a month per workspace.
  One service running all month uses at most 744, so it always fits.
- Render's free service sleeps after 15 minutes without visitors.
  The next visit waits about a minute while it wakes.
- Neon's free plan includes 100 compute hours (CU-hours) a month.
  The database sleeps when idle, which is why the health check Render calls must never touch it.
- Vercel's Hobby plan is for non-commercial use.
  A capstone test site fits that.
  The real business site would need a paid plan or a different host.

## One-time setup

Do Render first, then Vercel, then seed the admin.
Each needs the other's address, so expect to fix one value at the end.

### Before you start

- `render.yaml` is on the branch you will deploy (normally `main`).
- The repo root has `.env.local`, created by Neon's CLI.
  It holds the real staging credentials.
  Copy values from it only into Render's secret fields; never into a file, a chat or a commit.
- Never run `vercel link`, `vercel pull` or `vercel env pull` in the repo root.
  Each one writes a `.env.local` in the folder it runs in, which would collide with the Neon credentials.
  If you ever need them, run them in a throwaway copy of the repo.

### 1. Render (the API)

1. Sign in to [Render](https://dashboard.render.com) with GitHub.
   Use a free workspace and skip any card prompt.
2. Choose **New**, then **Blueprint**.
3. Connect the `studio_rags` repository and choose the branch (`main`).
4. Render reads `render.yaml` and shows one service: `studio-rags-api`, free plan, Singapore.
5. Render asks for the values marked `sync: false`.
   Fill them in as follows:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `DATABASE_URL` from `.env.local`, with `&connect_timeout=15` added to the end |
   | `DATABASE_URL_UNPOOLED` | `DATABASE_URL_UNPOOLED` from `.env.local`, with `&connect_timeout=15` added to the end |
   | `AWS_ACCESS_KEY_ID` | From `.env.local`, unchanged |
   | `AWS_SECRET_ACCESS_KEY` | From `.env.local`, unchanged |
   | `AWS_ENDPOINT_URL_S3` | From `.env.local`, unchanged |
   | `AWS_REGION` | From `.env.local`, unchanged |
   | `CORS_ORIGIN` | The Vercel address, e.g. `https://studio-rags.vercel.app` |
   | `APP_URL` | The same Vercel address |

   Notes on those values:
   - `connect_timeout=15` gives a sleeping Neon database time to wake. Prisma's default is 5 seconds.
     Neon's URLs already contain a `?`, so append with `&`.
     A URL without a `?` would take `?connect_timeout=15` instead.
   - `CORS_ORIGIN` and `APP_URL` must be the bare address: no path and no trailing slash.
     The API refuses to start otherwise, and the log names the variable.
   - Vercel's address is `https://<project-name>.vercel.app`.
     Use the name you will give the Vercel project in step 2.
     If it turns out different, change both values later under the service's **Environment** tab.
6. Choose **Apply**.
   The first build takes several minutes on the free plan.
7. Watch the service's **Logs**.
   A good start prints `Applying database migrations`, then Prisma's migration summary, then `API listening on http://0.0.0.0:10000/api/v1`.
8. Copy the service address from the top of the page, normally `https://studio-rags-api.onrender.com`.
9. Check it answers:

   ```sh
   curl -s https://studio-rags-api.onrender.com/api/v1/health/live
   # {"status":"ok","service":"studio-rags-api"}
   ```

Render creates `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` itself, as two separate random values.
Never set them to the same value: the API refuses to start if they match.

Render only asks for `sync: false` values when the Blueprint is first created.
To change one later, use the service's **Environment** tab.

### 2. Vercel (the frontend)

Already done for this project on 2026-11-03, with the Vercel CLI: project `studio-rags`, root directory `frontend`, Node 24.x, both variables below, the GitHub repo connected, functions in Singapore, and previews behind Vercel login.
The steps stay here for rebuilding it from scratch.

1. Sign in to [Vercel](https://vercel.com) with GitHub, on the Hobby plan.
   Skip any card prompt.
2. Choose **Add New**, then **Project**, and import the `studio_rags` repository.
3. Set **Root Directory** to `frontend`.
   Vercel then detects Next.js on its own.
4. Add two environment variables, for both **Production** and **Preview**:

   | Variable | Value |
   | --- | --- |
   | `API_ORIGIN` | The Render address from step 1.8, e.g. `https://studio-rags-api.onrender.com` (no `/api/v1`, no trailing slash) |
   | `SITE_ENV` | `staging` |

5. Choose **Deploy**.
6. In the project's **Settings**:
   - Under **Git**, check the production branch is `main`.
   - Under **Build and Deployment**, set the Node.js version to 24.x, to match `.nvmrc`.
   - Under **Functions**, set the function region to Singapore (`sin1`).
     The status page is rendered next to the API, so its health call stays short.
   - Under **Deployment Protection**, set Vercel Authentication to **Only Preview Deployments**.
     The default also protects the production `.vercel.app` address, which would ask Rehana to log in to Vercel.
7. Copy the production address, `https://<project-name>.vercel.app`.
   If it differs from what you gave Render, update `CORS_ORIGIN` and `APP_URL` there.

`API_ORIGIN` and `SITE_ENV` are read when Vercel **builds** the site.
After changing either one, redeploy (**Deployments**, then **Redeploy** on the latest one).

`API_ORIGIN` is not `NEXT_PUBLIC_`.
The browser never learns the Render address.

### 3. Seed the staging admin (once)

The seed creates the admin account, the six classes with sessions, the refund policy and the SA public holidays.
It is safe to run again.

Run it from `backend/`, with its dependencies installed:

```sh
cd backend
read -rs 'SEED_ADMIN_PASSWORD?New admin password (12+ characters): '; echo
(
  set -a; . ../.env.local; set +a
  DATABASE_URL="$DATABASE_URL_UNPOOLED" \
  SEED_ADMIN_EMAIL='you@example.com' \
  SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" \
  npx ts-node prisma/seed.ts
)
unset SEED_ADMIN_PASSWORD
```

What each part does:

- `read -rs` asks for the password without showing it or saving it in shell history.
  That is zsh syntax; in bash use `read -rsp 'Password: ' SEED_ADMIN_PASSWORD`.
- The parentheses load `.env.local` into a throwaway subshell, so the secrets vanish when it ends.
- `DATABASE_URL="$DATABASE_URL_UNPOOLED"` sends the seed through Neon's direct connection.
  Seeding is a one-off admin job, like a migration, so it skips the pooler.
- Replace `you@example.com` with the address you will sign in with.
- `npm run db:seed` is not used, because it loads the root `.env`: your local development settings.

The seed refuses to run with the default password, on purpose.
That password is written in the repository, which is public.
The seed only accepts it for a database on `localhost`, and never when `NODE_ENV` is `production`.
Anywhere else, give it a real password of at least 12 characters, and keep it in a password manager.

An admin that already exists keeps its password when the seed runs again.
To replace it, add `SEED_ADMIN_ROTATE=1`.
That also signs out every session the old password opened.

## Check it works

1. Open the Vercel address.
   The purple banner says "Test site — bookings here are not real".
   The status card shows API, Database and File storage all **Up**.
2. Ask for the health report through the Vercel address, the way the browser does:

   ```sh
   curl -s https://<project-name>.vercel.app/api/v1/health
   # {"status":"ok","service":"studio-rags-api","database":"up","storage":"up","timestamp":"..."}
   ```

3. Check search engines are told to stay away:

   ```sh
   curl -sI https://<project-name>.vercel.app/ | grep -i x-robots-tag
   # x-robots-tag: noindex, nofollow
   ```

4. Test Neon directly from your laptop, from `backend/`:

   ```sh
   (set -a; . ../.env.local; set +a; npm run smoke:neon)
   ```

   It prints PASS or FAIL for the pooled connection, the direct connection and storage.
   It writes one test file to the bucket and deletes it again.
   It never prints a secret.
5. Once, after the first deploy, [check `TRUST_PROXY`](#check-trust_proxy).

## Before a demo

- [ ] Two minutes before showing Rehana, open the Vercel address. This wakes the API and the database.
- [ ] Refresh until the status card shows all three **Up**.
- [ ] Use the main Vercel address. Never show or send a preview address.
- [ ] Point out the purple banner: nothing booked on this site is real.
- [ ] Keep the tab in use. Fifteen minutes without a request puts the API back to sleep.

## How deploys happen

- **Merge to `main`.** GitHub Actions runs CI: backend tests, frontend build, and both Docker images.
- **Render deploys the API only if CI passes** on that commit (`autoDeployTrigger: checksPass`).
  It only rebuilds when something under `backend/` changed.
- **The new container migrates, then starts.**
  `backend/docker-entrypoint.sh` runs `prisma migrate deploy`, then the API.
  A failed migration stops the container, the deploy fails, and the previous version keeps serving.
- **Vercel deploys `main` itself**, on every push.
  It does not wait for CI.
  To keep a red build off staging, protect `main` on GitHub: require the CI checks before merging.
- **Pull requests get Vercel preview addresses.**
  They sit behind a Vercel login, so they are for you only.
  Never send one to the client.
  Previews use the same staging API and database, so anything you do there changes staging data.

Migrations live in `backend/prisma/migrations`.
Never edit one that has already run on staging; add a new one instead.

## Troubleshooting

### "The test server is waking up"

The API was asleep.
Wait a minute and refresh.

If it lasts more than three minutes, open the service's **Logs** on Render.
Two causes are common:

- The environment check failed at start-up.
  The log starts with `Invalid environment configuration` and names each bad variable.
- A migration failed.
  The log shows Prisma's error just after `Applying database migrations`.

### Prisma error P1001: "Can't reach database server"

The Neon database was asleep and did not wake before Prisma gave up.
Check that both database URLs on Render end with `&connect_timeout=15`.
Then restart the service from the Render dashboard, or redeploy the latest commit.

If it keeps happening, open the Neon console.
The project may be paused because the month's free compute hours are used up.

### Signed in, but the site acts signed out

Cookies only work through the Vercel address.
The API sets each cookie for the address the browser called.
Through Vercel, that is the Vercel address, which is where the pages look.
Opening the `onrender.com` address directly gives that address the cookie instead, and the site never sees it.

Staging cookies are also `Secure`, because `NODE_ENV` is `production`.
Browsers drop them over plain `http`, for example a local `docker run` on `http://localhost`.

### A CORS error in the browser console

Browser code should never see CORS on staging, because it only calls its own address.
A CORS error means some code calls the Render address directly.
Change it to call `/api/v1/...` instead.

### Check TRUST_PROXY

**What it is.** `TRUST_PROXY` is the number of proxies in front of the API.
The API uses it to find each visitor's real address.
The login limit (10 attempts a minute) counts attempts per address.

**What counts as a proxy.** Only a proxy that adds the address it saw to the `X-Forwarded-For` header.
Each one adds an entry, and the API believes the last `TRUST_PROXY` entries.
A proxy that passes the header on unchanged adds nothing, so counting it would make the API believe an address the visitor typed.
Next.js's own server is such a proxy.
The frontend Docker image fixes that by starting it with `frontend/docker/forwarded-for.mjs`, so that container counts as one proxy.
Vercel does not use the image; its edge writes the header itself.

**Why it is 2.** The assumed chain is browser, then Vercel, then Render's proxy, then the API.
That is two proxies.
It is an assumption until this test confirms it.

**The test.** Run it once after the first deploy, and again if Vercel or Render change how they route traffic.

```sh
SITE=https://<project-name>.vercel.app
login() {
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SITE/api/v1/auth/login" \
    -H 'content-type: application/json' \
    -d '{"email":"nobody@example.com","password":"not-the-password"}' "$@"
}

# 1. Use up your allowance: ten 401s, then 429.
for i in $(seq 11); do login; done

# 2. Within a minute, switch the laptop to your phone's hotspot (a different
#    public address) and try once. Expect 401, not 429.
login

# 3. Back on the first network, still within the minute, pretend to be
#    someone else. Expect 429: the API must ignore a made-up address.
login -H 'X-Forwarded-For: 198.51.100.7'
```

**Reading the result.**

- Step 2 gives 429: every visitor shares one allowance.
  The API is seeing a proxy's address, so `TRUST_PROXY` is too low.
  Raise it by one on Render and test again.
- Step 3 gives 401: a visitor can choose their own address and get a fresh allowance.
  `TRUST_PROXY` is too high.
  Lower it by one on Render and test again.
- Both as expected: the setting is right.

**A known gap.** Anyone who calls the `onrender.com` address directly passes through one proxy fewer than a visitor coming through Vercel.
With `TRUST_PROXY=2`, such a caller may be able to choose their own address with an `X-Forwarded-For` header.
To see it, run the test above with `SITE=https://studio-rags-api.onrender.com`.
It is acceptable on staging, which holds no real accounts.
The real launch should close it, for example by only accepting API traffic from the frontend.

### Vercel build is green, then the deploy fails with ENOENT

The log ends with `Deploying outputs...` and the error names `.next/routes-manifest-deterministic.json` at the repo root.
Vercel's Next.js build adapter finds the app by its path from `outputFileTracingRoot`.
Pinning that root to `frontend/` makes the path empty, so it looks for `.next` in the wrong folder.
`frontend/src/lib/build-roots.ts` therefore pins the roots everywhere except Vercel; keep it that way.

### Render build fails at `npm ci`

`backend/package-lock.json` does not match `backend/package.json`.
Run `npm install` in `backend/`, commit the updated lockfile, and push.

### Everything stopped near the end of the month

A free allowance ran out: Render's instance hours or Neon's compute hours.
The service resumes when the next month starts.
Do not add a card to make it come back sooner.
