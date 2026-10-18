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

| Phase | Branch | Status |
|---|---|---|
| 0. Repository audit | — | Done (2026-10-18) |
| 1. Security plan and repository basics | `docs/security-plan` | In review |
| 2. Foundation | `feature/foundation` | Not started |
| 3. Identity and sessions | `feature/auth` | Not started |
| 4. Authorization, clients and matters | `feature/matters` | Not started |
| 5. Documents | `feature/documents` | Not started |
| 6. Hearings, deadlines and background jobs | `feature/calendar` | Not started |
| 7. Fees, invoices and payments | `feature/billing` | Not started |
| 8. Audit viewer, alerts and administration | `feature/audit-admin` | Not started |
| 9. Production readiness | `feature/production` | Not started |

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
- Docker Compose for development. PostgreSQL is not published on the host.
- Vitest with a real PostgreSQL test database; Playwright smoke test.
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

| # | Question | Provisional default |
|---|---|---|
| D1 | Number of users and server hardware | Dedicated machine running Ubuntu Server 24.04 LTS |
| D2 | Can administrators read matter content? | No. Logged "break-glass" access only |
| D3 | Password reset channel | Admin-initiated, token given in person. No email service |
| D4 | MFA scope | Required for administrators; strongly recommended for everyone |
| D5 | TLS certificate | Office-owned domain with a Let's Encrypt DNS-01 certificate; internal CA as fallback |
| D6 | Off-site backup | Two rotated, encrypted USB drives, one kept off-site. No cloud copy |
| D7 | Recovery targets and session timeouts | RPO 24 h, RTO 1 working day; 30 min idle, 10 h absolute |
| D8 | Document types and size | PDF, DOCX, XLSX, ODT, JPEG, PNG; 25 MB per file |
| D9 | GitHub repository visibility | Private |

## Verification log

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
