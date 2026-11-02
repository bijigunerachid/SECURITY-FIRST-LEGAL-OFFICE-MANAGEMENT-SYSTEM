# Lexora production images, built from one Dockerfile:
#
#   docker build --target api     -t lexora-api .    API, worker and admin CLI
#   docker build --target migrate -t lexora-migrate . applies database migrations
#   docker build --target web     -t lexora-web .    Caddy: web app + reverse proxy
#
# Base images are official images pinned by digest (rebuilt upstream for
# operating-system patches; scanned with Trivy). Install scripts stay
# disabled (.npmrc); the Prisma client is generated explicitly.

# Node.js 24.22.1 on Alpine (bundled time-zone data 2026e, see lib/tzdata.ts).
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS node-base
WORKDIR /app
ENV NODE_ENV=production

# --- Dependencies (all, for building) -------------------------------------------
FROM node-base AS deps
COPY .npmrc package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --include=dev

# --- Build ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run generate && npm run build

# --- Migrations: the only image that holds the schema owner's credentials at run time.
FROM build AS migrate
# Prisma's CLI is called directly; npm (and its bundled packages, which carry
# their own advisories) is not needed at run time.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER node
WORKDIR /app/apps/api
# The connection string comes from a Docker secret, never from the environment.
ENTRYPOINT ["/bin/sh", "-c", "MIGRATION_DATABASE_URL=\"$(cat /run/secrets/migration_database_url)\" exec /app/node_modules/.bin/prisma migrate deploy"]

# --- Runtime dependencies only --------------------------------------------------------
FROM node-base AS runtime-deps
COPY .npmrc package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @lexora/api --workspace @lexora/shared && npm cache clean --force

# --- API, worker and admin CLI ----------------------------------------------------------
FROM node-base AS api
# The whole installed tree: workspaces keep their own node_modules when a
# version differs from the hoisted one (the API's cookie 2 next to Express's).
COPY --from=runtime-deps /app ./
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# The documents volume takes this folder's owner and mode when first created:
# writable by the API's user only (the API also checks it at start-up).
# npm and corepack are not needed to run (only `node`), and npm's bundled
# packages carry their own advisories: removed from the running image.
RUN apk upgrade --no-cache \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && mkdir -p /var/lib/lexora/documents && chown node:node /var/lib/lexora/documents \
  && chmod 700 /var/lib/lexora/documents
# Unprivileged user from the base image; the filesystem is mounted read-only (compose).
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]

# --- Caddy, rebuilt with a patched Go toolchain -----------------------------------------
# The upstream 2.11.6 binary was compiled with Go 1.26.8 and libraries that
# now have published fixes (standard library, golang.org/x/net, go-jose,
# chi). The same Caddy release is rebuilt here with Go 1.26.10 and the fixed
# library versions (all modules verified against the Go checksum database).
FROM golang:1.26.10-alpine@sha256:a2012b4a1d1f9f7e9f44e0d39b805a901e856b1dd80b4e6ee4338db547050308 AS caddy-build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-trimpath
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7 \
  && xcaddy build v2.11.6 --output /caddy \
    --replace golang.org/x/net=golang.org/x/net@v0.60.0 \
    --replace github.com/go-jose/go-jose/v4=github.com/go-jose/go-jose/v4@v4.1.6 \
    --replace github.com/go-chi/chi/v5=github.com/go-chi/chi/v5@v5.4.0 \
  && /caddy version

# --- Web app behind Caddy -----------------------------------------------------------------
FROM caddy:2.11.6-alpine@sha256:d44355d3c2149dc580ce2cac735955d1c08d3d00882c30489c241aa51a5c10d9 AS web
# The rebuilt binary replaces the upstream one (and carries no file capability).
COPY --from=caddy-build /caddy /usr/bin/caddy
COPY --from=build /app/apps/web/dist /srv
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Operating-system packages: take the security fixes published since the
# base image was built, and drop curl, which Caddy does not use (the health
# check uses busybox wget). Then an unprivileged user; new volumes for the
# CA keys and certificates take its ownership. (The upstream binary's file
# capability, which the kernel refuses with every capability dropped, went
# with the replaced binary: Caddy listens on high ports.)
RUN apk upgrade --no-cache && apk del --no-cache curl \
  && addgroup -S -g 10001 caddy && adduser -S -u 10001 -G caddy caddy \
  && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
EXPOSE 8080 8443
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/"]
