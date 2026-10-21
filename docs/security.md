# Security design

Status: **Phase 3 (identity and sessions) implemented**. Controls built so
far are marked _Verified_: the code exists, its test has been run, and a
deliberate break of the control made a test fail (see the
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

| Control                | Design                                                                                                                                                                                                                                                                                                                                                                                                            | Status   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| No public registration | Accounts are created only by an administrator (`POST /api/admin/users`) or by the server command-line tool                                                                                                                                                                                                                                                                                                        | Verified |
| First administrator    | `npm run admin -w @lexora/api -- create` on the server. **Changed from the plan:** instead of typing a password into the terminal, it prints a single-use link (30 minutes) to set the password in the browser, so the password never passes through terminal history, and the normal password policy applies. Refuses when an active administrator exists. No web setup endpoint exists                          | Verified |
| Administrator recovery | `npm run admin -w @lexora/api -- recover --email …` on the server: removes the second factor, signs the person out everywhere, issues a new link, and writes an audit event. Requires server access                                                                                                                                                                                                               | Verified |
| Password hashing       | Argon2id, 64 MiB, 3 iterations, 1 lane by default (about 90 ms on the development machine; tune on the server in Phase 9). The API refuses settings below the OWASP minimum (19 MiB, 2 iterations) in every environment. Hashes made with weaker settings are upgraded at the next sign-in                                                                                                                        | Verified |
| Password policy        | 15 to 128 characters (counted as Unicode code points), any characters, no composition rules (NIST SP 800-63B-4). Rejected if the lowercased password is in a list of 122,630 breached passwords of 15+ characters (offline, see `apps/api/data/README.md`), contains the user's name, e-mail or "lexora", or is trivially repetitive                                                                              | Verified |
| Login errors           | One answer (`invalid_credentials`) for unknown account, wrong password, disabled account and account without a password yet. Unknown accounts are checked against a dummy Argon2id hash so the response time is similar                                                                                                                                                                                           | Verified |
| Rate limiting          | Stored in PostgreSQL, one atomic statement per event. Login: 30 attempts per IP and 10 failures per account (keyed by a hash of the e-mail, existing or not) per 15 minutes; second factor: 5 failures per user; re-authentication: 5 failures per user; password links: 20 attempts per IP. Answers `429` with `Retry-After`. **Changed from the plan:** fixed windows rather than progressive delays            | Verified |
| Second factor (TOTP)   | RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step). Required for administrators: they can do nothing else until it is set up, and cannot turn it off. Optional for others. Each code is accepted once (the last used time step is stored and checked atomically). Secrets encrypted with AES-256-GCM, bound to the user by associated data, key outside the database (`MFA_ENCRYPTION_KEY`, with `_PREVIOUS` for rotation) | Verified |
| Recovery codes         | Ten single-use codes (about 74 bits each), shown once, stored as SHA-256 hashes                                                                                                                                                                                                                                                                                                                                   | Verified |
| Re-authentication      | Password, plus a code when a second factor is enrolled, valid 5 minutes. Required for every user-administration change, regenerating recovery codes, turning off the second factor, and setting one up from the security page                                                                                                                                                                                     | Verified |
| Password links         | Admin-initiated (decision D3) or from the CLI. Single-use, 30 minutes, only the SHA-256 hash stored, older unused links invalidated when a new one is issued. The token travels in the URL fragment (`#token=`), which browsers never send to servers or in `Referer`, and the page removes it from the address bar. A rejected password does not use up the link. Using it signs the user out everywhere         | Verified |
| User administration    | Administrators cannot change their own role or disable themselves. The last active administrator cannot be demoted or disabled, even when two administrators act at the same moment (the check and the change run in one transaction that locks the administrator rows). Role changes and disabling sign the user out immediately. Accounts are disabled, never deleted (the app role has no `DELETE` on users)   | Verified |

## Sessions

See [ADR 0002](decisions/0002-server-side-sessions.md).

| Control         | Design                                                                                                                                                                                                                                         | Status   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Token           | 32 bytes from the operating system's secure random generator, sent only in a cookie                                                                                                                                                            | Verified |
| Storage         | Only a SHA-256 hash of the token is stored. A copy of the database contains no usable sessions                                                                                                                                                 | Verified |
| Cookie          | `__Host-lexora_session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`. Chromium accepts `Secure` cookies on `http://127.0.0.1` and `localhost`, so development uses the same cookie as production                            | Verified |
| Lifetime        | 30 minutes idle, 10 hours absolute (decision D7, configurable within bounds). A session still waiting for its second factor lives 10 minutes. Expired sessions are deleted when used and swept every 15 minutes                                | Verified |
| Rotation        | Signing in replaces any existing session; a new token is issued after the second factor, after enrolment and after a password change; the previous token stops working                                                                         | Verified |
| Revocation      | Server-side. Password change signs out other sessions; a password link, disabling, a role change or a second-factor reset signs out all of them. "Sign out other devices" for each user                                                        | Verified |
| Browser storage | No tokens or confidential data in `localStorage`, `sessionStorage` or IndexedDB. `localStorage` holds only the language preference; the CSRF token is kept in memory; ESLint forbids `sessionStorage`. Signing out clears all cached responses | Verified |

## CSRF

The web app and API share one origin, and sessions use a cookie:

- `SameSite=Strict` on the session cookie.
- A random CSRF token per session, returned by `GET /api/auth/session`, kept
  in memory by the page and sent in `X-CSRF-Token` on every `POST`, `PUT`,
  `PATCH` and `DELETE`, compared in constant time. (Verified)
- State-changing requests are rejected when the `Origin` header is not
  `APP_ORIGIN`, or, without `Origin`, when `Sec-Fetch-Site` is present and
  not `same-origin`. This also blocks login CSRF. (Verified)
- Request bodies must be JSON (415 otherwise), which plain HTML forms on
  other sites cannot send. (Verified)
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

Built in Phase 3 (verified): every API route except health checks and the
sign-in routes requires a fully signed-in session, so anonymous callers get
401 for real and unknown routes alike. User administration requires the
`admin` role and answers 404 to everyone else, for every method.

Built in Phase 4 (verified):

- **One policy module** (`apps/api/src/modules/policy/matter-policy.ts`)
  holds every rule: `matterAccess` (how the user reaches a matter),
  `canOnMatter` (what they may do there), and the query scopes
  `visibleMattersWhere` and `visibleClientsWhere` that every list and search
  uses. The functions are pure; a unit test runs the full matrix of actor
  kinds × actions.
- **What each member may do:**

  | Action                               | Lead lawyer | Lawyer on the team                 | Assistant on the team | Administrator (break-glass) |
  | ------------------------------------ | ----------- | ---------------------------------- | --------------------- | --------------------------- |
  | Read the matter and its client       | Yes         | Yes                                | Yes                   | Yes, read-only              |
  | Edit the matter's details and status | Yes         | Yes                                | No                    | No                          |
  | Manage the team, restrict the matter | Yes         | No                                 | No                    | No                          |
  | Add, edit, remove parties            | Yes         | Yes                                | Yes                   | No                          |
  | Edit the client's details            | Yes         | Yes                                | Yes                   | No                          |
  | Open another matter for the client   | Yes         | Yes                                | No                    | No                          |
  | Take over the lead                   | —           | Only if the lead can no longer act | No                    | No                          |

  Only lawyers record clients, open matters and run conflict searches
  (decision D10, provisional). Administrators are never matter members: a
  user promoted to administrator loses access through their old
  memberships, and cannot be added to a team.

- **Clients** are visible through the matters the user can see, plus the
  clients a lawyer recorded that have no matter yet (so a matter can be
  opened for them). Clients and matters are never deleted by the
  application; matters are closed.
- **Answers:** a record the user cannot see is 404 (and the attempt is
  audited as `matter.access` or `client.access`, outcome `denied`); a
  visible record on which the action is not allowed is 403. Malformed IDs
  are 404.
- **IDOR test grid** (`matters-access.int.test.ts`): lead lawyer, lawyer
  and assistant on the team, lawyer and assistant outside it, administrator
  with and without break-glass access, an administrator who used to be a
  member, and signed-out callers, each against all 13 matter and client
  endpoints. After every refused attempt the database must be unchanged.
  Further tests cover lists, a party ID from another matter, disabled
  accounts, role changes and races.
- **Conflict search** (`GET /api/conflicts`, lawyers only) looks through
  every client and party in the office, because a conflict can hide in a
  matter the lawyer does not belong to. Each hit returns only the matched
  name, its role, the matter's reference and status, and whom to ask. For a
  **restricted** matter outside the user's team, only "a confidential matter
  matches" and whom to ask. Names and identifiers are compared without
  accents, case or Arabic spelling variants. At least 3 characters, at most
  50 hits, 60 searches per 15 minutes per user, and every search is audited
  without the searched text (it is personal data).
- **Break-glass access** (decision D2): an administrator gives the matter's
  reference and a reason (20 to 500 characters) after re-entering password
  and code. The grant is read-only, lasts 60 minutes, can be ended early, and
  belongs to that administrator only. The grant (`matter.break_glass`,
  marked high priority for the Phase 8 alerts) and every matter or client
  read under it are audited. The application role cannot delete grants or
  change anything in them except the end time.
- Text fields refuse control characters and the Unicode characters that
  reorder text (bidi overrides and isolates), so a name cannot be made to
  look like another one.

## API and application security

| Control              | Design                                                                                                                                                                                                                                                                                                                                           | Phase | Status                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------- |
| Startup settings     | All settings validated with Zod before the API starts. Refuses superuser or owner database roles, short production passwords, and debug logging in production. Error messages name the setting, never its value. Secrets can come from `*_FILE`                                                                                                  | 2     | Verified                          |
| Input validation     | Zod schemas for path, query, body and relevant headers, in strict mode. The error handler turns validation failures into field paths and issue codes, never submitted values                                                                                                                                                                     | 2     | Verified (handler); routes from 3 |
| Body type            | `POST`/`PUT`/`PATCH`/`DELETE` bodies must be `application/json` (415 otherwise). Forms from other sites cannot send JSON without a CORS preflight, which narrows CSRF                                                                                                                                                                            | 2     | Verified                          |
| SQL                  | Prisma only. Any raw query uses the `$queryRaw` tagged template (parameterized), is listed in this document and is reviewed. ESLint forbids `$queryRawUnsafe` and `$executeRawUnsafe`                                                                                                                                                            | 2     | Verified                          |
| Raw queries in use   | `SELECT 1` in the readiness probe (`apps/api/src/lib/database.ts`), no user input. Phase 3: rate-limit buckets, audit-log advisory lock, administrator row lock. Phase 4: the yearly matter counter (`INSERT … ON CONFLICT … RETURNING`) and the team-change row lock (`SELECT … FOR NO KEY UPDATE`), both in `matter-service.ts`, parameterised | 2–4   | Reviewed                          |
| API security headers | Helmet. API CSP: `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CORP/COOP same-origin, HSTS. No `X-Powered-By`                                                                                                                           | 2     | Verified                          |
| Web security headers | `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'` and related headers, without `unsafe-inline` or `unsafe-eval`. Sent by `vite preview` today and by the Caddy proxy in Phase 9                                                                                                               | 2, 9  | Verified (preview)                |
| CORS                 | Not enabled. The app is same-origin; cross-origin requests get no `Access-Control-Allow-*` headers                                                                                                                                                                                                                                               | 2     | Verified                          |
| Body limits          | JSON limit 100 kB (413 above it); uploads will have their own limit                                                                                                                                                                                                                                                                              | 2, 5  | Verified                          |
| Errors               | Central handler. Every error response matches one strict shared schema: a code and the request ID. No messages, stack traces, SQL or record contents                                                                                                                                                                                             | 2     | Verified                          |
| Correlation IDs      | Fresh random UUID per request, generated by the server (a client-sent ID is ignored), returned in `X-Request-Id` and logged                                                                                                                                                                                                                      | 2     | Verified                          |
| Caching              | `Cache-Control: no-store` on every API response, including errors                                                                                                                                                                                                                                                                                | 2     | Verified                          |
| Slow clients         | Header timeout 15 s, request timeout 30 s, keep-alive 5 s                                                                                                                                                                                                                                                                                        | 2     | Implemented                       |
| Health endpoints     | `/api/health/live` and `/api/health/ready` reveal only `ok`/`unavailable`: no versions, hosts or error text                                                                                                                                                                                                                                      | 2     | Verified                          |
| Browser API client   | Same-origin `fetch` with `credentials: "same-origin"`, a timeout, and Zod validation of every response; an unexpected shape is treated as an error                                                                                                                                                                                               | 2     | Verified                          |
| HTTP methods         | Only the methods each route needs; correct status codes                                                                                                                                                                                                                                                                                          | 2     | Implemented                       |
| Redirects            | Only to allowlisted internal paths                                                                                                                                                                                                                                                                                                               | 3     | Planned                           |
| Outbound requests    | The API does not fetch user-supplied URLs (no SSRF surface)                                                                                                                                                                                                                                                                                      | —     | —                                 |
| Raw HTML             | ESLint forbids `dangerouslySetInnerHTML` and `innerHTML`; translations are rendered as text                                                                                                                                                                                                                                                      | 2     | Verified                          |

## Database security

| Control             | Design                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Phase |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Roles               | `lexora_owner` owns the databases and schema and is used only by migration commands. `lexora_app`, used by the API, has only `SELECT`, `INSERT`, `UPDATE`, `DELETE` on tables the owner creates. Neither is a superuser, can create roles or databases, or bypasses RLS. Verified: the app role cannot create tables, schemas, functions, roles or databases, read server files, run programs, read `_prisma_migrations`, or connect to databases it was not granted | 2     |
| Time limits         | `lexora_app` has `statement_timeout = 30s` and `idle_in_transaction_session_timeout = 60s` (verified)                                                                                                                                                                                                                                                                                                                                                                | 2     |
| Audit table rights  | `lexora_app` has only `INSERT` and `SELECT` on `audit_event`, and no `DELETE` on `app_user` (verified)                                                                                                                                                                                                                                                                                                                                                               | 3     |
| Matter table rights | `lexora_app` cannot delete or truncate `client`, `matter`, `matter_counter` or `break_glass_grant`, and can only set `ended_at` on a grant. One lead per matter (partial unique index); a matter is closed exactly when it has a closing date; references, names and grant lengths are checked (verified)                                                                                                                                                            | 4     |
| Network             | Production: reachable only on the internal Docker network, never published (Phase 9). Development: published on `127.0.0.1` only, so tools on the workstation can reach it but other machines on the network cannot                                                                                                                                                                                                                                                  | 2, 9  |
| Separation          | Separate databases and credentials for development, test, staging and production                                                                                                                                                                                                                                                                                                                                                                                     | 2, 9  |
| Integrity           | Foreign keys, `CHECK` constraints, unique constraints, indexes; transactions for multi-step writes                                                                                                                                                                                                                                                                                                                                                                   | 2–7   |
| Money               | Integer amounts in centimes; invoice numbers from a locked counter row inside the same transaction, so numbers have no gaps                                                                                                                                                                                                                                                                                                                                          | 7     |
| Migrations          | Created in development, reviewed in pull requests, applied with `prisma migrate deploy`. `migrate reset` and `db push` are never used against staging or production                                                                                                                                                                                                                                                                                                  | 2     |

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

| What                     | Protected by                                      | Key location                                                                                                                                                   | What it does not protect against                   |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Network traffic          | TLS at the Caddy proxy, HSTS                      | Certificate key on the server                                                                                                                                  | A compromised server or proxy                      |
| Server disks             | Full-disk encryption (LUKS)                       | Passphrase or TPM unlock, decided at installation                                                                                                              | Anyone with access to the running server           |
| TOTP secrets             | AES-256-GCM in the application, bound to the user | `MFA_ENCRYPTION_KEY` (env or Docker secret file), outside the database and the backups; keep a copy offline, or every second factor must be reset after a loss | A compromised running API                          |
| Session and reset tokens | Stored only as SHA-256 hashes                     | —                                                                                                                                                              | Theft of a token from a user's browser             |
| Passwords                | Argon2id                                          | —                                                                                                                                                              | Weak passwords allowed by an outdated blocklist    |
| Backups                  | restic encryption                                 | Kept apart from the media (see [ADR 0007](decisions/0007-backups.md))                                                                                          | Loss of the key, which makes backups unrecoverable |

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
- The application role can only add and read audit rows (no `UPDATE`,
  `DELETE` or `TRUNCATE`), and a trigger refuses updates and deletes from any
  role. Each row includes a hash of the previous row and of its own content
  (keys sorted, so PostgreSQL's JSON reordering cannot break it); writers
  take a lock so concurrent events chain correctly. `verifyAuditChain`
  detects a changed or deleted row. The latest hash will be copied with each
  backup (Phase 9). (Verified)
- Recorded since Phase 3: sign-in success and failure (with the account only
  if it exists, never the typed e-mail), second-factor checks, enrolment,
  recovery-code regeneration, re-authentication, password change and set,
  sign-out, "sign out other devices", and every user-administration action.
- Recorded since Phase 4: client and matter creation and changes (field
  names only, never values), team changes, lead hand-overs (and whether the
  lead was taken over), party changes, conflict searches (hit count only),
  break-glass grants, endings and reads, and denied attempts on matters and
  clients.
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
