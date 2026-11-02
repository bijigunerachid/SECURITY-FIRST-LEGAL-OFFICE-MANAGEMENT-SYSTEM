#!/bin/sh
# Creates the production secret files for compose.prod.yaml.
#
#   sudo sh infra/server/create-secrets.sh /etc/lexora/secrets
#
# - Random values from the kernel's generator; passwords are 32 bytes of
#   hex (64 characters, no characters that need escaping in a URL).
# - Never overwrites an existing file and never prints a secret.
# - The folder is 0700 (root only). Files are 0644 so the database, API and
#   migration containers, which run as their own users, can read the copies
#   Docker gives them; nobody else can open the folder.
#
# The restic password is NOT created here: it is chosen by the owner, kept
# in a password manager and a sealed envelope, never on backup media (ADR 0007).
set -eu

dir="${1:?usage: create-secrets.sh <secrets folder>}"
umask 077
mkdir -p "$dir"
chmod 700 "$dir"

random_hex() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

# write <name> <value>: creates the file unless it already exists.
write() {
  if [ -e "$dir/$1" ]; then
    echo "kept:    $1 (already exists)"
    return
  fi
  printf '%s' "$2" > "$dir/$1"
  chmod 644 "$dir/$1"
  echo "created: $1"
}

write postgres_superuser_password "$(random_hex)"
write lexora_owner_password "$(random_hex)"
write lexora_app_password "$(random_hex)"
# 32-byte key, base64, for second-factor secrets (MFA_ENCRYPTION_KEY).
write mfa_encryption_key "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"

# Connection strings built from the passwords above (database "lexora" on the
# internal "db" service).
owner="$(cat "$dir/lexora_owner_password")"
app="$(cat "$dir/lexora_app_password")"
write database_url "postgresql://lexora_app:${app}@db:5432/lexora"
write migration_database_url "postgresql://lexora_owner:${owner}@db:5432/lexora"

echo "Secrets are in $dir. Keep a copy of mfa_encryption_key with the backups' password: without it, second factors cannot be read after a restore."
