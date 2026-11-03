# Studio Rags API image. The build context is backend/:
#
#   docker build --file backend/Dockerfile --tag studio-rags-api backend
#
# It runs on Render's free plan today. Nothing in it is Render-specific: the
# same image runs on ECS, Lightsail or a laptop, configured by env vars alone.

# Debian slim, not Alpine. Prisma's engines and argon2's prebuilt binary are
# built against glibc, and musl is a common source of engine load errors.
FROM node:24-bookworm-slim AS base

# Prisma's engines link against OpenSSL and verify TLS against the system CA
# store. Neon only accepts TLS connections, so both are required.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app


FROM base AS build

# Manifests first, so editing source code does not invalidate the install.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx prisma generate && npm run build

# How the runtime stage gets a working Prisma CLI for "prisma migrate deploy":
# by pruning, not by a second install. @prisma/client declares prisma as an
# optional peer, so the lockfile marks the CLI and its engines "devOptional",
# and npm keeps devOptional packages under --omit=dev. The CLI is then the
# exact version the lockfile pins, the same one that generated the client, and
# the schema engine it needs was already downloaded for this platform by npm ci.
# The version check fails the build loudly if that ever stops being true.
RUN npm prune --omit=dev --no-audit --no-fund \
  && node_modules/.bin/prisma --version


FROM base AS runtime

# Render sets PORT itself (10000) and requires a 0.0.0.0 bind. These defaults
# make a plain "docker run" behave the same way. CHECKPOINT_DISABLE stops the
# Prisma CLI phoning home for an update check on every start.
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=10000 \
  CHECKPOINT_DISABLE=1

# Owned by root and only readable by the app user, so a compromised process
# cannot rewrite its own code. node_modules/.prisma holds the generated client
# and its query engine, built for this exact platform in the build stage.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# The unprivileged user that ships with the official Node image.
USER node

EXPOSE 10000

# For "docker run" and any orchestrator that reads it (Render ignores it and
# uses healthCheckPath). Liveness only: it must never touch the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/v1/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# CMD rather than ENTRYPOINT, so "docker run <image> sh" opens a shell without
# running migrations. Run through sh so the script needs no execute bit.
CMD ["sh", "./docker-entrypoint.sh"]
