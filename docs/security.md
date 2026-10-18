# Security design

Status: **Phase 2 (foundation) implemented**. Controls built so far are
marked _Verified_: the code exists, its test has been run, and a deliberate
break of the control made that test fail (see the
[roadmap verification log](roadmap.md#verification-log)). Everything else is
still _Planned_.

This document does not claim certification or legal compliance. It follows
guidance from OWASP ASVS, the OWASP Top 10 and the OWASP API Security Top 10.
Version-specific guidance is checked again when each control is built.

Related: [threat model](threat-model.md), [architecture](architecture.md),
[privacy checklist](privacy-checklist.md).

## Reporting a security problem

Report suspected vulnerabilities privately to the repository owner. Do not
open a public issue, and never include real client data in a report.

## Identity and authentication

| Control                | Design                                                                                                                                                                                                     | Phase | Status  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------- |
| No public registration | Accounts are created only by an administrator                                                                                                                                                              | 3     | Planned |
| First administrator    | Created with a command-line tool run on the server, which asks for the password interactively. No web setup endpoint exists                                                                                | 3     | Planned |
| Password hashing       | Argon2id. Starting point is the OWASP minimum (19 MiB memory, 2 iterations, 1 lane), raised and tuned to about 300 ms on the real server. Parameters are stored with each hash so they can be raised later | 3     | Planned |
| Password policy        | 15 to 128 characters, any characters allowed, no forced composition rules (NIST SP 800-63B-4). Rejected if found in an offline list of common and breached passwords. No external service is contacted     | 3     | Planned |
| Login errors           | One generic message for unknown account, wrong password and disabled account. Similar response time in each case                                                                                           | 3     | Planned |
| Rate limiting          | Per IP and per account, progressive delays, temporary lockout. Stored in PostgreSQL so limits survive restarts                                                                                             | 3     | Planned |
| MFA                    | TOTP, required for administrators (decision D4). Ten single-use recovery codes, stored hashed. TOTP secrets encrypted with AES-256-GCM using a key held outside the database                               | 3     | Planned |
| Reauthentication       | Password (and MFA where enrolled) asked again for role changes, MFA reset, account disable, exports and break-glass access                                                                                 | 3     | Planned |
| Password reset         | Admin-initiated (decision D3). Produces a single-use token valid 30 minutes, shown once and handed over in person. Only its SHA-256 hash is stored. Using it revokes all the user's sessions               | 3     | Planned |

## Sessions

See [ADR 0002](decisions/0002-server-side-sessions.md).

| Control         | Design                                                                                                                                                                                            | Phase | Status                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------- |
| Token           | 32 bytes from the operating system's secure random generator, sent only in a cookie                                                                                                               | 3     | Planned                    |
| Storage         | Only a SHA-256 hash of the token is stored. A copy of the database contains no usable sessions                                                                                                    | 3     | Planned                    |
| Cookie          | `__Host-lexora_session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`                                                                                                           | 3     | Planned                    |
| Lifetime        | 30 minutes idle, 10 hours absolute (decision D7)                                                                                                                                                  | 3     | Planned                    |
| Rotation        | New token at login, after MFA and after any privilege change. Prevents session fixation                                                                                                           | 3     | Planned                    |
| Revocation      | Server-side. All sessions revoked on password change, reset, account disable or role change. "Sign out all devices" for each user                                                                 | 3     | Planned                    |
| Browser storage | No tokens or confidential data in `localStorage`, `sessionStorage` or IndexedDB. Today `localStorage` holds only the language preference (`lexora.language`), and ESLint forbids `sessionStorage` | 2–8   | Implemented (Phase 2 part) |

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

| Role        | Can do                                                                                                                            | Cannot do by default                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`     | Manage users, roles, settings, view the audit log, run backups checks                                                             | Read matter content (decision D2). Break-glass access is possible after reauthentication, requires a written reason, is time-limited and creates a high-priority audit event |
| `lawyer`    | Create matters; read and edit matters they belong to; manage the matter team when they are the lead lawyer; run conflict searches | Access matters they are not a member of                                                                                                                                      |
| `assistant` | Work on matters they belong to: documents, hearings, tasks, invoice drafts                                                        | Delete matters, change matter teams, issue or cancel invoices, export                                                                                                        |

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

| Control              | Design                                                                                                                                                                                                                                          | Phase | Status                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------- |
| Startup settings     | All settings validated with Zod before the API starts. Refuses superuser or owner database roles, short production passwords, and debug logging in production. Error messages name the setting, never its value. Secrets can come from `*_FILE` | 2     | Verified                          |
| Input validation     | Zod schemas for path, query, body and relevant headers, in strict mode. The error handler turns validation failures into field paths and issue codes, never submitted values                                                                    | 2     | Verified (handler); routes from 3 |
| Body type            | `POST`/`PUT`/`PATCH`/`DELETE` bodies must be `application/json` (415 otherwise). Forms from other sites cannot send JSON without a CORS preflight, which narrows CSRF                                                                           | 2     | Verified                          |
| SQL                  | Prisma only. Any raw query uses the `$queryRaw` tagged template (parameterized), is listed in this document and is reviewed. ESLint forbids `$queryRawUnsafe` and `$executeRawUnsafe`                                                           | 2     | Verified                          |
| Raw queries in use   | `SELECT 1` in the readiness probe (`apps/api/src/lib/database.ts`); no user input                                                                                                                                                               | 2     | Reviewed                          |
| API security headers | Helmet. API CSP: `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CORP/COOP same-origin, HSTS. No `X-Powered-By`                          | 2     | Verified                          |
| Web security headers | `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'` and related headers, without `unsafe-inline` or `unsafe-eval`. Sent by `vite preview` today and by the Caddy proxy in Phase 9              | 2, 9  | Verified (preview)                |
| CORS                 | Not enabled. The app is same-origin; cross-origin requests get no `Access-Control-Allow-*` headers                                                                                                                                              | 2     | Verified                          |
| Body limits          | JSON limit 100 kB (413 above it); uploads will have their own limit                                                                                                                                                                             | 2, 5  | Verified                          |
| Errors               | Central handler. Every error response matches one strict shared schema: a code and the request ID. No messages, stack traces, SQL or record contents                                                                                            | 2     | Verified                          |
| Correlation IDs      | Fresh random UUID per request, generated by the server (a client-sent ID is ignored), returned in `X-Request-Id` and logged                                                                                                                     | 2     | Verified                          |
| Caching              | `Cache-Control: no-store` on every API response, including errors                                                                                                                                                                               | 2     | Verified                          |
| Slow clients         | Header timeout 15 s, request timeout 30 s, keep-alive 5 s                                                                                                                                                                                       | 2     | Implemented                       |
| Health endpoints     | `/api/health/live` and `/api/health/ready` reveal only `ok`/`unavailable`: no versions, hosts or error text                                                                                                                                     | 2     | Verified                          |
| Browser API client   | Same-origin `fetch` with `credentials: "same-origin"`, a timeout, and Zod validation of every response; an unexpected shape is treated as an error                                                                                              | 2     | Verified                          |
| HTTP methods         | Only the methods each route needs; correct status codes                                                                                                                                                                                         | 2     | Implemented                       |
| Redirects            | Only to allowlisted internal paths                                                                                                                                                                                                              | 3     | Planned                           |
| Outbound requests    | The API does not fetch user-supplied URLs (no SSRF surface)                                                                                                                                                                                     | —     | —                                 |
| Raw HTML             | ESLint forbids `dangerouslySetInnerHTML` and `innerHTML`; translations are rendered as text                                                                                                                                                     | 2     | Verified                          |

## Database security

| Control            | Design                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Phase |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Roles              | `lexora_owner` owns the databases and schema and is used only by migration commands. `lexora_app`, used by the API, has only `SELECT`, `INSERT`, `UPDATE`, `DELETE` on tables the owner creates. Neither is a superuser, can create roles or databases, or bypasses RLS. Verified: the app role cannot create tables, schemas, functions, roles or databases, read server files, run programs, read `_prisma_migrations`, or connect to databases it was not granted | 2     |
| Time limits        | `lexora_app` has `statement_timeout = 30s` and `idle_in_transaction_session_timeout = 60s` (verified)                                                                                                                                                                                                                                                                                                                                                                | 2     |
| Audit table rights | `lexora_app` has only `INSERT` and `SELECT` on `audit_event`                                                                                                                                                                                                                                                                                                                                                                                                         | 3     |
| Network            | Production: reachable only on the internal Docker network, never published (Phase 9). Development: published on `127.0.0.1` only, so tools on the workstation can reach it but other machines on the network cannot                                                                                                                                                                                                                                                  | 2, 9  |
| Separation         | Separate databases and credentials for development, test, staging and production                                                                                                                                                                                                                                                                                                                                                                                     | 2, 9  |
| Integrity          | Foreign keys, `CHECK` constraints, unique constraints, indexes; transactions for multi-step writes                                                                                                                                                                                                                                                                                                                                                                   | 2–7   |
| Money              | Integer amounts in centimes; invoice numbers from a locked counter row inside the same transaction, so numbers have no gaps                                                                                                                                                                                                                                                                                                                                          | 7     |
| Migrations         | Created in development, reviewed in pull requests, applied with `prisma migrate deploy`. `migrate reset` and `db push` are never used against staging or production                                                                                                                                                                                                                                                                                                  | 2     |

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

| What                           | Protected by                   | Key location                                                          | What it does not protect against                   |
| ------------------------------ | ------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------- |
| Network traffic                | TLS at the Caddy proxy, HSTS   | Certificate key on the server                                         | A compromised server or proxy                      |
| Server disks                   | Full-disk encryption (LUKS)    | Passphrase or TPM unlock, decided at installation                     | Anyone with access to the running server           |
| MFA secrets, recovery material | AES-256-GCM in the application | Docker secret file outside the database and the backups               | A compromised running API                          |
| Session and reset tokens       | Stored only as SHA-256 hashes  | —                                                                     | Theft of a token from a user's browser             |
| Passwords                      | Argon2id                       | —                                                                     | Weak passwords allowed by an outdated blocklist    |
| Backups                        | restic encryption              | Kept apart from the media (see [ADR 0007](decisions/0007-backups.md)) | Loss of the key, which makes backups unrecoverable |

Other database fields are **not** encrypted by the application. This is a
deliberate choice: field encryption would block searching and sorting and
add key-recovery risk, and it would not protect against a compromised API,
which holds the key. Revisit if the office identifies specific fields that
need it.

Secret handling:

- No secrets in code, images, build logs, chat or Git.
- Settings come from env files ignored by Git, and secrets from files
  mounted by Docker (`DATABASE_URL_FILE`). Both are validated at startup.
- `.env.example` files contain placeholders only.
- Development secrets are random 32-byte values generated by
  `npm run setup:dev`, which never overwrites or prints them.
- Secret scanning (gitleaks) runs in CI over the whole Git history. The
  project adds a rule for passwords inside PostgreSQL connection strings,
  which the default rules miss. Test fixtures must contain `test-only` in
  any fake password.
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
- Request log lines contain only the request ID, method, path (without query
  string), status and duration. Headers, query strings and bodies are never
  logged (verified).
- Redacted as a second line of defence: `authorization`, `cookie`,
  `set-cookie`, `x-csrf-token`, `databaseUrl`, and fields named `password`,
  `token`, `secret`, `code`, `totp`, at the top level and one level deep
  (verified).
- Document names are not logged.

## Supply chain

- **Exact versions** for every direct dependency (`save-exact`), with a
  committed lockfile. CI installs with `npm ci`.
- **14-day cooldown.** New releases are not installed until they are at
  least 14 days old, so hijacked or broken releases have time to be caught.
  The whole tree, including transitive dependencies, is resolved with
  `npm install --before=<date>`.
- **Exceptions** to the cooldown need a written reason here. Current one:
  Prisma 7.10.1 (released 2026-10-15), because 7.10.0 pulled in
  `deepmerge-ts` and `mysql2` versions with High advisories.
- **One copy of each core package.** npm installs missing peer dependencies
  at their newest version; `overrides` in `package.json` pin `react`,
  `react-dom`, `vite` and `playwright-core` so only one copy exists.
- **No install scripts.** `.npmrc` sets `ignore-scripts=true`; the steps that
  need generation (Prisma client, Playwright browsers) are explicit commands.
- **`engine-strict`** refuses packages that do not support our Node.js version.
- New dependencies are checked for maintenance and advisories before
  installation.
- `npm audit`, gitleaks and Trivy (including development dependencies) run
  in CI. Docker images are pinned by digest. GitHub Actions are pinned to
  full commit SHAs, and the workflow token is read-only.
- The GitHub account uses MFA, and the repository is private (decision D9).

## Known limits

See [residual risks](threat-model.md#residual-risks-accepted-by-design).
