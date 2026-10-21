# 0005 — PostgreSQL for sessions, rate limits and background jobs (no Redis)

Status: Accepted (2026-10-18). The background-jobs part (pg-boss) is replaced by
[ADR 0008](0008-in-house-scheduler.md); rate limits use a small fixed-window
limiter of our own (Phase 3).

## Context

Sessions, rate-limit counters and background jobs all need shared storage
that survives restarts. Redis is common for this, but it is another service
to secure, patch and monitor.

## Decision

Store sessions, rate-limit counters (rate-limiter-flexible with its
PostgreSQL store) and background jobs (pg-boss) in PostgreSQL.

## Consequences

- One data service to secure and back up.
- Load is tiny for one office, so performance is not a concern.
- Rate-limit and job tables are excluded from long-term retention.
