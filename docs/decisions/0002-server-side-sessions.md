# 0002 — Opaque server-side sessions with hashed tokens

Status: Accepted (2026-10-18)

## Context

Users must be signed out immediately when an account is disabled, a password
is reset or a role changes. Stolen database copies must not give access.
Tokens must never be readable by JavaScript.

## Decision

- A random 32-byte token is sent only in the `__Host-lexora_session` cookie
  (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`).
- The `session` table stores the SHA-256 hash of the token, the user, creation
  time, last activity, absolute expiry, MFA state and a CSRF secret.
- Each request looks up the hash. Idle (30 min) and absolute (10 h) expiry
  are enforced on the server.
- A new token is issued at login, after MFA and after privilege changes.
- Revocation deletes the rows.

A small session module is written in the project instead of using
`express-session`, because `express-session` stores the raw session ID as the
database key, so a database copy would contain usable session IDs. The module
uses only Node's `crypto` module and is covered by dedicated tests.

## Alternatives considered

- **JWT access and refresh tokens**: rejected; revocation needs a server-side
  list anyway, and tokens are often stored where JavaScript can read them.
- **`express-session` with a PostgreSQL store**: rejected for the raw-ID
  storage reason above.

## Consequences

- One database lookup per request, which is negligible at this scale.
- Session code is security-critical and must keep full test coverage.
