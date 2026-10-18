# Security design

Status: **design, Phase 1**. Every control below is **planned**. The
"Status" column is updated to *Implemented* only when the code exists, and
to *Verified* only when its test has been run and the result recorded in the
[roadmap verification log](roadmap.md#verification-log).

This document does not claim certification or legal compliance. It follows
guidance from OWASP ASVS, the OWASP Top 10 and the OWASP API Security Top 10.
Version-specific guidance is checked again when each control is built.

Related: [threat model](threat-model.md), [architecture](architecture.md),
[privacy checklist](privacy-checklist.md).

## Reporting a security problem

Report suspected vulnerabilities privately to the repository owner. Do not
open a public issue, and never include real client data in a report.

## Identity and authentication

| Control | Design | Phase | Status |
|---|---|---|---|
| No public registration | Accounts are created only by an administrator | 3 | Planned |
| First administrator | Created with a command-line tool run on the server, which asks for the password interactively. No web setup endpoint exists | 3 | Planned |
| Password hashing | Argon2id. Starting point is the OWASP minimum (19 MiB memory, 2 iterations, 1 lane), raised and tuned to about 300 ms on the real server. Parameters are stored with each hash so they can be raised later | 3 | Planned |
| Password policy | 15 to 128 characters, any characters allowed, no forced composition rules (NIST SP 800-63B-4). Rejected if found in an offline list of common and breached passwords. No external service is contacted | 3 | Planned |
| Login errors | One generic message for unknown account, wrong password and disabled account. Similar response time in each case | 3 | Planned |
| Rate limiting | Per IP and per account, progressive delays, temporary lockout. Stored in PostgreSQL so limits survive restarts | 3 | Planned |
| MFA | TOTP, required for administrators (decision D4). Ten single-use recovery codes, stored hashed. TOTP secrets encrypted with AES-256-GCM using a key held outside the database | 3 | Planned |
| Reauthentication | Password (and MFA where enrolled) asked again for role changes, MFA reset, account disable, exports and break-glass access | 3 | Planned |
| Password reset | Admin-initiated (decision D3). Produces a single-use token valid 30 minutes, shown once and handed over in person. Only its SHA-256 hash is stored. Using it revokes all the user's sessions | 3 | Planned |

## Sessions

See [ADR 0002](decisions/0002-server-side-sessions.md).

| Control | Design | Phase | Status |
|---|---|---|---|
| Token | 32 bytes from the operating system's secure random generator, sent only in a cookie | 3 | Planned |
| Storage | Only a SHA-256 hash of the token is stored. A copy of the database contains no usable sessions | 3 | Planned |
| Cookie | `__Host-lexora_session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain` | 3 | Planned |
| Lifetime | 30 minutes idle, 10 hours absolute (decision D7) | 3 | Planned |
| Rotation | New token at login, after MFA and after any privilege change. Prevents session fixation | 3 | Planned |
| Revocation | Server-side. All sessions revoked on password change, reset, account disable or role change. "Sign out all devices" for each user | 3 | Planned |
| Browser storage | No tokens or confidential data in `localStorage`, `sessionStorage` or IndexedDB | 2–8 | Planned |

## CSRF

The web app and API share one origin, and sessions use a cookie, so CSRF
protection is required:

- `SameSite=Strict` on the session cookie.
- A random CSRF token tied to the session, sent in a request header on every
  `POST`, `PUT`, `PATCH` and `DELETE`, compared in constant time.
- Requests are rejected when the `Origin` header is not the application's
  own origin, or when `Sec-Fetch-Site` is present and is not `same-origin`.
- No state changes on `GET`.

## Authorization

See [ADR 0003](decisions/0003-authorization-model.md).

Principles: deny by default, least privilege, checked on the server for every
operation, on the exact resource and its parents.

**Roles** set the kinds of action a user can take. **Matter membership**
decides which records they can take them on.

| Role | Can do | Cannot do by default |
|---|---|---|
| `admin` | Manage users, roles, settings, view the audit log, run backups checks | Read matter content (decision D2). Break-glass access is possible after reauthentication, requires a written reason, is time-limited and creates a high-priority audit event |
| `lawyer` | Create matters; read and edit matters they belong to; manage the matter team when they are the lead lawyer; run conflict searches | Access matters they are not a member of |
| `assistant` | Work on matters they belong to: documents, hearings, tasks, invoice drafts | Delete matters, change matter teams, issue or cancel invoices, export |

Rules:

- A client is visible to a user who is a member of at least one of the
  client's matters. Conflict searches return only the minimum fields needed
  to detect a conflict.
- A matter can be **restricted**. Only its listed members can see it, even
  through search and reports.
- Every endpoint with an ID loads the record through the policy layer, which
  checks the record and its parents (document → matter → client).
- Lists, search, exports and reports use the same query-scoping helpers, so
  they return only accessible records.
- Inaccessible records return **404**, so their existence is not revealed.
- Writable fields are listed explicitly in each Zod schema. Unknown fields
  are rejected. Owner, role and matter IDs are never taken from the body
  where the server can derive them.
- The same policy functions are used by HTTP handlers, background jobs and
  exports.

PostgreSQL row-level security is postponed. The reasons are in ADR 0003.

## API and application security

| Control | Design | Phase |
|---|---|---|
| Input validation | Zod schemas for path, query, body and relevant headers, in strict mode | 2 |
| SQL | Prisma only. Any raw query uses parameters, is listed in this document and is reviewed | 2 |
| Security headers | Helmet; strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`, `object-src 'none'`); `Referrer-Policy: no-referrer`; HSTS at the proxy | 2, 9 |
| CORS | Not enabled. The app is same-origin; cross-origin requests are not allowed | 2 |
| Body limits | Small JSON limit (100 kB); uploads have their own limit | 2, 5 |
| Errors | Central handler. Production responses contain a generic message and the correlation ID only. No stack traces, SQL or record contents | 2 |
| Correlation IDs | Random UUID per request, returned in a response header, logged | 2 |
| Caching | `Cache-Control: no-store` on all API responses and downloads | 2 |
| HTTP methods | Only the methods each route needs; correct status codes | 2 |
| Redirects | Only to allowlisted internal paths | 3 |
| Outbound requests | The API does not fetch user-supplied URLs (no SSRF surface) | — |

## Database security

| Control | Design | Phase |
|---|---|---|
| Roles | `lexora_owner` owns the schema and runs migrations in a one-off container. `lexora_app` has only `SELECT`, `INSERT`, `UPDATE`, `DELETE` on application tables and no rights to change the schema. Neither is a superuser | 2 |
| Audit table rights | `lexora_app` has only `INSERT` and `SELECT` on `audit_event` | 3 |
| Network | PostgreSQL is reachable only on the internal Docker network and is never published on the host | 2 |
| Separation | Separate databases and credentials for development, test, staging and production | 2, 9 |
| Integrity | Foreign keys, `CHECK` constraints, unique constraints, indexes; transactions for multi-step writes | 2–7 |
| Money | Integer amounts in centimes; invoice numbers from a locked counter row inside the same transaction, so numbers have no gaps | 7 |
| Migrations | Created in development, reviewed in pull requests, applied with `prisma migrate deploy`. `migrate reset` and `db push` are never used against staging or production | 2 |

## Document storage

See [ADR 0004](decisions/0004-document-storage.md).

- Private volume outside any web root, mounted only in the API and worker
  containers.
- Files stored under random UUID names with no extension. The original name
  is cleaned and kept only as metadata.
- Size limit 25 MB per file (decision D8), enforced while streaming.
- Allowed types: PDF, DOCX, XLSX, ODT, JPEG, PNG. The type is detected from
  the file's own bytes; the file name and the browser's MIME type are not
  trusted. Macro-enabled Office formats are rejected.
- New files go to a quarantine folder, are scanned by ClamAV, and are moved
  to storage only when clean. Infected or unscannable files are rejected and
  logged.
- Partial and failed uploads are deleted.
- Every download is authorized, then streamed with
  `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox; default-src 'none'` and
  `Cache-Control: no-store`.
- No public, guessable or permanent links.
- Upload, download, replacement and deletion create audit events.

## Encryption and secrets

| What | Protected by | Key location | What it does not protect against |
|---|---|---|---|
| Network traffic | TLS at the Caddy proxy, HSTS | Certificate key on the server | A compromised server or proxy |
| Server disks | Full-disk encryption (LUKS) | Passphrase or TPM unlock, decided at installation | Anyone with access to the running server |
| MFA secrets, recovery material | AES-256-GCM in the application | Docker secret file outside the database and the backups | A compromised running API |
| Session and reset tokens | Stored only as SHA-256 hashes | — | Theft of a token from a user's browser |
| Passwords | Argon2id | — | Weak passwords allowed by an outdated blocklist |
| Backups | restic encryption | Kept apart from the media (see [ADR 0007](decisions/0007-backups.md)) | Loss of the key, which makes backups unrecoverable |

Other database fields are **not** encrypted by the application. This is a
deliberate choice: field encryption would block searching and sorting and
add key-recovery risk, and it would not protect against a compromised API,
which holds the key. Revisit if the office identifies specific fields that
need it.

Secret handling:

- No secrets in code, images, build logs, chat or Git.
- Settings come from env files ignored by Git, and secrets from files
  mounted by Docker. Both are validated at startup.
- `.env.example` files contain placeholders only.
- Secret scanning (gitleaks) runs in CI.
- Any secret suspected of exposure is rotated.
- No custom cryptography. Only Node's `crypto` module and maintained
  libraries.

## Audit logging

- Events: login success and failure, logout, session revocation, MFA changes,
  account and role changes, break-glass access, document upload, download,
  replacement and deletion, exports, changes to matters, hearings, invoices
  and payments, configuration changes, backup and restore results.
- Each event stores: time, actor ID, action, target type and ID, outcome,
  correlation ID, and the client IP. Never passwords, tokens, secrets or
  document contents.
- The application role can only add and read audit rows. Each row includes a
  hash of the previous row, so changes can be detected. The latest hash is
  copied with each backup.
- Only administrators can read the audit log, through the audit viewer.
- This makes the log **tamper-evident** against the application, not
  tamper-proof against someone with database owner or root access.

## Logging

- Pino, structured JSON, to standard output. Docker log rotation limits size.
- Redacted: `authorization`, `cookie`, `set-cookie`, any field named like
  `password`, `token`, `secret`, `code`, `totp`.
- Request bodies, query strings with personal data, and document names are
  not logged.

## Supply chain

- Dependencies pinned to exact versions, with a committed lockfile.
- New dependencies are checked for maintenance and advisories before
  installation.
- `npm audit`, gitleaks and Trivy run in CI. Base images are pinned by digest.
- The GitHub account uses MFA, and the repository is private (decision D9).

## Known limits

See [residual risks](threat-model.md#residual-risks-accepted-by-design).
