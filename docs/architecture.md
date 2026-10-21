# Architecture

Status: **Phase 3 (identity and sessions) built.** What is described under
"[What exists now](#what-exists-now)" is implemented and tested; the rest of
this document is the target design. Each phase updates it to describe what
was actually built.

## Goals

- Keep confidential legal information away from anyone who has no business
  reason to see it, including other office staff.
- Run on a single dedicated server inside one office, with no public internet
  exposure.
- Be simple enough for one office to operate, back up and restore.

## Overview

A **modular monolith**: one API process, one background worker built from the
same code, one database. Microservices would add network boundaries,
credentials and failure modes without any benefit at this scale
([ADR 0001](decisions/0001-modular-monolith-and-stack.md)).

```
Office devices (browsers)
        │  HTTPS only, office subnet only
        ▼
┌──────────────────────────── Office server (Linux, Docker Engine) ─────────┐
│  proxy (Caddy)  ── serves the built web app (static files)                │
│        │        ── forwards /api/* to the API                             │
│        ▼                                                                  │
│  api (Express) ───────┬───────────────┬──────────────┐                    │
│  worker (same image)  │               │              │                    │
│                       ▼               ▼              ▼                    │
│               postgres          document volume    clamav                 │
│          (internal network)  (private, API only)  (internal network)      │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ▼  encrypted backups (restic), at least one copy offline
```

The web app and the API share one origin. The browser never makes
cross-origin API calls, so no CORS configuration is needed and the Content
Security Policy can stay strict.

## Technology

Exact versions are pinned when each dependency is installed, after checking
current releases and security advisories. They are recorded in the lockfile,
not in this document.

| Area                       | Choice                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| Runtime                    | Node.js, current Active LTS line (24.x at time of writing)                                         |
| Language                   | TypeScript, strict mode                                                                            |
| Web                        | React, Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form, Zod           |
| Localization               | French and Arabic, with right-to-left layout for Arabic                                            |
| API                        | Express with Helmet, Zod validation, central error handling                                        |
| Database                   | PostgreSQL (a currently supported major version) with Prisma                                       |
| Logging                    | Pino, structured JSON, with a redaction list                                                       |
| Background jobs            | pg-boss, stored in PostgreSQL                                                                      |
| Rate limiting and sessions | Stored in PostgreSQL. No Redis ([ADR 0005](decisions/0005-postgresql-for-sessions-limits-jobs.md)) |
| Malware scanning           | ClamAV (clamd) on the internal network                                                             |
| Reverse proxy and TLS      | Caddy                                                                                              |
| Deployment                 | Docker Compose on Docker Engine, Linux host ([ADR 0006](decisions/0006-deployment-host.md))        |
| Backups                    | restic, encrypted ([ADR 0007](decisions/0007-backups.md))                                          |
| Tests                      | Vitest, Supertest, real PostgreSQL, Playwright                                                     |

Versions in use (Phase 2), chosen by the
[dependency policy](security.md#supply-chain): Node.js 22.13+ or 24 (CI and
production use 24), TypeScript 6.0, React 19.3, React Router 7.18, Vite 8.3,
Tailwind CSS 4.3, Express 5.2, Prisma 7.10, Zod 4.6, PostgreSQL 18.6, Vitest
4.1, Playwright 1.63, ESLint 9.39. TypeScript 7, ESLint 10 and React Router 8
were not adopted yet: typescript-eslint and eslint-plugin-jsx-a11y do not
support TypeScript 7 or ESLint 10, and React Router 8 requires Node.js 22.22+.

## Repository layout

Folders marked _(later)_ arrive with the phases that need them.

```
apps/
  api/                  Express API (and, later, the background worker)
    prisma/             schema and reviewed migrations
    data/               offline breached-password list (see its README)
    scripts/            prisma-with-env.mjs (Prisma with one explicit env file),
                        seed-e2e.ts and e2e-accounts.json (synthetic test accounts)
    src/
      cli/              administrator tool: create the first admin, recover access
      config/           settings loading and validation (env.ts)
      http/             app setup (app.ts), middleware (auth, CSRF, errors), routes
      lib/              database client and probe, logger, crypto helpers
      modules/auth/     passwords, sessions, TOTP, recovery codes, rate limits,
                        AuthService (sign-in, second factor, user administration)
      modules/audit/    hash-chained audit log
      generated/        Prisma client (generated, not committed)
      test/             test helpers, integration context, integration-test guard
      policies/         (later) authorization rules and query scoping
  web/                  React application
    e2e/                Playwright end-to-end tests
    src/
      app/              router and providers
      components/       layout and UI components (shadcn/ui pattern)
      features/         one folder per area: auth/ (sign-in, second factor, guards,
                        re-authentication), security/, admin/, home/, status/
      i18n/             French and Arabic translations, direction handling
      lib/              API client, helpers
      routes/           not-found and error pages
packages/
  shared/               Zod schemas and types shared by API and web
infra/
  postgres/init/        creates database roles and databases on first start
scripts/                dev-setup.mjs: generates local development settings
docs/                   this documentation
compose.dev.yaml        development PostgreSQL
```

## What exists now

Phase 2 delivers a hardened skeleton with no business data:

- **API** (`apps/api`): validates settings at startup; serves
  `/api/health/live` and `/api/health/ready`; applies security headers,
  `no-store`, JSON-only bodies with a 100 kB limit, request IDs, request
  logging without headers or query strings, and one error format. On startup
  it opens its first database connection before accepting requests, so
  readiness is accurate immediately after a restart.
- **Database**: PostgreSQL 18.6 in Docker for development, with the
  `lexora_owner` (migrations) and `lexora_app` (API) roles and the
  `lexora_dev`, `lexora_test` and `lexora_shadow` databases. One migration
  removes the application role's access to Prisma's migration history.
- **Web** (`apps/web`): the application shell (header, language switcher,
  skip link, footer), a system status page that shows whether the API and
  database respond, a not-found page and an error page, in French and Arabic
  with automatic right-to-left layout. Fonts are served from our own origin.
- **Shared** (`packages/shared`): the health response and error response
  schemas used by both sides.

Phase 3 adds identity and sessions:

- **Data**: tables `app_user`, `session`, `totp_factor`, `recovery_code`,
  `password_token`, `rate_limit_bucket` and `audit_event` (migration
  `identity_and_audit`, with CHECK constraints, an append-only trigger on the
  audit log, and no `DELETE` on users for the app role).
- **API**: `/api/auth/*` (session, login, logout, second factor, enrolment,
  recovery codes, re-authentication, password change and set, sign out
  other devices) and `/api/admin/users/*` (list, create, update, password
  link, second-factor reset, sign out). Middleware order: security headers,
  body checks, health routes, session loading, Origin/CSRF checks, sign-in
  routes, then "fully signed-in session required" for everything else.
- **Web**: sign-in, code, set-password and mandatory second-factor screens,
  a home page, the security page, user administration, and a
  re-authentication dialog that appears whenever the server asks for it and
  then retries the action.
- **CLI**: `npm run admin -w @lexora/api -- create | recover`.

How workspaces find `@lexora/shared`: in development, tests and type
checking, the custom export condition `@lexora/source` (and aliases in the
Vite and Vitest configs) point to its TypeScript source, so no build step is
needed. The production build of the API uses the compiled `dist/`, so
`npm run build` builds `shared` first.

## Request flow in the API

Every protected request follows the same path:

1. **Proxy**: TLS ends at the proxy, which adds security headers and limits
   request size.
2. **Request context**: a random correlation ID is assigned and the session
   cookie is resolved to a user, or rejected.
3. **CSRF check** on every state-changing method.
4. **Validation**: path, query and body are parsed with strict Zod schemas.
   Unknown fields are rejected.
5. **Service**: business logic runs here. It asks the **policy layer**
   whether the current user may perform this action on this exact resource,
   and uses policy query helpers so that lists and searches only return
   accessible records.
6. **Data access**: Prisma, inside a transaction when several writes must
   succeed together.
7. **Audit**: security-relevant actions write an audit event.
8. **Response**: only fields chosen explicitly for the response are returned.
   Errors go through the central handler, which never exposes internals.

Authorization lives in the services and policies, not only in route
middleware, so every code path (HTTP, background job, export) applies the
same rules. See [security.md](security.md#authorization).

## Data model (initial outline)

Refined in Phases 3 to 7.

- `User`, `Session`, `MfaFactor`, `RecoveryCode`, `PasswordResetToken`
- `Client` (person or company), `Party` (opposing parties, other
  participants)
- `Matter` (case file), `MatterMember` (user, role in matter), restriction
  flag
- `Document` (metadata, storage key, hash, detected type, scan status)
- `Hearing`, `Deadline`, `Task`
- `FeeAgreement`, `Invoice`, `InvoiceLine`, `Payment`, `InvoiceCounter`
- `AuditEvent` (append-only for the application)

Records that hold legal or financial history are archived, not hard deleted.
Retention and final deletion follow the periods confirmed in the
[privacy checklist](privacy-checklist.md).

## Environments

| Environment | Where                                      | Data                                                                    |
| ----------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Development | Developer workstation, Docker Desktop      | Synthetic seed data only                                                |
| Test / CI   | Throwaway containers                       | Synthetic data, created and destroyed per run                           |
| Staging     | Isolated machine or VM matching production | Synthetic data only                                                     |
| Production  | Office server                              | Real data, only after the [production gate](roadmap.md#production-gate) |

Each environment has its own database, credentials and secrets.
