# Contributing to Lexora

Lexora holds information covered by professional secrecy. Every change is
judged first on whether it keeps that information safe. Read
[docs/security.md](docs/security.md) and [docs/architecture.md](docs/architecture.md)
before your first change.

## Workflow

1. Start from an up-to-date `main`: `git switch main && git pull`.
2. One branch per piece of work: `feature/<name>`, `fix/<name>` or
   `docs/<name>`.
3. Make the change **with its tests and its documentation** (below).
4. Run every check (below) and record real results.
5. Open a pull request. CI must be green: lint, types, unit, integration,
   end-to-end, build, dependency audit, secret scan, Trivy (repository and
   images). The owner reviews and merges.

Never commit secrets, real client data, `.env` files or the files in
`secrets/`. `CLAUDE.md` and `HANDOFF.md` are personal notes, excluded
through `.git/info/exclude`.

## Setting up

See the [README](README.md#development-setup): Node.js 24, Docker,
`npm ci`, `npm run generate`, `npm run setup:dev`, `npm run db:up`,
`npm run db:migrate`, `npm run db:migrate:test`.

## Checks (all must pass)

| Command                                     | What it checks                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run lint`                              | ESLint, zero warnings (type-aware rules, accessibility rules)                             |
| `npm run format:check`                      | Prettier                                                                                  |
| `npm run typecheck`                         | TypeScript in the three workspaces                                                        |
| `npm test`                                  | Unit tests (shared, API, web)                                                             |
| `npm run test:integration`                  | API against a real PostgreSQL (`lexora_test`)                                             |
| `npm run build`                             | Production build                                                                          |
| `npm run test:e2e`                          | Playwright, desktop 1366 px and phone 390 px, with axe accessibility checks (build first) |
| `npm run audit:deps`                        | npm audit, every severity, except documented and expiring exceptions                      |
| `docker build --target api\|web\|migrate .` | The production images still build                                                         |

On a machine where ports 3000 and 4173 are taken, run end-to-end tests with
`E2E_API_PORT=3310 E2E_WEB_PORT=4310 npm run test:e2e -- --workers=2`.

## Rules

- **Authorization in one place.** Every rule about who may do what lives in
  `apps/api/src/modules/policy/`. Services ask the policy; lists use its
  query scopes. A record the user cannot see answers 404.
- **Strict input.** Every request body, query and path is parsed with a
  strict Zod schema from `packages/shared`; unknown fields are refused. The
  server never takes an owner, matter or amount from the client when it can
  derive it.
- **The database is the last line.** History is not deleted: revoke
  `DELETE`/`UPDATE` from the application role, add `CHECK` constraints and
  triggers in a hand-written migration, and test them in a
  `*-tables.int.test.ts` file with the application's own credentials.
- **Audit** every security-relevant action (`recordAudit`), with IDs and
  field names only, never values, passwords, tokens or document content.
- **Raw SQL** only through tagged templates (`$queryRaw`), listed in
  docs/security.md ("Raw queries in use").
- **Time.** Office dates and times are computed by the server
  (Africa/Casablanca); the web app never converts time zones itself.
- **French and Arabic.** Every string in both `fr.json` and `ar.json`;
  layouts work right-to-left; codes and numbers in Arabic text sit in a
  left-to-right isolate.
- **Dependencies.** Exact versions; a release must be 14 days old
  (`npm install --before=<date>`); any exception is written in
  docs/security.md ("Supply chain") with an expiry. Images are pinned by
  digest.
- **No placeholder data** in the app. Demo data only from seed scripts.

## Checklists

### Every change

- [ ] Tests: unit for logic, integration (real database) for routes and
      rules, end-to-end for user journeys.
- [ ] Each important control proven: break it, see a test fail, restore it.
- [ ] Docs updated: README, architecture, security, threat model, roadmap
      (with a verification entry: what was run and the real results).
- [ ] UI changes: screenshots at 1366 px and 390 px, French and Arabic, no
      sideways scrolling, axe clean.

### A new endpoint

- [ ] Zod schema in `packages/shared`, strict.
- [ ] Policy check on the exact record and its parents; 404 when unseen.
- [ ] Added to the access grid test (every kind of user).
- [ ] Audit event; rate limit if it can be abused (search, export, upload).

### A migration

- [ ] Generated with `npm run db:migrate:create -w @lexora/api -- <name>`,
      hand-written hardening appended (constraints, revokes, triggers).
- [ ] Applied to development and test databases; table rules tested.
- [ ] Safe to apply on a database that already holds data.

### A release to the office server

- [ ] CI green on `main`.
- [ ] Backup verified the night before (alerts page clean).
- [ ] On the server: `git pull`, `lexora build`, `lexora --profile tools run --rm migrate`,
      `lexora up -d`, `lexora ps` all healthy
      ([server-setup.md](docs/operations/server-setup.md)).
