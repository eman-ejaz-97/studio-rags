#!/bin/sh
# Starts the Studio Rags API container: migrate, then serve.
#
# Migrations run here, on every start, because Render's free plan has no
# pre-deploy command. "prisma migrate deploy" only applies migrations the
# database has not recorded yet, so a restart with nothing new is a quick no-op.
# It connects through DATABASE_URL_UNPOOLED (the schema's directUrl), because a
# transaction-mode pooler such as Neon's cannot hold the advisory lock that
# stops two starting containers from migrating at once.
#
# set -e: a failed migration stops the container instead of serving a schema
# the code does not expect. Render then keeps the previous deploy live.
set -eu

echo "Applying database migrations"
node_modules/.bin/prisma migrate deploy

# exec replaces this shell, so node runs as PID 1 and receives Render's SIGTERM
# directly. Nest's shutdown hooks then close the database pool cleanly.
echo "Starting the API"
exec node dist/main
