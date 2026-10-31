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
| 2. Foundation                              | `feature/foundation`  | Done (2026-10-18) |
| 3. Identity and sessions                   | `feature/auth`        | Done (2026-10-21) |
| 4. Authorization, clients and matters      | `feature/matters`     | Done (2026-10-21) |
| 5. Documents                               | `feature/documents`   | Done (2026-10-21) |
| 6. Hearings, deadlines and background jobs | `feature/calendar`    | Done (2026-10-21) |
| 7. Fees, invoices and payments             | `feature/billing`     | Done (2026-10-31) |
| 8. Audit viewer, alerts and administration | `feature/audit-admin` | In review         |
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

Built as planned, with these changes (reasons in [security.md](security.md#identity-and-authentication)):

- The first-administrator command prints a single-use set-password link
  instead of asking for a password in the terminal; a `recover` command was
  added for locked-out administrators.
- Rate limits use fixed windows rather than progressive delays.
- Break-glass access to matter content (decision D2) is deferred to Phase 4,
  when matters exist.
- The web app gained sign-in, second-factor, set-password, security and
  user-administration screens in French and Arabic.

### Phase 4 — Authorization, clients and matters

- Central policy module and query-scoping helpers.
- Clients, matters, parties, matter team membership, restricted matters.
- Conflict-of-interest search, limited to the minimum fields needed.
- Full IDOR/BOLA test grid: every role, every endpoint, own versus other
  matter.

Built as planned, with these choices (details in [security.md](security.md#authorization)):

- **Who does what.** Lawyers record clients, open matters (becoming their
  lead) and run conflict searches. The lead manages the team and the
  "restricted" flag; lawyers on the team edit the matter; everyone on the
  team edits parties and client details. Assistants cannot open matters or
  change teams (provisional decision D10).
- **Restricted matters.** Every matter is already visible to its team only.
  "Restricted" additionally hides the name, reference and status from
  non-members in conflict searches; they only learn that a confidential
  matter matches and whom to ask.
- **Matter references** are generated by the server per year without gaps
  (`2026-0001`), from a counter row updated in the same transaction
  (provisional decision D11).
- **Break-glass access** (decision D2, deferred from Phase 3): an
  administrator names a matter by reference, gives a reason of at least 20
  characters and re-enters password and code; access is read-only, lasts 60
  minutes, can be ended early, and every grant and read is audited.
- **Leaving lawyers.** When a lead's account is disabled or is no longer a
  lawyer, a lawyer on the team can take over the lead, so no matter is left
  without anyone able to manage it.
- **Answers.** A record the user cannot see answers 404, whether or not it
  exists; a visible record on which the action is not allowed answers 403.
- Row-level security stays postponed ([ADR 0003](decisions/0003-authorization-model.md)).

### Phase 5 — Documents

- Private document storage, quarantine folder and ClamAV scanning.
- Upload with size limit, file-signature detection and type allowlist.
- Authorized, streamed downloads with safe headers.
- Upload, download, replacement and deletion audit events.

Built as planned, with these choices (details in [security.md](security.md#document-storage)):

- Uploads are the raw file body (`application/octet-stream`) instead of a
  multipart form: no form-parsing library to trust, and the content type
  still needs a CORS preflight from other sites.
- File types are detected by our own code from the bytes; Office and
  OpenDocument files are recognised from the ZIP table of contents without
  decompressing anything. No new runtime dependency was added this phase.
- "Replacement" keeps history: a new version is added and older ones stay
  available. "Deletion" hides the document; files are kept.
- ClamAV runs as an opt-in development service (it needs 1–2 GB of memory);
  uploads are refused while it is down. Tests use a fake clamd speaking the
  same protocol; CI also tests the real ClamAV with the EICAR file.
- Downloads are checked against the stored hash while they are sent.

### Phase 6 — Hearings, deadlines and background jobs

- Hearings, deadlines, tasks and reminders.
- Background job runner stored in PostgreSQL (pg-boss), running in a
  separate worker process.

Built with these changes and choices:

- **No pg-boss** ([ADR 0008](decisions/0008-in-house-scheduler.md)): it
  creates tables while running, which would need a database right the
  application deliberately does not have. A small scheduler on one table
  runs the periodic tasks instead (reminders, expired sessions and rate
  limits, abandoned uploads), in a separate worker process.
- **Deadlines and tasks share one list**: a deadline (legal or procedural,
  always dated) reminds the whole team; a task can be given to one team
  member, who is told at once.
- **Reminders are in-app** (a bell with the unread count, a reminders page,
  an agenda); no e-mail or SMS (provisional decision D12).
- **Hearing times** are entered and shown in office time
  (Africa/Casablanca), stored as instants. The offset comes from the
  runtime's time-zone database, which must be tzdata 2026c or later: Morocco
  moved to permanent UTC+0 on 2026-09-20 (see the CI note below).
- Hearings are never deleted (they are cancelled); deadlines and tasks can
  be deleted by lawyers on the team.

### Phase 7 — Fees, invoices and payments

- Fee agreements, invoices with gap-free numbering, payments, credit notes.
- Transactions and locking for every money operation.
- Exports with permission checks, audit events and CSV formula-injection
  protection.
- Moroccan invoice details to be confirmed through the
  [privacy and legal checklist](privacy-checklist.md).

Built with these choices (decisions D13–D15, details in
[security.md](security.md#billing)):

- **Payments are recorded, not taken** (D13): cash, cheque, transfer, card
  terminal or other, with a reference. No online payment, no card data, no
  paid service.
- **One VAT rate for fees**, set by an administrator (default 20 %, to be
  confirmed by the office's accountant, D14). Disbursements (court fees,
  stamps) are re-billed without VAT. Drafts follow the office rate; the rate
  is frozen when an invoice is issued, and a credit note keeps the rate of
  the invoice it corrects.
- **Who bills** (D15): the matter team reads billing and prepares draft
  invoices; lawyers on the team issue invoices and credit notes, record and
  void payments, manage fee agreements and export. Administrators enter the
  office details printed on invoices and see office-wide monthly totals
  without client or matter details. Break-glass access never reaches billing.
- **Numbers**: `F-2026-0001` for invoices and `AV-2026-0001` for credit
  notes, given only when a document is issued, from a counter row in the
  same transaction, with the issue date set to today. Drafts have no number,
  so deleting one leaves no gap. The database itself refuses any other
  number (trigger).
- **Issued documents never change**: the office and client details are
  frozen into the invoice, a trigger refuses any change except the running
  totals, and corrections are made with a credit note. Payments are never
  edited or deleted; a mistake is voided with a reason.
- **Exports**: the sales journal (CSV, semicolons, French decimals, UTF-8 with
  a byte-order mark) of the lawyer's own matters, for up to a year, with
  formula-injection protection and an audit event.
- **Printing** uses the browser: the invoice page prints only the invoice,
  with the office logo. No PDF library was added.
- The office logo now appears in the header, the browser tab and on
  invoices.

### Phase 8 — Audit viewer, alerts and administration

- Audit-log viewer for authorized users, with integrity verification.
- Alerts for repeated login failures, repeated authorization failures and
  backup failures.
- User and permission management screens.

Built with these choices (decisions D16 and D17, details in
[security.md](security.md#audit-logging)):

- **Audit-log viewer** for administrators: search by action family,
  result, person, record and dates (office calendar), newest first with
  "load more", and an on-demand check of the whole hash chain. The log
  holds IDs, action names, field names and reason codes, never matter
  content, so administrators can read it without breaking D2. Searching it
  is itself audited.
- **Matter history** for the lead lawyer (D17): everything recorded about the
  matter, including reads by administrators under break-glass access and
  refused attempts, without IP addresses.
- **Alerts in the app only** (D16, no e-mail service): a worker task scans
  the audit log every 5 minutes for repeated failed sign-in, code or
  password checks on one account (5 in 15 minutes, half the lockout limit),
  repeated failed sign-ins from one address (10), repeated refused access to
  records by one person (10), and every break-glass grant; a daily task
  re-verifies the hash chain. Backups (Phase 9) report through
  `npm run admin -- backup-report --status ok|failed`; a failure alerts at
  once, and so does a gap of more than 26 hours after the first success.
  Administrators acknowledge alerts and resolve them with a note; the menu
  shows how many are left. Alerts are never deleted.
- **Administration**: the user list shows live sessions and failed checks
  in the last 24 hours, links to each person's audit entries, and explains
  what each role may do.
- Times in the audit log, history and alerts are converted to office time
  by the server, like hearings (the browser's time-zone data may be old).

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

| #   | Question                                | Provisional default                                                                                                                                   |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Number of users and server hardware     | Dedicated machine running Ubuntu Server 24.04 LTS                                                                                                     |
| D2  | Can administrators read matter content? | No. Logged "break-glass" access only                                                                                                                  |
| D3  | Password reset channel                  | Admin-initiated, token given in person. No email service                                                                                              |
| D4  | MFA scope                               | Required for administrators; strongly recommended for everyone                                                                                        |
| D5  | TLS certificate                         | Office-owned domain with a Let's Encrypt DNS-01 certificate; internal CA as fallback                                                                  |
| D6  | Off-site backup                         | Two rotated, encrypted USB drives, one kept off-site. No cloud copy                                                                                   |
| D7  | Recovery targets and session timeouts   | RPO 24 h, RTO 1 working day; 30 min idle, 10 h absolute                                                                                               |
| D8  | Document types and size                 | PDF, DOCX, XLSX, ODT, JPEG, PNG; 25 MB per file                                                                                                       |
| D9  | GitHub repository visibility            | Private                                                                                                                                               |
| D10 | Who opens matters and records clients   | Lawyers only; assistants work on the matters they are added to                                                                                        |
| D11 | Matter reference format                 | Year and a gap-free number, `2026-0001`, generated by the server                                                                                      |
| D13 | Payments                                | Recorded by staff (cash, cheque, transfer, card terminal, other); no online payment                                                                   |
| D14 | VAT on invoices                         | One office rate for fees (20 %), set by an administrator and confirmed by the accountant; disbursements without VAT                                   |
| D16 | Security alerts                         | In the app only, for administrators (menu badge and alerts page); no e-mail service                                                                   |
| D17 | Who reads the audit log                 | Administrators (whole log, no matter content); each matter's lead lawyer (that matter's history, without IP addresses)                                |
| D15 | Who bills                               | Team: drafts; lawyers on the team: issue, credit notes, payments, fee agreements, export; administrators: office details and totals without names     |
| D12 | Reminders                               | In-app only (bell, reminders page, agenda). Hearings: a week and a day before; deadlines: a week, two days, on the day, once overdue; tasks: when due |

## Verification log

### Phase 8 — Audit viewer, alerts and administration

Checks run on 2026-10-31 on Windows 11 with Node.js 24.22.1 and Docker
Desktop (PostgreSQL 18.6). CI has not run this branch yet. A first full run
was stopped by the machine running out of memory; the checks were then run
in two smaller batches.

| Check                                       | Result                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run lint` (ESLint, 0 warnings)         | Pass                                                                                                     |
| `npm run format:check`                      | Pass                                                                                                     |
| `npm run typecheck` (3 workspaces)          | Pass                                                                                                     |
| Unit tests                                  | 326 passed (shared 30, API 197, web 99); 1 skipped on Windows (folder permissions)                       |
| Integration tests (real PostgreSQL)         | 222 passed in 19 files, including the audit, alert and history tests; 3 skipped (real ClamAV, run in CI) |
| `npm run build`                             | Pass                                                                                                     |
| End-to-end (Playwright, 1366 px and 390 px) | 68 passed, 1 skipped by design (audit, alerts and history: 11 of 11)                                     |
| Accessibility (axe, WCAG A/AA)              | 0 violations on the alerts, audit-log (French and Arabic), users and matter-history views                |
| `npm run audit:deps`                        | No advisories except one documented, expiring exception (minimatch, see security.md, Supply chain)       |
| gitleaks 8.30.1 (263 files to commit)       | No leaks                                                                                                 |
| Trivy 0.75.0 (CI image and options)         | 0 findings with `.trivyignore` (the same minimatch exception); without it, 2 moderate on minimatch only  |
| Screenshots                                 | Alerts, audit log (French and Arabic), users page with the role table, at both widths                    |

Controls proven by breaking them (each made at least one test fail, then the
code was restored): the audit log readable by lawyers; every lawyer on the
team seeing a matter's history; a history including other matters' events
(missed at first: a test was added); alerts below the threshold; a resolved
burst raised again; refused uploads counted as probing, in both the scan and
the recount after a resolution (the second missed at first: a test was
added); a backup overdue before any success; an alert acknowledged twice;
the alert count fetched for non-administrators; the history loaded without
being asked; and, in the test database, the application allowed to rewrite
alerts and the "one unresolved alert per subject" index dropped. 13 of 13
caught. The audit-exception script was proven too: it fails when the
exception expires and when it is removed.

Problems found and fixed during this phase:

- **Acknowledged alerts disappeared** from the default list (found by an
  end-to-end test): the list now shows everything not yet resolved.
- **Two alerts for one failed backup** (failed and overdue): "overdue" now
  needs a successful backup first.
- **Menu badge read as "Alertes3"** by screen readers; the link now has a
  proper label ("Alertes (à traiter : 3)").
- **Times converted by the browser** in the new screens (F31): the server now
  sends office times.
- **Sideways scrolling on phones** on the users page: screen-reader-only text
  in the role table escaped its scroll area (absolutely positioned inside a
  non-positioned container). The scroll areas are now positioned. The
  end-to-end overflow check now names the elements that cause an overflow,
  which is how this was found.
- A slow user-administration test (typing a password key by key) timed out
  under a full parallel run; its own timeout was raised.

### Phase 7 — Fees, invoices and payments

Checks run on 2026-10-30/31 on Windows 11 with Node.js 24.22.1 (tzdata
2026e) and Docker Desktop (PostgreSQL 18.6). CI has not run this branch yet.
CI on `main` after the Phase 6 merge had failed only at the Chromium
download step and still needs a re-run.

| Check                                       | Result                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` (ESLint, 0 warnings)         | Pass                                                                                                                                                          |
| `npm run format:check`                      | Pass                                                                                                                                                          |
| `npm run typecheck` (3 workspaces)          | Pass                                                                                                                                                          |
| Unit tests                                  | 318 passed (shared 30, API 196, web 92); 1 skipped on Windows (folder permissions)                                                                            |
| Integration tests (real PostgreSQL)         | 210 passed in 18 files, including the billing access grid, parallel issuing and payments, and the database protections; 3 skipped (real ClamAV, run in CI)    |
| `npm run build`                             | Pass                                                                                                                                                          |
| End-to-end (Playwright, 1366 px and 390 px) | 62 passed, 1 skipped by design, in the final full run (billing: 15 of 15)                                                                                     |
| Accessibility (axe, WCAG A/AA)              | 0 violations on the invoice page (French and Arabic), the invoice list and the administrator billing page                                                     |
| `npm audit`                                 | 0 vulnerabilities, after the updates described in security.md (Supply chain); 5 new advisories had appeared since Phase 6                                     |
| gitleaks 8.30.1 (247 files to commit)       | No leaks                                                                                                                                                      |
| Trivy 0.75.0 (CI image and options)         | 0 vulnerabilities, secrets or misconfigurations in the files to commit. The re-run of CI on `main` failed on the five new advisories, which this branch fixes |
| Screenshots                                 | Invoice, print view, invoice list and administrator page reviewed at both widths, French and Arabic; two display bugs fixed                                   |

Controls proven by breaking them (each made at least one test fail, then the
code was restored): payments without the invoice row lock (parallel
overpayment); issuing without the row lock (a draft issued twice); payments
above the balance; payment dates not checked; credit notes beyond what is
left to credit; issued invoices showing the client's current name instead of
the frozen one (missed at first: a test was added); invoices issued without
the office details; assistants issuing and recording payments; break-glass
access reaching billing; the invoice list not limited to the person's
matters; CSV cells starting with `=` not neutralised; VAT rounded per line;
the web app using the device's time-zone data for the office date; French
addresses losing their direction in Arabic; the payment form sending more
than is due; and, in the test database, each of the five billing triggers
switched off (issued invoices, their lines, numbering, counters, payments).
20 of 20 caught. The compressed-body refusal was also seen failing before
the change.

Problems found and fixed during this phase:

- **Office date taken from the device** (F27, found by an end-to-end test
  that ran at 23:13 UTC). Playwright's Chromium still puts Morocco on
  UTC+1, so it proposed tomorrow's date for a payment, which the server
  refused. The new-matter form had the same flaw since Phase 4. The session
  now carries the office's UTC offset from the server.
- **Numbers not protected by the database** (F28, design review): triggers
  now make the counter the only source of numbers.
- **Arabic display**: French addresses lost their word order ("Rabat 1"
  instead of "1 rue…") and negative amounts showed the minus at the end;
  fixed with per-line direction and locale-aware number formatting.
- **Amounts typed as "1.500,50"** (how fr-MA writes them) were refused; they
  are now read correctly, while the ambiguous "1.500" is still refused.
- **Two buttons both labelled "Annuler"** in the void-payment dialog
  (cancel and void); the action is now "Annuler le règlement".
- **Keyboard access**: the monthly totals table scrolls on phones and was not
  reachable by keyboard (axe); the scroll area is now a focusable, named
  region.
- **Dependencies**: zod, body-parser, qs, undici and fast-uri updated for
  new advisories; the API also stops accepting compressed request bodies.
- Tooling: escape sequences written by the editor tools were twice saved as
  raw invisible characters (a byte-order mark and a narrow no-break space in
  tests); found by the invisible-character scan and replaced by character
  codes.

### Phase 6 — Hearings, deadlines and background jobs

Checks run on 2026-10-21 on Windows 11 with Node.js 22.14.0 and Docker
Desktop (PostgreSQL 18.6). CI has not run this branch yet.

| Check                                       | Result                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` (ESLint, 0 warnings)         | Pass                                                                                                                                                     |
| `npm run format:check`                      | Pass                                                                                                                                                     |
| `npm run typecheck` (3 workspaces)          | Pass                                                                                                                                                     |
| Unit tests                                  | 282 passed (shared 30, API 177, web 75); 1 skipped on Windows (folder permissions)                                                                       |
| Integration tests (real PostgreSQL)         | 180 passed in 16 files, including the calendar access grid and two-worker scheduler races; 3 skipped (real ClamAV, run in CI)                            |
| `npm run build`                             | Pass                                                                                                                                                     |
| End-to-end (Playwright, 1366 px and 390 px) | 52 passed, 1 skipped by design, in the final full run; the run before had one failure caused by Windows reporting `net::ERR_NO_BUFFER_SPACE` (see below) |
| Accessibility (axe, WCAG A/AA)              | 0 violations on the matter page with hearings and tasks, the agenda and the reminders page (French and Arabic)                                           |
| `npm audit`                                 | 0 vulnerabilities (no new dependency this phase)                                                                                                         |
| gitleaks 8.30.1 (221 files to commit)       | No leaks                                                                                                                                                 |
| Trivy                                       | Not run locally (memory); runs in CI                                                                                                                     |
| Screenshots                                 | Reviewed at both widths in French and Arabic; one display bug fixed (F24)                                                                                |

**New evidence on the intermittent failures (Phase 4).** In one full run,
Chrome reported `net::ERR_NO_BUFFER_SPACE` for a request that never reached
the server: Windows had run out of socket buffer space (it happens under
memory pressure or with too many open connections). This fits every earlier
symptom (requests never answered, server logs showing nothing slow) and
points at the development machine rather than the application. Still not
proven; to be confirmed in CI, where it has never occurred.

Controls proven by breaking them (each made at least one test fail, then the
code was restored): reminders sent to disabled accounts and non-members;
reminder stages ignored; task reminders sent to the whole team instead of
the assignee; hearings writable with read access (outsiders, break-glass);
assistants deleting tasks; tasks assignable to anyone; an outcome on a
hearing still scheduled; other people's reminders listed; other people's
reminders marked read; the agenda not limited to the user's matters; the
scheduler ignoring the next-run time; the scheduler ignoring another
worker's lease; abandoned-upload cleanup ignoring file age; the office time
offset ignored (API); hearing times shown in the device's time zone (web);
references not isolated in Arabic text; the application role allowed to add
or remove periodic tasks (granted in the test database, then revoked).
17 of 17 caught.

Problems found and fixed during this phase:

- **Reversed matter references in Arabic** (F24, seen in a screenshot).
  Inside right-to-left text, "2026-0001" was shown as "0001-2026". References
  placed in sentences are now wrapped in a left-to-right isolate; a test
  checks it.
- **Time-zone test that proved nothing.** This machine is itself on
  Africa/Casablanca time, so the "office time whatever the device" test
  passed even without the code it protects. Web tests now run in
  Asia/Tokyo time, and the test fails when the office time zone is removed.
- **pg-boss creates tables at runtime** (F25): replaced by an in-house
  scheduler (ADR 0008) rather than giving the application role new rights.
- Two existing document tests used "the alert" on the matter page, which
  now has more sections; they look inside the documents section.
- End-to-end: counting reminders before the page had loaded always found
  none; the test now waits for the list.

**First CI run (2026-10-21).** Three time tests failed in CI only: CI (Node.js 24) placed 3 November 2026 at UTC+0, this machine (Node.js 22.14) at UTC+1.
CI was right: Morocco moved to permanent UTC+0 on 2026-09-20, which is in
tzdata 2026c (IANA, 2026-07-08); Node.js 22.14 ships tzdata 2024b (F26). The
code was correct; the tests had hard-coded a future offset. They now use
settled 2025 dates, plus a test of the 2026 change that runs only where the
time-zone data is current (in CI; skipped on this machine). After the fix, two local full end-to-end runs each had
timeouts in tests the fix does not touch (the Phase 3 password-link test
both times, once also the documents test): the open intermittent problem,
not a new one.

**Second CI run (2026-10-21).** Two more problems, both fixed:

- The hearing time on the matter page was converted by the browser, whose
  own time-zone data may be older than the server's: Playwright's Chromium
  showed a 09:30 hearing as 10:30. The web app now shows the office time the
  server computes (`startsAtLocal`, and a server-computed day for
  reminders) and never converts time zones itself; a test gives it an
  instant that disagrees with the office time and fails if the browser's
  conversion is shown.
- A test of the time-zone check passed `undefined` to a parameter with a
  default value, so it silently checked the runtime's own version instead.
  The version is now always passed explicitly.

Node.js 24.22.1 (tzdata 2026e) was then installed on this machine: the
2026 time-zone test now runs locally too. `npm audit` reported two new
Vitest advisories (published 2026-10-21); Vitest 4.1.12 was taken as a
documented cooldown exception (see security.md, Supply chain). On Node.js
24: lint, format, types and build pass; unit tests 286 passed, 1 skipped
(Linux-only); integration 180 passed, 3 skipped (real ClamAV); audit 0;
end-to-end 52 passed, 1 skipped in the second of two full runs (the first
had one failure: the database readiness check answered "unavailable" once
under load). The API and the
worker now check their time-zone data at startup: in production they refuse
to start with tzdata older than 2026c, elsewhere they warn. The check was
proven by breaking it.

### Phase 5 — Documents

Checks run on 2026-10-21 on Windows 11 with Node.js 22.14.0 and Docker
Desktop (PostgreSQL 18.6). CI has not run this branch yet; the tests against
the real ClamAV run only there.

| Check                                       | Result                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint` (ESLint, 0 warnings)         | Pass                                                                                                                           |
| `npm run format:check`                      | Pass                                                                                                                           |
| `npm run typecheck` (3 workspaces)          | Pass                                                                                                                           |
| Unit tests                                  | 253 passed (shared 16, API 172, web 65); 1 skipped on Windows (folder permissions, runs on Linux)                              |
| Integration tests (real PostgreSQL)         | 153 passed in 14 files, including the document access grid (8 kinds of user × 7 endpoints); 3 skipped (real ClamAV, run in CI) |
| `npm run build`                             | Pass                                                                                                                           |
| End-to-end (Playwright, 1366 px and 390 px) | 46 passed, 1 skipped by design, in each of 2 full runs (2 workers)                                                             |
| Accessibility (axe, WCAG A/AA)              | 0 violations on the matter page with documents (French and Arabic) and the versions dialog                                     |
| `npm audit`                                 | 0 vulnerabilities (no new dependency this phase)                                                                               |
| gitleaks 8.30.1 (201 files to commit)       | No leaks (two false positives on test UUIDs removed by generating them at run time; no allowlist added)                        |
| Trivy                                       | Not run locally (memory); runs in CI                                                                                           |
| Screenshots                                 | Reviewed at both widths in French and Arabic                                                                                   |

Controls proven by breaking them (each made at least one test fail, then the
code was restored): upload body read before the access check; scanner
failure treated as clean (fail open); infected files kept; type check
skipped; refused uploads left in quarantine; deleted documents still listed;
download hash not checked; assistants allowed to delete; size limit not
enforced while streaming; downloads served inline; the download sandbox CSP
removed; raw bodies accepted on every route; macros allowed; encrypted
archive entries allowed; unclear scanner replies accepted; paths kept in
file names; the web app uploading without the CSRF token; the application
role allowed to rewrite document versions (granted in the test database,
then revoked). 18 of 18 caught.

Problems found and fixed during this phase:

- **Integrity check that came too late** (F22, found in design review before
  any test ran). Checking the hash only after the last byte had been sent
  would still have delivered a changed file in full, because the response
  announces its length. The last chunk is now held back until the hash
  matches; a test changes a stored file and checks that it is never
  delivered complete.
- **Failed setup in end-to-end tests.** Playwright's own request client
  does not send the `Secure` session cookie to `http://127.0.0.1`, so test
  set-up calls now run inside the page, as the app's do.
- File-type labels were first keyed by MIME type, whose dots the
  translation library reads as nesting; they now use short type names.
- Shell escaping in the development tooling twice removed backslashes (in a
  regular expression and a Windows path); caught by type checks and tests
  before anything ran.

Not verified locally: the real ClamAV (CI); folder permissions (Linux only,
checked in CI).

### Phase 4 — Authorization, clients and matters

Checks run on 2026-10-21 on Windows 11 with Node.js 22.14.0 and Docker
Desktop (PostgreSQL 18.6). CI has not run this branch yet.

| Check                                       | Result                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` (ESLint, 0 warnings)         | Pass                                                                                                                                        |
| `npm run format:check`                      | Pass                                                                                                                                        |
| `npm run typecheck` (3 workspaces)          | Pass                                                                                                                                        |
| Unit tests                                  | 192 passed (shared 16, API 121, web 55)                                                                                                     |
| Integration tests (real PostgreSQL)         | 116 passed in 12 files, including the access grid (8 kinds of user × 13 endpoints, plus signed out) and a race between two lead hand-overs  |
| `npm run build`                             | Pass                                                                                                                                        |
| End-to-end (Playwright, 1366 px and 390 px) | 43 tests; 3 of 5 full runs passed completely (42 passed, 1 skipped by design), 2 had one or two failures; see "Intermittent failures" below |
| Accessibility (axe, WCAG A/AA)              | 0 violations on the new-matter, matter (French and Arabic), clients, conflict search and break-glass pages                                  |
| `npm audit`                                 | 0 vulnerabilities                                                                                                                           |
| gitleaks 8.30.1 (180 files to commit)       | No leaks                                                                                                                                    |
| Trivy                                       | Not run locally (the machine was low on memory); runs in CI                                                                                 |
| Screenshots                                 | Reviewed at both widths in French and Arabic; one display bug fixed (below)                                                                 |

Controls proven by breaking them (each made at least one test fail, then the
code was restored): members seeing every matter (list scoping removed);
break-glass allowing changes; administrators keeping access through an old
membership; assistants managing the team; restricted matters revealed in
conflict searches; the searched text written to the audit log; conflict
searches not rate limited; break-glass without re-entering the password;
expired or ended grants still honoured (on the shared rule and on the list
path separately); references taken from a count instead of the locked
counter; a lawyer taking the lead while the lead can still act; the team
lock removed (lead hand-over race, failed 3 runs out of 3); direction-control
characters accepted in names; the application role allowed to delete
matters (granted in the test database, then revoked); the stale "run the
conflict check" warning.

Problems found and fixed during this phase:

- **Untested path for expired break-glass grants** (F19). Breaking the
  expiry rule used by lists failed no test: single matters were checked
  through a second copy of the rule. The rule now exists once, in the
  policy module, and a test checks the matter, the client and both lists
  after a grant ends and after it expires.
- **Link colour contrast** (F20). Links used the accent colour (about 4:1 on
  white). They now use the text colour with an accent underline.
- **Description lists** (F21). A wrapper element broke the `<dl>` structure
  that screen readers rely on.
- **Stale warning.** After a refused submit, "run the conflict check" stayed
  on screen after the check had run (seen in a screenshot); it now
  disappears, and unit and end-to-end tests check it.
- **"Become lead" and "add to team" could send the wrong person** in the
  first version of the matter page (found in review before any test ran); a
  unit test now checks the request body.
- **Invisible characters in source files** (F18). Escape sequences written
  by the development tooling were saved as the raw characters (direction
  overrides, control characters). They were turned back into visible
  escapes, and every changed file was scanned: none remain.
- The team lock now uses `FOR NO KEY UPDATE`, which serialises team changes
  without blocking inserts of parties or grants for the same matter.
- Two existing tests used `/clients/123` as an "unknown address"; it is now
  a real page, so they use another address.

**Intermittent failures (open).** Of five full end-to-end runs with 2
workers, three passed completely and two failed, always on desktop. Both
times the existing "set a password with the link" test (Phase 3) got no
answer to its request within its 30 seconds; once, the first request of
another test file also took 4.5 to 5 seconds. That password test had
already failed once in Phase 3 while another heavy program was running.
The machine had about 2 GB of 17 GB memory free. What was ruled out:
sampling PostgreSQL every half second showed no query waiting on a lock;
the API's own log showed every request answered in under one second (the
slowest 978 ms); the test web server logged no proxy errors; loading the
breached-password list takes 117 ms. The cause is not proven. The
"Accessibility" and other rows above come from the passing runs. If CI
shows the failure, it will be investigated there with the server logs.

Not verified in this phase: a CI run of this branch; Trivy locally; Node.js
24 locally.

### Phase 3 — Identity and sessions

Checks run on 2026-10-18 on Windows 11 with Node.js 22.14.0 and Docker
Desktop (PostgreSQL 18.6). CI has not run this branch yet.

| Check                                       | Result                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint` (ESLint, 0 warnings)         | Pass                                                                                                                                                                                 |
| `npm run format:check`                      | Pass                                                                                                                                                                                 |
| `npm run typecheck` (3 workspaces)          | Pass                                                                                                                                                                                 |
| Unit tests                                  | 128 passed (shared 3, API 89, web 36)                                                                                                                                                |
| Integration tests (real PostgreSQL)         | 67 passed in 7 files                                                                                                                                                                 |
| `npm run build`                             | Pass                                                                                                                                                                                 |
| End-to-end (Playwright, 1366 px and 390 px) | 30 passed, 1 skipped by design; 4 consecutive full runs all passed                                                                                                                   |
| Accessibility (axe, WCAG A/AA)              | 0 violations on sign-in, second-factor set-up and recovery codes, security, users, re-authentication dialog and status pages, in French and Arabic                                   |
| `npm audit`                                 | 0 vulnerabilities                                                                                                                                                                    |
| Trivy 0.75.0                                | 0 findings (development dependencies included)                                                                                                                                       |
| gitleaks 8.30.1 (146 files to commit)       | No leaks, after allowing only the exact synthetic e2e authenticator secret; a different secret in that same file is still reported, and the real development `.env` gives 4 findings |
| Screenshots                                 | Reviewed at both widths in French and Arabic; two layout fixes (below)                                                                                                               |

Controls proven by breaking them (each made at least one test fail, then the
code was restored byte for byte): disabled accounts signing in; no dummy
hash for unknown accounts (timing); breached-password list skipped; CSRF
token not checked; Origin not checked; authenticator codes replayable; admin
routes open to every role; user creation without re-authentication; idle
timeout ignored; sessions kept after a role change or disable; login rate
limit off; unknown fields accepted (mass assignment); password links
reusable; old token kept after rotation (session fixation); the "last
administrator" lock removed (race); admin pages shown to non-admins in the
web app; CSRF header not sent by the web app; password-link token left in
the address bar.

Problems found and fixed during this phase:

- **Race leaving no administrator** (threat model F14). Two administrators
  demoting each other at the same moment could both succeed. Found while
  reviewing a test that could not reach the rule; fixed with a transaction
  that locks the administrator rows; a concurrency test fails without the
  lock.
- **Weak test (session fixation).** Keeping the old token after the second
  factor did not fail the sign-in tests; an assertion was added.
- **Shared dialog title id** (F15). With two dialogs open, screen readers
  would announce the wrong title. Each dialog now has a unique id.
- **Secret-scanner allowlist too broad** (F16). A "file and value"
  allowlist silenced the whole file; it was replaced by an exact-value rule
  and proven both ways.
- **Duplicate authenticator set-up request in development** (F17). React
  development mode runs effects twice, which could show a QR code that no
  longer matched the stored secret; one request is now guaranteed.
- **Layout.** On phones the "add user" button touched the list; French
  labels lacked the space before the colon (now part of the translations).
- Three test inputs were wrong (passwords containing the user's own name,
  correctly rejected by the policy, and a CHECK constraint correctly refusing
  an impossible session); the tests were fixed, not the code.

**First CI run (2026-10-21).** One accessibility test failed on the phone
run in CI only: a colour-contrast violation right after switching language.
Reproduced locally by freezing the language buttons halfway through their
150 ms colour transition (contrast 2.5 to 3.4:1); both final states pass.
The scan ran while the transition was still in progress, so the
accessibility helper now waits until finite animations have finished. The
failing test then passed 20 times out of 20, and the full suite passed.
End-to-end ports can now be moved with `E2E_API_PORT` and `E2E_WEB_PORT`
when 3000 or 4173 are taken by other software (defaults unchanged).

**Second CI run (2026-10-21).** `npm audit` and Trivy failed on newly
published advisories for Vite 8.3.2 (the bundled `launch-editor`: command
injection and argument escaping on Windows, GHSA-698v-4r3x-3vcv,
GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm). The code is part of Vite's
development server, which never runs in production, but the alert is fixed
rather than ignored. Vite is now pinned to 8.3.3 (released 2026-10-06, so
within the 14-day cooldown; 8.3.4 and later are too new). Only Vite changed
in the lockfile. Afterwards `npm audit` reported 0 vulnerabilities and every
check was run again.

Not verified in this phase: a passing CI run of this branch after the fix;
Node.js 24 locally.

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
