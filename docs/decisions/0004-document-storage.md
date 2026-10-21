# 0004 — Private file storage with quarantine and malware scanning

Status: Accepted (2026-10-18)

## Context

Uploaded documents are untrusted and highly confidential. They may be large,
so storing them inside PostgreSQL would make backups and restores slow.

## Decision

- Files live on a private Docker volume mounted only into the API and worker.
- Storage names are random UUIDs; original names are cleaned and kept only as
  metadata, never used to build a path.
- The database stores the SHA-256 hash, size, detected type and scan status,
  so files and metadata can be checked against each other after a restore.
- Uploads are streamed to a quarantine folder with a size limit, the type is
  detected from the file's bytes and checked against an allowlist, ClamAV
  scans the file, and only clean files are moved into storage.
- Downloads are authorized on every request and sent as attachments with
  `nosniff`, a sandbox CSP and `no-store`. No in-app preview at first.

## Alternatives considered

- **Files in PostgreSQL**: rejected for backup size and restore time.
- **S3-compatible object storage (MinIO)**: rejected for now; one more
  service to secure, with no benefit on a single server.
- **Content disarm and reconstruction**: not included; no maintained,
  self-hosted option fits the project scope. Recorded as a residual risk.

## Consequences

- Backups must capture the database and the document volume together.
- ClamAV needs regular signature updates and about 1–2 GB of memory.

## Review after Phase 5 (2026-10-21)

Built as decided, with these details:

- Uploads are sent as the raw file body (`application/octet-stream`, name in
  `X-File-Name`) rather than as multipart forms, so no form parser is
  needed.
- The type check reads only a ZIP's table of contents; nothing is unpacked.
- Scanning fails closed. Development runs ClamAV only on request because of
  its memory use; automated tests use a protocol-compatible fake, and CI
  also tests the real ClamAV.
- Documents have immutable versions; deleting hides a document and keeps
  its files.
- Downloads are checked against the stored SHA-256 as they are sent.
