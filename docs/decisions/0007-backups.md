# 0007 — Encrypted backups with restic and an offline copy

Status: Accepted (2026-10-18). Targets to be confirmed (decisions D6, D7).

## Context

The office must survive ransomware, accidental deletion, hardware failure and
theft. Backups contain everything and must be encrypted, and at least one copy
must be out of reach of a compromised server.

## Decision

- restic: encrypted, deduplicated, with built-in integrity checks.
- Each run takes a consistent `pg_dump` of the database and a snapshot of the
  document volume, plus a manifest listing document hashes.
- Copies: a nightly local repository on a separate disk, and at least two
  rotated USB drives that are disconnected when not in use, one kept
  off-site.
- The restic password is never stored on backup media. It is kept in a
  password manager and in a sealed envelope held by a named person.
- Backups run from the host's scheduler, not from a container with access to
  the Docker socket.
- A backup counts as good only after `restic check` passes **and** an
  automated restore into an isolated database matches the manifest.
- Provisional targets: RPO 24 hours, RTO 1 working day.

## Alternatives considered

- **Cloud backup**: not chosen by default; may need CNDP authorization if the
  provider is abroad (see the [privacy checklist](../privacy-checklist.md)).
- **Plain `pg_dump` files with `age`**: workable, but restic adds
  deduplication, retention rules and integrity checks.

## Consequences

- Someone in the office must rotate the USB drives on a fixed schedule.
- Losing the restic password makes backups unrecoverable, so key custody must
  be documented and tested.
