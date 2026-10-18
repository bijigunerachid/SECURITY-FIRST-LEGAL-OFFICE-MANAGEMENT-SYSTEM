# Architecture decision records

Each record explains one important decision: the context, the choice, the
alternatives and the consequences. Records are never deleted. A changed
decision gets a new record that supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-modular-monolith-and-stack.md) | Modular monolith and technology stack | Accepted |
| [0002](0002-server-side-sessions.md) | Opaque server-side sessions with hashed tokens | Accepted |
| [0003](0003-authorization-model.md) | Role plus matter-membership authorization; row-level security postponed | Accepted |
| [0004](0004-document-storage.md) | Private file storage with quarantine and malware scanning | Accepted |
| [0005](0005-postgresql-for-sessions-limits-jobs.md) | PostgreSQL for sessions, rate limits and background jobs (no Redis) | Accepted |
| [0006](0006-deployment-host.md) | Dedicated Linux server with Docker Engine | Accepted, hardware pending (D1) |
| [0007](0007-backups.md) | Encrypted backups with restic and an offline copy | Accepted, targets pending (D6, D7) |
