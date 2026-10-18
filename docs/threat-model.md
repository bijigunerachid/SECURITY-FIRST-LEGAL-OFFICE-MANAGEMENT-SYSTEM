# Threat model and risk register

Status: **initial version, Phase 1**. Reviewed and updated at the end of
every phase and whenever the architecture changes.

Likelihood and impact use Low / Medium / High / Critical. The ratings
describe the risk **before** the planned mitigations. A mitigation counts
only when the listed verification has been run and its result recorded in
the [roadmap verification log](roadmap.md#verification-log).

## Assets

| Asset                                          | Why it matters                                                 |
| ---------------------------------------------- | -------------------------------------------------------------- |
| Client identities and contact details          | Personal data under Law 09-08; disclosure can harm clients     |
| Matter files, notes, evidence, court documents | Professional secrecy; disclosure can damage a case or a person |
| Hearings and deadlines                         | Missing one can cause legal harm to a client                   |
| Fees, invoices, payments                       | Financial integrity and tax obligations                        |
| Passwords, MFA secrets, recovery codes         | Lead directly to account takeover                              |
| Session cookies and reset tokens               | Lead directly to account takeover                              |
| Audit log                                      | Evidence of who did what; must resist tampering                |
| Backups and backup keys                        | A full copy of everything above                                |
| Server, admin and database credentials         | Full control of the system                                     |
| Source code and CI pipeline                    | Can be changed to add a backdoor                               |

## Trust boundaries

| ID  | Boundary                                  | Crossing it requires                                                            |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| B1  | Office device → office network            | Being on the office LAN or Wi-Fi                                                |
| B2  | Office network → proxy (HTTPS 443)        | A valid TLS connection; then a valid session for anything beyond the login page |
| B3  | Proxy → API → database, documents, ClamAV | Only reachable on internal Docker networks                                      |
| B4  | Administrator → server host               | SSH key from the admin machine                                                  |
| B5  | Server → backup media                     | Backup credentials and the restic key, kept apart                               |
| B6  | Developer → GitHub → CI → images          | GitHub account (with MFA), reviewed changes, pinned dependencies                |

## Threats

| ID  | Threat                                                                     | Entry point              | Likelihood | Impact   | Mitigation                                                                                                                                                                                           | Verification                                                                             |
| --- | -------------------------------------------------------------------------- | ------------------------ | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| T1  | Unauthorized outsider on the office network or guest Wi-Fi                 | B1, B2                   | Medium     | High     | Host firewall allows only the office subnet; guest Wi-Fi isolated; HTTPS only; no public exposure                                                                                                    | Port scan from LAN, guest Wi-Fi and outside                                              |
| T2  | Brute force or credential stuffing                                         | Login                    | Medium     | High     | Argon2id, password blocklist, rate limits per IP and per account with progressive delays, MFA, generic errors                                                                                        | Rate-limit and lockout tests                                                             |
| T3  | Account enumeration                                                        | Login, reset             | Medium     | Medium   | Same response and similar timing whether or not the account exists                                                                                                                                   | Tests comparing responses for existing and unknown accounts                              |
| T4  | Session theft, fixation or reuse                                           | Cookie                   | Low        | High     | Opaque random token, hashed in the database, `__Host-` cookie that is HttpOnly, Secure and SameSite=Strict; rotation at login and privilege change; idle and absolute expiry; server-side revocation | Session tests                                                                            |
| T5  | IDOR/BOLA: changing a client, matter, document or invoice ID               | Every route with an ID   | High       | Critical | Policy check on the exact resource and its parents, query scoping for lists and search, 404 for inaccessible objects                                                                                 | IDOR test grid: every role × every endpoint × own and other matter                       |
| T6  | Cross-matter disclosure through search, exports or reports                 | Search, export           | Medium     | Critical | Same query scoping used for search, exports and reports                                                                                                                                              | Tests with restricted matters                                                            |
| T7  | Mass assignment or privilege escalation                                    | Create and update routes | Medium     | High     | Strict Zod schemas with explicit writable fields; role changes are admin-only and need reauthentication                                                                                              | Tests sending extra fields (role, owner, matter ID)                                      |
| T8  | Malicious or compromised office user                                       | App                      | Medium     | High     | Least privilege by matter team, logged exports, audit trail, alerts on unusual activity                                                                                                              | Permission tests; audit assertions                                                       |
| T9  | Compromised administrator account                                          | Login, SSH               | Low        | Critical | Required MFA, reauthentication, admins cannot read matter content by default, SSH keys only                                                                                                          | Tests; configuration review                                                              |
| T10 | Malicious upload (malware, file disguised as another type, active content) | Upload                   | Medium     | High     | Type allowlist, file-signature detection, ClamAV quarantine, random storage names, downloads as attachment with `nosniff` and a sandbox CSP                                                          | Upload test set: EICAR test file, wrong signature, oversized file, path names with `../` |
| T11 | SQL injection                                                              | API                      | Low        | Critical | Prisma; every raw query reviewed and parameterized                                                                                                                                                   | Injection tests; code review rule                                                        |
| T12 | Cross-site scripting                                                       | Web                      | Medium     | High     | React escaping, no raw HTML rendering of user content, strict CSP without inline scripts                                                                                                             | Tests with script payloads; CSP check                                                    |
| T13 | Cross-site request forgery                                                 | API                      | Low        | High     | SameSite=Strict, session-bound CSRF token, Origin and Fetch Metadata checks                                                                                                                          | CSRF tests                                                                               |
| T14 | Path traversal                                                             | Document storage         | Low        | High     | Storage paths built from server-generated UUIDs only; original names never used as paths                                                                                                             | Traversal tests                                                                          |
| T15 | SSRF and open redirect                                                     | —                        | Low        | Medium   | The API does not fetch user-supplied URLs; redirects only to allowlisted internal paths                                                                                                              | Code review rule; tests if a redirect is added                                           |
| T16 | Stolen or unattended office computer                                       | Device                   | Medium     | High     | Short idle timeout, no data stored in browser storage, sign out all devices, device disk encryption (office policy)                                                                                  | Session timeout tests; office checklist                                                  |
| T17 | Stolen server or database files                                            | Hardware                 | Low        | Critical | Full-disk encryption on the server; MFA secrets encrypted by the app; session and reset tokens stored only as hashes                                                                                 | Restore drill on a new machine; check that a database dump has no usable tokens          |
| T18 | Stolen or exposed backups                                                  | Backup media             | Medium     | Critical | restic encryption; key kept apart from the media; restricted backup credentials                                                                                                                      | Attempt to restore without the key (must fail)                                           |
| T19 | Ransomware or accidental deletion                                          | Host, users              | Medium     | Critical | Offline backup copy, archive instead of hard delete, restricted host access                                                                                                                          | Quarterly restore test                                                                   |
| T20 | Dependency, image or supply-chain compromise                               | B6                       | Medium     | High     | Exact pinned versions, lockfile, `npm audit`, Trivy, gitleaks, images pinned by digest, GitHub MFA                                                                                                   | CI checks                                                                                |
| T21 | Misconfigured proxy, TLS, firewall or Docker networking                    | B2, B3                   | Medium     | High     | Reviewed Caddy config, HSTS, published port bound to the LAN IP only, `DOCKER-USER` firewall rules, database never published                                                                         | TLS check, port scan, `docker compose config` review                                     |
| T22 | Sensitive data in logs                                                     | Logs                     | Medium     | Medium   | Pino redaction list; no request bodies, document names or tokens in logs                                                                                                                             | Test asserting log output contains no secrets                                            |
| T23 | Tampering with the audit log                                               | Database                 | Low        | High     | Application role can only insert and read audit rows; each row chained to the previous row's hash; chain head copied with backups                                                                    | Integrity check test; privilege test                                                     |
| T24 | Loss of server, power or network                                           | Infrastructure           | Medium     | Medium   | UPS, documented restore on new hardware, agreed RPO/RTO                                                                                                                                              | Disaster-recovery drill                                                                  |
| T25 | Retention, deletion and Moroccan privacy obligations not met               | Process                  | —          | High     | [Privacy checklist](privacy-checklist.md) reviewed by a professional; retention rules built into archive and deletion                                                                                | Sign-off recorded before production                                                      |
| T26 | CSV / spreadsheet formula injection in exports                             | Exports                  | Medium     | Medium   | Cells starting with `=`, `+`, `-`, `@`, tab or carriage return are escaped                                                                                                                           | Export tests                                                                             |

## Risk register

Ranked before mitigation. Critical and High items must be mitigated and
verified, or explicitly accepted by the owner in writing, before the
[production gate](roadmap.md#production-gate).

| Rank         | Risks                                                                                                                                                                                                                                                                                                  | Phase that mitigates them |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| **Critical** | T5 IDOR/BOLA, T6 cross-matter disclosure, T9 admin takeover, T11 SQL injection, T17 stolen server, T18 exposed backups, T19 ransomware                                                                                                                                                                 | 3, 4, 9                   |
| **High**     | T1 outsider on the LAN, T2 brute force, T4 session theft, T7 mass assignment, T8 insider misuse, T10 malicious uploads, T12 XSS, T13 CSRF, T14 path traversal, T16 unattended device, T20 supply chain, T21 misconfiguration, T23 audit tampering, T25 privacy obligations, F2 outdated Docker Desktop | 2–9                       |
| **Medium**   | T3 enumeration, T15 SSRF/redirects, T22 logs, T24 infrastructure loss, T26 formula injection, F3 Node patch level, F4 repository visibility                                                                                                                                                            | 2–9                       |
| **Low**      | F5 private notes in Git                                                                                                                                                                                                                                                                                | 1                         |

## Findings from the Phase 0 audit

| ID  | Finding                                                                                                                     | Severity     | Status                                      | Resolution                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| F1  | No `.gitignore` or `.gitattributes`; secrets or dumps could be committed and scripts could get CRLF endings                 | High         | Verified                                    | Fixed in Phase 1                                                                                              |
| F2  | Docker Desktop on the development machine is probably older than 4.44.3 (Engine 27.5.1), which is affected by CVE-2025-9074 | High         | Suspected                                   | Open on 2026-10-18 (still Engine 27.5.1). Owner to update Docker Desktop                                      |
| F3  | Node.js 22.14.0 is behind on security patches; Node 24 is the Active LTS line                                               | Medium       | Version verified, missing patches suspected | Open on 2026-10-18 (still 22.14.0). Not blocking: CI and production use Node 24. Owner to install Node 24 LTS |
| F4  | GitHub repository visibility unknown                                                                                        | Medium       | Not yet tested                              | Owner to confirm it is private                                                                                |
| F5  | Private `CLAUDE.md` not excluded from Git                                                                                   | Low          | Verified                                    | Fixed: listed in `.git/info/exclude` and `.gitignore`                                                         |
| F6  | `main` has no commits, so phase branches cannot start from it                                                               | Process      | Verified                                    | Fixed: bootstrap commit made by the owner                                                                     |
| F7  | The development workstation (Windows, Docker Desktop) is not a suitable production host                                     | Architecture | Verified                                    | Dedicated Linux server ([ADR 0006](decisions/0006-deployment-host.md))                                        |

## Residual risks accepted by design

These remain after all planned controls. The owner must accept them before
production.

- Anyone with root access to the running server can read all data. Disk
  encryption protects only a server that is powered off.
- ClamAV detects known malware only. Targeted or new malware may pass, and
  there is no content disarm and reconstruction.
- The audit log can detect tampering through its hash chain, but a person
  with database owner or root access could rewrite it and its chain. It is
  tamper-evident only to the extent that chain heads are kept off the server.
- A user who is allowed to view a document can photograph or copy it. The
  system records the access but cannot prevent copying.

## Findings from Phase 2

| ID  | Finding                                                                                                                                                       | Severity | Status   | Resolution                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------- |
| F8  | npm installs missing peer dependencies at their newest version, which bypassed the 14-day dependency cooldown and produced duplicate copies of React and Vite | Medium   | Verified | Fixed: `overrides` in `package.json` and a full reinstall with `--before`                             |
| F9  | Prisma 7.10.0 depends on `deepmerge-ts` and `mysql2` versions with High advisories                                                                            | High     | Verified | Fixed: Prisma 7.10.1 (exception to the cooldown, recorded in [security.md](security.md#supply-chain)) |
| F10 | gitleaks's default rules do not detect passwords inside PostgreSQL connection strings                                                                         | Medium   | Verified | Fixed: project rule in `.gitleaks.toml`, proven against a real development `.env`                     |
| F11 | Readiness could falsely report the database as down for the first requests after an API restart                                                               | Low      | Verified | Fixed: the API connects to the database before accepting requests                                     |
| F12 | The baseline migration failed on Prisma's shadow database, so no new migration could be created                                                               | Medium   | Verified | Fixed: the migration checks that the table exists; verified with `migrate dev --create-only`          |
