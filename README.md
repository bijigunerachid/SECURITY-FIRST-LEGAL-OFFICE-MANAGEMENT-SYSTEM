# Lexora

Lexora is a security-first management system for a single law office in
Morocco: clients, matters, documents, hearings, invoices and payments, in
French and Arabic.

> **Status: documents (Phase 5).** Accounts, sign-in with a second factor,
> user administration, clients, matters, matter teams, parties,
> conflict-of-interest search, audited break-glass access and matter
> documents (upload with malware scanning, versions, download) work;
> hearings, deadlines and invoices come next. Do not enter real client data
> into any version of Lexora until the
> [production gate](docs/roadmap.md#production-gate) has been passed.

## Documentation

| Document                                                 | Contents                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Roadmap](docs/roadmap.md)                               | Phases, status, open decisions, production gate, verification log       |
| [Architecture](docs/architecture.md)                     | Components, technology, request flow, environments                      |
| [Threat model](docs/threat-model.md)                     | Assets, trust boundaries, threats, risk register, residual risks        |
| [Security design](docs/security.md)                      | Authentication, sessions, authorization, documents, encryption, logging |
| [Privacy and legal checklist](docs/privacy-checklist.md) | Questions for a Moroccan legal or privacy professional                  |
| [Decision records](docs/decisions/)                      | Why the main technical choices were made                                |

## Principles

- Deny by default. A valid login never grants access to every record.
- No public registration and no public internet exposure.
- No secrets in Git. Settings live in ignored env files and Docker secrets,
  validated at startup.
- Synthetic data only outside production.
- Every change ships with tests, and security claims are backed by tests
  that were actually run.

## Development setup

You need Node.js 24 LTS (22.13 or later also works), npm 11, and Docker
(Docker Desktop on Windows or macOS). Run every command from the repository
root.

```sh
npm ci                     # install exact versions; install scripts are disabled (.npmrc)
npm run generate           # generate the Prisma client
npm run setup:dev          # create random local passwords and apps/api/.env(.test)
npm run db:up              # start PostgreSQL (listens on 127.0.0.1:55432 only)
npm run db:migrate         # apply migrations to the development database
npx playwright install chromium   # browser for end-to-end tests (once)
```

Document uploads need the ClamAV malware scanner. It uses 1–2 GB of memory,
so it only runs when you start it; while it is stopped, every upload is
refused (nothing is ever stored unscanned):

```sh
npm run scanner:up         # ClamAV on 127.0.0.1:53310 (first start: about 2 minutes)
npm run scanner:down       # stop it again
```

Uploaded files are kept in `storage/documents-dev/` (ignored by Git).

Then, in two terminals:

```sh
npm run dev:api            # API on http://127.0.0.1:3000
npm run dev:web            # web app on http://127.0.0.1:5173
```

Create your first administrator account (on a server, this is the only way;
there is no web setup page):

```sh
npm run admin -w @lexora/api -- create --email you@cabinet.ma --name "Your Name"
```

It prints a single-use link, valid 30 minutes. Open it to choose a password,
then sign in at http://127.0.0.1:5173: you will be asked to set up an
authenticator app first, and to keep your recovery codes. An administrator
who loses their phone and recovery codes is recovered on the server with
`npm run admin -w @lexora/api -- recover --email you@cabinet.ma`.

`npm run setup:dev` never overwrites or prints a secret. Everything it
creates (`secrets/*`, `apps/api/.env`, `apps/api/.env.test`) is ignored by
Git. Run it again after pulling a new version: it adds any new settings to
your existing env files without changing the old ones.

End-to-end tests create their own synthetic accounts in the test database
(`apps/api/scripts/e2e-accounts.json`, via `npm run seed:e2e -w @lexora/api`);
the matter tests then create their own clients and matters through the app.
There is no demonstration data in the development database: sign in as the
administrator you created, create a lawyer account, and open matters as
that lawyer.

## Checks

These are the checks CI runs on every push and pull request. Run them before
asking for a merge:

| Command                    | What it checks                                                           |
| -------------------------- | ------------------------------------------------------------------------ |
| `npm run lint`             | ESLint, including security rules (no raw SQL strings, no raw HTML)       |
| `npm run format:check`     | Prettier formatting                                                      |
| `npm run typecheck`        | TypeScript strict mode in every workspace                                |
| `npm test`                 | Unit tests                                                               |
| `npm run test:integration` | Applies migrations to `lexora_test`, then tests against real PostgreSQL  |
| `npm run build`            | Production build of every workspace                                      |
| `npm run test:e2e`         | Playwright on the production build, desktop (1366 px) and phone (390 px) |
| `npm run audit:deps`       | `npm audit` for known vulnerabilities                                    |

`npm run test:e2e` needs `npm run build` first. If ports 3000 or 4173 are
used by other software, move the test servers, for example
`E2E_API_PORT=3310 E2E_WEB_PORT=4310 npm run test:e2e` (the fake malware
scanner uses `E2E_SCANNER_PORT`, default 53311) (in PowerShell, set
`$env:E2E_API_PORT` and `$env:E2E_WEB_PORT` first). CI also runs gitleaks over
the whole Git history and a Trivy scan (see `.github/workflows/ci.yml`).

## Database changes

1. Edit `apps/api/prisma/schema.prisma`.
2. `npm run db:migrate:create -w @lexora/api -- <short_name>` creates a
   migration without applying it, after checking it on the shadow database.
   Review the SQL.
3. `npm run db:migrate` applies it to the development database.

Never use `prisma migrate reset` or `prisma db push` against anything but
your own development database.

## Resetting the development database

Only if the development database holds nothing you need. This permanently
deletes it:

```sh
npm run db:down
docker volume rm lexora-dev_pgdata
```

If you also delete `secrets/` and `apps/api/.env*`, run `npm run setup:dev`
again before `npm run db:up`. The passwords in those files must match the
ones the database was created with, so delete them together or not at all.

Line endings are normalised to LF by `.gitattributes`, so scripts work the
same in Linux containers as on Windows.

## Reporting a security problem

Report suspected vulnerabilities privately to the repository owner. Do not
open a public issue, and never include real client data.
