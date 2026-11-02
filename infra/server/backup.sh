#!/usr/bin/env bash
# Nightly Lexora backup (ADR 0007), run by the host's scheduler as root:
#
#   LEXORA_DIR=/opt/lexora RESTIC_REPOSITORY=/srv/backup/lexora \
#   RESTIC_PASSWORD_FILE=/root/.lexora-restic-password infra/server/backup.sh
#
# 1. Takes a database dump, the document files with a SHA-256 manifest, and
#    the HTTPS certificate authority's keys.
# 2. Stores them in the restic repository (encrypted, deduplicated), checks
#    the repository and prunes old snapshots.
# 3. Restores the snapshot it just made into an isolated, network-less
#    PostgreSQL and a temporary folder, and checks that the database loads,
#    that every document file matches its hash, and that every document
#    version the database knows has its file.
# 4. Reports the result to Lexora (`admin backup-report`), so a failure
#    raises an alert for administrators.
#
# A backup counts as good only when all of this passes. Temporary copies
# (which hold client data) are deleted on exit, whatever happens.
set -Eeuo pipefail

: "${LEXORA_DIR:?set LEXORA_DIR to the folder holding compose.prod.yaml and .env.prod}"
: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD_FILE:?set RESTIC_PASSWORD_FILE}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE
RESTIC="${RESTIC:-restic}"
WORK_ROOT="${LEXORA_BACKUP_WORK:-/var/lib/lexora-backup}"
POSTGRES_IMAGE="postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873"

compose() {
  docker compose --env-file "$LEXORA_DIR/.env.prod" -f "$LEXORA_DIR/compose.prod.yaml" "$@"
}
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

umask 077
mkdir -p "$WORK_ROOT"
work="$(mktemp -d "$WORK_ROOT/run.XXXXXX")"
stage="$work/lexora"
restored="$work/restored"
check_db="lexora-restore-check-$$"
mkdir -p "$stage" "$restored"

report() {
  # The detail is a short, fixed phrase: never client data.
  compose exec -T api node dist/cli/admin.js backup-report --status "$1" --detail "$2" >/dev/null ||
    log "could not record the result in Lexora"
}

step="starting"
cleanup() {
  local status=$?
  docker rm -f "$check_db" >/dev/null 2>&1 || true
  rm -rf "$work"
  if [ "$status" -ne 0 ]; then
    log "backup FAILED during: $step"
    report failed "$step"
  fi
}
trap cleanup EXIT

# --- 1. Collect -------------------------------------------------------------------------
step="database dump"
log "$step"
compose exec -T db pg_dump -U postgres -d lexora --format=custom >"$stage/lexora.dump"
test -s "$stage/lexora.dump"

step="documents"
log "$step"
compose exec -T api tar -C /var/lib/lexora/documents -cf - store >"$stage/documents.tar"
compose exec -T api sh -c 'cd /var/lib/lexora/documents && find store -type f -exec sha256sum {} +' \
  >"$stage/documents.sha256"

step="certificate authority"
log "$step"
compose exec -T web tar -C /data -cf - caddy/pki >"$stage/caddy-pki.tar"

# --- 2. Store ---------------------------------------------------------------------------
step="restic backup"
log "$step"
"$RESTIC" backup --quiet --host lexora --tag lexora "$stage"

step="restic check"
log "$step"
"$RESTIC" check --quiet

step="restic forget"
"$RESTIC" forget --quiet --host lexora --tag lexora \
  --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune

# --- 3. Restore and verify ---------------------------------------------------------------
step="restore"
log "$step"
"$RESTIC" restore latest --quiet --host lexora --tag lexora --target "$restored"
# restic recreates the original absolute path under the target.
dump="$(find "$restored" -type f -name lexora.dump | head -1)"
test -s "$dump"
copy="$(dirname "$dump")"

step="document hashes"
log "$step"
mkdir -p "$work/files"
tar -C "$work/files" -xf "$copy/documents.tar"
if [ -s "$copy/documents.sha256" ]; then
  (cd "$work/files" && sha256sum --quiet -c "$copy/documents.sha256")
fi

step="database restore"
log "$step"
docker run -d --name "$check_db" --network none \
  -e POSTGRES_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" \
  "$POSTGRES_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$check_db" pg_isready -U postgres -q 2>/dev/null && break
  sleep 1
done
docker exec "$check_db" createdb -U postgres lexora
docker exec -i "$check_db" pg_restore -U postgres -d lexora --no-owner --no-privileges --exit-on-error \
  <"$copy/lexora.dump"

step="database contents"
log "$step"
sql() { docker exec "$check_db" psql -U postgres -d lexora -tAc "$1"; }
# Every database has at least the events of its own installation.
test "$(sql 'SELECT count(*) FROM audit_event')" -gt 0
# Every document version recorded in the database has its file in the backup.
missing=0
while read -r key; do
  [ -z "$key" ] && continue
  grep -q " store/$key\$" "$copy/documents.sha256" || missing=$((missing + 1))
done < <(sql 'SELECT storage_key FROM document_version')
test "$missing" -eq 0

step="report"
log "backup verified"
report ok "verified"
