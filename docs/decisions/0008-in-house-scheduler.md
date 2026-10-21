# 0008 — A small in-house scheduler instead of pg-boss

Status: Accepted (2026-10-21). Replaces the pg-boss part of
[ADR 0005](0005-postgresql-for-sessions-limits-jobs.md).

## Context

ADR 0005 planned background jobs with pg-boss, stored in PostgreSQL. When
Phase 6 started, the current pg-boss (12.37) was checked before adding it:

- It creates its own schema and tables when it starts, and creates more
  tables while running (a partition per queue and for queue statistics,
  `CREATE TABLE … PARTITION OF …`). The application's database role would
  need the right to create tables, which Phase 2 deliberately removed.
- It adds four runtime dependencies and releases very often (eight releases
  in the three weeks before this decision).

Lexora's background work is a handful of periodic tasks for one office:
reminders, removing expired sessions and rate-limit windows, and removing
abandoned uploads. There are no user-triggered jobs yet.

## Decision

- A `scheduled_task` table lists each periodic task, its interval and when it
  is next due. Rows are created by migrations; the application role may only
  update the run-tracking columns (it cannot add, remove or reschedule tasks).
- The worker (`src/worker.ts`, same code and image as the API, separate
  process) checks every 30 seconds. It claims a due task with one
  conditional `UPDATE` (due, and not leased by another worker), runs it, and
  records the result. A crashed run is retried after its 10-minute lease.
- Several workers may run at once; each task still runs once per interval.
- `npm run worker -w @lexora/api -- --once` runs every task immediately (for
  operators and tests).

## Consequences

- No new dependency, no new database privilege.
- Task outcomes are visible in `scheduled_task` (status and a short summary,
  never error details or personal data; details go to the worker log).
- If user-triggered jobs with retries are needed later (exports, bulk
  operations), this decision will be reviewed; pg-boss could then be added
  with its schema created by a migration and its runtime table creation
  reviewed.
