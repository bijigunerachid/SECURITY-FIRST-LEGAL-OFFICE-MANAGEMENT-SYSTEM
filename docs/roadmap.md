# Lexora roadmap

Lexora is a legal-office management system for a single law office in Morocco.
It handles client identities, matters, documents, hearings, invoices and
payments. Because this information is confidential and covered by professional
secrecy, every phase is planned around security first.

Related documents:

- [Architecture](architecture.md)
- [Threat model and risk register](threat-model.md)
- [Security design](security.md)
- [Moroccan privacy and legal checklist](privacy-checklist.md)
- [Architecture decision records](decisions/)

## How we work

- One branch per phase (`feature/…`, `fix/…`, `docs/…`), created from an
  up-to-date `main`. The owner reviews, commits, pushes and merges.
- Each phase starts only after the previous one is merged and approved.
- Every phase ships with tests and updated docs, and records the checks that
  were run and their real results in the "Verification" entry below.
- **Real client data is forbidden until the production gate is passed.**
  Until then, only synthetic data from a seed script is used.

## Status

| Phase                                      | Branch                | Status            |
| ------------------------------------------ | --------------------- | ----------------- |
| 0. Repository audit                        | —                     | Done (2026-10-18) |
| 1. Security plan and repository basics     | `docs/security-plan`  | Done (2026-10-18) |
| 2. Foundation                              | `feature/foundation`  | In review         |
| 3. Identity and sessions                   | `feature/auth`        | Not started       |
| 4. Authorization, clients and matters      | `feature/matters`     | Not started       |
| 5. Documents                               | `feature/documents`   | Not started       |
| 6. Hearings, deadlines and background jobs | `feature/calendar`    | Not started       |
| 7. Fees, invoices and payments             | `feature/billing`     | Not started       |
| 8. Audit viewer, alerts and administration | `feature/audit-admin` | Not started       |
| 9. Production readiness                    | `feature/production`  | Not started       |

## Phases

### Phase 0 — Repository audit (done)

Read-only inspection of the repository and the development machine. The
repository and its GitHub remote were both empty, so no existing code,
secrets or controls existed. Findings F1–F7 are recorded in the
[threat model](threat-model.md#findings-from-the-phase-0-audit).

### Phase 1 — Security plan and repository basics

Objective: agree the design before any code exists, and make the repository
safe to commit to.

Deliverables:

- This roadmap, the architecture, threat model, security design, privacy
  checklist and the first architecture decision records.
- `.gitignore` that keeps secrets, dumps, backups and runtime data out of Git
  (fixes audit finding F1), `.gitattributes` (LF line endings for container
  scripts) and `.editorconfig`.
- `README.md`.

Out of scope: application code. The `.env.example` file is added in Phase 2,
together with the startup validation that reads it, so it never lists
settings that nothing uses.

### Phase 2 — Foundation

Objective: a hardened, tested skeleton with no business data.

- npm workspaces: `apps/api`, `apps/web`, `packages/shared`.
- TypeScript strict mode everywhere, ESLint (typescript-eslint strict),
  Prettier.
- Settings loaded from env files and secret files, validated with Zod at
  startup. The process refuses to start on missing or weak settings.
  `.env.example` with placeholders only.
- Express with Helmet, a strict CSP, request body limits, request
  correlation IDs, a central error handler with generic production
  responses, `Cache-Control: no-store` on API responses, Pino logging with
  redaction, and a health endpoint.
- PostgreSQL via Prisma, with two database roles: a migration owner and a
  least-privilege application role.
- Docker Compose for development. PostgreSQL is published on `127.0.0.1`
  only (changed from the plan, which said not published at all: the API and
  tests run on the workstation and must reach it; other machines still
  cannot). Production never publishes it.
- Vitest with a real PostgreSQL test database; Playwright end-to-end tests
  of the production build at desktop and phone widths.
- React app shell with French and Arabic (RTL) localization and an
  accessible layout.
- CI: lint, format check, type check, unit and integration tests, build,
  `npm audit`, secret scanning (gitleaks), Trivy filesystem scan.

### Phase 3 — Identity and sessions

- Users, roles (`admin`, `lawyer`, `assistant`), account disable.
- Command-line provisioning of the first administrator. No setup endpoint
  and no public registration.
- Argon2id password hashing, password policy and offline blocklist.
- Opaque server-side sessions with hashed tokens, idle and absolute
  timeouts, rotation, revocation and "sign out all devices".
- CSRF protection, Origin and Fetch Metadata checks.
- Login rate limiting stored in PostgreSQL.
- TOTP multi-factor authentication, required for administrators, with
  recovery codes. Reauthentication for sensitive operations.
- Admin-initiated password reset with a single-use, expiring token.
- First audit-log events (authentication, sessions, account changes).

### Phase 4 — Authorization, clients and matters

- Central policy module and query-scoping helpers.
- Clients, matters, parties, matter team membership, restricted matters.
- Conflict-of-interest search, limited to the minimum fields needed.
- Full IDOR/BOLA test grid: every role, every endpoint, own versus other
  matter.

### Phase 5 — Documents

- Private document storage, quarantine folder and ClamAV scanning.
- Upload with size limit, file-signature detection and type allowlist.
- Authorized, streamed downloads with safe headers.
- Upload, download, replacement and deletion audit events.

### Phase 6 — Hearings, deadlines and background jobs

- Hearings, deadlines, tasks and reminders.
- Background job runner stored in PostgreSQL (pg-boss), running in a
  separate worker process.

### Phase 7 — Fees, invoices and payments

- Fee agreements, invoices with gap-free numbering, payments, credit notes.
- Transactions and locking for every money operation.
- Exports with permission checks, audit events and CSV formula-injection
  protection.
- Moroccan invoice details to be confirmed through the
  [privacy and legal checklist](privacy-checklist.md).

### Phase 8 — Audit viewer, alerts and administration

- Audit-log viewer for authorized users, with integrity verification.
- Alerts for repeated login failures, repeated authorization failures and
  backup failures.
- User and permission management screens.

### Phase 9 — Production readiness

- Production Docker Compose: non-root containers, read-only filesystems,
  dropped capabilities, resource limits, health checks, images pinned by
  digest.
- Caddy reverse proxy with TLS and HSTS.
- Host hardening guide for the office server, firewall rules including the
  `DOCKER-USER` chain, and a port scan to prove them.
- Encrypted backups with restic, a tested restore and runbooks for a stolen
  server, compromised credentials, ransomware and accidental deletion.
- OWASP ZAP baseline scan and Trivy image scan in a staging environment.
- `CONTRIBUTING.md` and the project hand-off.

## Production gate

Real client data may be entered only when all of the following are true and
recorded here with evidence:

1. Every Critical and High risk in the [risk register](threat-model.md#risk-register)
   is mitigated and its test passes, or the owner has accepted it in writing.
2. A full restore from backup into an isolated environment has succeeded.
3. A port scan from the office network and from outside shows only the
   intended HTTPS entry point.
4. Administrator accounts have MFA enabled.
5. The [privacy and legal checklist](privacy-checklist.md) has been reviewed
   and signed off by the lawyer or a qualified Moroccan privacy professional.

## Open decisions

These decisions belong to the office. Until they are confirmed, the
recommended default is used and noted as provisional in the design documents.

| #   | Question                                | Provisional default                                                                  |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| D1  | Number of users and server hardware     | Dedicated machine running Ubuntu Server 24.04 LTS                                    |
| D2  | Can administrators read matter content? | No. Logged "break-glass" access only                                                 |
| D3  | Password reset channel                  | Admin-initiated, token given in person. No email service                             |
| D4  | MFA scope                               | Required for administrators; strongly recommended for everyone                       |
| D5  | TLS certificate                         | Office-owned domain with a Let's Encrypt DNS-01 certificate; internal CA as fallback |
| D6  | Off-site backup                         | Two rotated, encrypted USB drives, one kept off-site. No cloud copy                  |
| D7  | Recovery targets and session timeouts   | RPO 24 h, RTO 1 working day; 30 min idle, 10 h absolute                              |
| D8  | Document types and size                 | PDF, DOCX, XLSX, ODT, JPEG, PNG; 25 MB per file                                      |
| D9  | GitHub repository visibility            | Private                                                                              |

## Verification log

### Phase 2 — Foundation

Checks run on 2026-10-18 on Windows 11 with Node.js 22.14.0 and Docker
Desktop (PostgreSQL 18.6). CI runs the same checks on Node.js 24; CI has not
run yet because nothing has been pushed.

| Check                                        | Result                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run lint` (ESLint, 0 warnings)          | Pass                                                                                                  |
| `npm run format:check`                       | Pass                                                                                                  |
| `npm run typecheck` (3 workspaces)           | Pass                                                                                                  |
| Unit tests                                   | 63 passed (shared 3, API 41, web 19)                                                                  |
| Integration tests (real PostgreSQL)          | 9 passed                                                                                              |
| `npm run build`                              | Pass; largest chunk 319 kB (React), our code 11.6 kB                                                  |
| End-to-end (Playwright, 1366 px, 390 px)     | 21 passed, 1 skipped by design (keyboard test on desktop only)                                        |
| End-to-end stability                         | 5 of 5 consecutive build-and-test cycles passed after the fix below                                   |
| `npm audit` (all dependencies)               | 0 vulnerabilities                                                                                     |
| Trivy 0.75.0 (vuln, secret, misconfig)       | 0 findings, development dependencies included                                                         |
| gitleaks 8.30.1 (files to commit)            | No leaks in 93 files; the project rule found all 3 passwords in a copy of the real development `.env` |
| gitleaks 8.30.1 (Git history)                | No leaks                                                                                              |
| Manual: API with unsafe settings             | Refused to start, naming 3 problems, no values shown                                                  |
| Screenshots (French and Arabic, both widths) | Reviewed; one layout fix (below)                                                                      |

Controls proven by breaking them (each test failed, then the code was
restored):

| Control broken on purpose                         | Caught by                                                   |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `Cache-Control: no-store` removed                 | API unit tests                                              |
| Token redaction removed from the logger           | API unit tests                                              |
| JSON-only request bodies disabled                 | API unit tests                                              |
| Superuser `DATABASE_URL` check disabled           | API unit tests                                              |
| Query string written to request logs              | API unit tests                                              |
| Validation and HTTP errors leak internal messages | API unit tests (after the test was strengthened, see below) |
| Web client trusts unvalidated responses           | Web unit tests                                              |
| App role granted read access to migration history | Integration tests                                           |
| `unsafe-inline` added to the web CSP              | End-to-end tests                                            |
| `$queryRawUnsafe` and `dangerouslySetInnerHTML`   | ESLint                                                      |

Problems found and fixed during this phase:

- **Cold-start readiness bug.** In a fresh process the first database query
  sometimes took over a second; under load it exceeded the 2-second
  readiness timeout, so the status page wrongly showed the database as
  unavailable after a restart (2 of 3 early end-to-end runs failed). The API
  now opens its first connection before accepting requests, and the
  end-to-end tests wait for readiness.
- **Weak test.** Making error responses include internal messages did not
  fail any test. Every error response is now checked against the strict
  shared schema.
- **Secret scanner gap.** gitleaks's default rules miss passwords in
  PostgreSQL connection strings. A project rule was added and proven.
- **Duplicate React and Vite.** npm installed peer dependencies at their
  newest versions, giving two copies of React and Vite and breaking the
  14-day rule. Fixed with `overrides` and a full reinstall using `--before`.
- **Vulnerable Prisma dependencies.** Prisma 7.10.0 pulled in packages with
  High advisories; upgraded to 7.10.1 (documented exception to the cooldown).
- **Phone header.** At 390 px in French the language switcher wrapped onto a
  second line; the tagline is now hidden on phones.
- **Build warning.** A 525 kB bundle; split into cached vendor chunks.
- **Broken migration command.** Creating a new migration failed because the
  baseline migration referenced Prisma's history table, which does not exist
  in the shadow database. The migration now checks for the table first, and
  `db:migrate:create` requires a name so it never waits at a prompt.

**First CI run (2026-10-18).** The lint, type, unit test, build and audit job
and the security scan job passed on Node.js 24. The integration job failed:
the database started without its roles on Linux (finding F13 in the threat
model). Reproduced locally with a throwaway container that mimics Linux file
ownership, fixed, and each part verified: the new health check reports the
broken database as unhealthy where `pg_isready` reported it healthy; old
file permissions now stop with a clear message; new permissions create all
roles and databases and allow login; `setup:dev` produces folder 700,
secrets 644 and env files 600 even with umask 077. End-to-end tests have not
run in CI yet (they were skipped after the failure).

Not verified in this phase: a passing CI run of the integration and end-to-end job, and
the Node.js 24 runtime locally (the workstation still has 22.14.0).

### Phase 1 — Security plan and repository basics

Documentation only, so there is no lint, test, build or dependency audit to
run yet. Checks performed on 2026-10-18:

- `git check-ignore` on 28 sample paths: all 19 sensitive paths (env files,
  keys, certificates, SQL dumps, backups, document and database folders,
  `CLAUDE.md`) are ignored; all 9 paths that must be committed
  (`.env.example` files, `secrets/README.md`, Prisma `migration.sql`, source
  folders named `storage` and `uploads`) are tracked.
- The same check against the first draft of `.gitignore` failed on 3 paths
  (it would have hidden Prisma migrations and source folders). This proved
  the check catches the problem; the patterns were fixed.
- `git add --dry-run .` listed exactly the 17 intended files; nothing was
  staged.
- No file contains CRLF line endings.
- Link check: 47 relative links (including heading anchors) in the README
  and `docs/`, 0 broken.
