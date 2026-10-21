# 0003 — Role plus matter-membership authorization; row-level security postponed

Status: Accepted (2026-10-18)

## Context

A valid login must not open every client, matter, document or invoice. Some
matters must be hidden even from other lawyers (conflicts of interest). IDOR
is the highest-ranked risk in the [threat model](../threat-model.md).

## Decision

- Roles (`admin`, `lawyer`, `assistant`) define what kinds of action a user
  may take.
- Matter membership defines which records the user may take them on.
  Clients, documents, hearings and invoices inherit access from their
  matters.
- One policy module exposes `can(user, action, resource)` and query-scoping
  helpers. Services call it for every operation; lists, search, exports and
  reports use the scoping helpers.
- Inaccessible records return 404.
- Administrators do not see matter content by default (decision D2, pending
  confirmation). Break-glass access is time-limited, requires a reason and
  reauthentication, and is audited.

## Row-level security

PostgreSQL row-level security is **postponed** and will be reconsidered
after Phase 4. With Prisma's connection pool, it needs every request wrapped
in a transaction that sets the current user, and any query that misses this
either fails or, if policies are written loosely, leaks data. That adds
complexity and new ways to go wrong. The application policy layer, backed by
an IDOR test grid covering every endpoint, is the primary control. If RLS is
added later, it is a second layer, never a replacement.

## Consequences

- Every new endpoint must go through the policy layer and be added to the
  IDOR test grid. Code review checks this.
- A bug in the policy layer is not caught by the database, which is why the
  test grid is mandatory.

## Review after Phase 4 (2026-10-21)

Implemented as decided, in `apps/api/src/modules/policy/matter-policy.ts`.
Two refinements:

- A record the user cannot see answers 404; a record the user can see but
  may not change answers 403 (the user already knows it exists).
- Administrators never get access through membership, even one held before
  a role change; break-glass grants are the only way in.

Row-level security stays postponed. The access grid (every kind of user
against every client and matter endpoint), the query-scope tests and the
checks made by breaking the policy on purpose all pass, and the database
already refuses deletes of clients, matters and grants. This will be
reviewed again when documents arrive (Phase 5).
