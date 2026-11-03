# Studio Rags web image, from Next's standalone output. The build context is
# frontend/:
#
#   docker build --file frontend/Dockerfile \
#     --build-arg API_ORIGIN=https://studio-rags-api.onrender.com \
#     --build-arg SITE_ENV=staging \
#     --tag studio-rags-web frontend
#
# Staging uses Vercel, not this image. It exists so the frontend can move to
# any container host later (ECS, Lightsail) without touching the code.

FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app


FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


FROM base AS build

# Rewrites and headers in next.config.ts are resolved at BUILD time and frozen
# into the output: the /api/v1 proxy destination comes from API_ORIGIN as it
# was during "next build". A different API therefore needs a new image, not
# just a different env var at run time.
ARG API_ORIGIN
ARG SITE_ENV
ENV API_ORIGIN=${API_ORIGIN} \
  SITE_ENV=${SITE_ENV}

# Refuse to build an image that would silently proxy to localhost.
RUN test -n "${API_ORIGIN}" \
  || { echo "Pass --build-arg API_ORIGIN=<the API's URL>" >&2; exit 1; }

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ may be empty, and git does not keep empty folders. Creating it keeps
# the COPY in the runtime stage valid either way.
RUN mkdir -p public && npm run build


FROM base AS runtime

# The same values again at run time, so the server-rendered status card calls
# the same API the rewrite proxies to. HOSTNAME=0.0.0.0 makes the standalone
# server listen on every interface, which a container needs.
ARG API_ORIGIN
ARG SITE_ENV
ENV NODE_ENV=production \
  HOSTNAME=0.0.0.0 \
  PORT=3000 \
  API_ORIGIN=${API_ORIGIN} \
  SITE_ENV=${SITE_ENV}

# The standalone server does not copy public/ or the static assets itself.
# The server output is owned by the app user, as in Next's own Docker example,
# because Next writes its cache under .next at run time (optimised images,
# regenerated pages). public/ stays root-owned and read-only.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Makes this server add the address of each connection to X-Forwarded-For
# before it proxies /api/v1, as every proxy in front of the API must. Next's
# standalone server does not, so the API could neither tell visitors apart nor
# stop them inventing an address. Count this container as one hop in the API's
# TRUST_PROXY. Root-owned and read-only, like public/.
COPY docker/forwarded-for.mjs ./forwarded-for.mjs

USER node

EXPOSE 3000

CMD ["node", "--import", "./forwarded-for.mjs", "server.js"]
