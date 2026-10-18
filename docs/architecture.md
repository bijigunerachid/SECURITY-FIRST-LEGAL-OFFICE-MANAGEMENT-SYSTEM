# Architecture

Status: **target design**. No application code exists yet. Each phase updates
this document to describe what was actually built.

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

| Area | Choice |
|---|---|
| Runtime | Node.js, current Active LTS line (24.x at time of writing) |
| Language | TypeScript, strict mode |
| Web | React, Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form, Zod |
| Localization | French and Arabic, with right-to-left layout for Arabic |
| API | Express with Helmet, Zod validation, central error handling |
| Database | PostgreSQL (a currently supported major version) with Prisma |
| Logging | Pino, structured JSON, with a redaction list |
| Background jobs | pg-boss, stored in PostgreSQL |
| Rate limiting and sessions | Stored in PostgreSQL. No Redis ([ADR 0005](decisions/0005-postgresql-for-sessions-limits-jobs.md)) |
| Malware scanning | ClamAV (clamd) on the internal network |
| Reverse proxy and TLS | Caddy |
| Deployment | Docker Compose on Docker Engine, Linux host ([ADR 0006](decisions/0006-deployment-host.md)) |
| Backups | restic, encrypted ([ADR 0007](decisions/0007-backups.md)) |
| Tests | Vitest, Supertest, real PostgreSQL, Playwright |

## Repository layout (planned)

```
apps/
  api/              Express API and background worker
    prisma/         schema and reviewed migrations
    src/
      config/       settings loading and validation
      http/         app setup, middleware, error handling
      modules/      one folder per business area (auth, clients, matters,
                    documents, calendar, billing, audit, admin)
      policies/     authorization rules and query scoping
      lib/          shared helpers (crypto, logging)
  web/              React application
packages/
  shared/           Zod schemas and types shared by API and web
docs/               this documentation
infra/              Compose files, Caddy config, host hardening, backup scripts
```

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

| Environment | Where | Data |
|---|---|---|
| Development | Developer workstation, Docker Desktop | Synthetic seed data only |
| Test / CI | Throwaway containers | Synthetic data, created and destroyed per run |
| Staging | Isolated machine or VM matching production | Synthetic data only |
| Production | Office server | Real data, only after the [production gate](roadmap.md#production-gate) |

Each environment has its own database, credentials and secrets.
