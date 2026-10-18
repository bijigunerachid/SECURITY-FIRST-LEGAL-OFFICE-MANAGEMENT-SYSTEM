#!/bin/sh
# Runs once, when the PostgreSQL data volume is first created.
#
# Creates two roles, neither of them a superuser:
#   lexora_owner  owns the databases and schema; used only for migrations.
#   lexora_app    used by the running API; may read and write table rows but
#                 cannot create, alter or drop anything.
#
# And three databases, all owned by lexora_owner:
#   lexora_dev     development
#   lexora_test    automated tests
#   lexora_shadow  scratch database Prisma uses to check new migrations
#
# Passwords come from Docker secret files and are passed to psql as variables,
# so they never appear in this script, the image or the process list.
set -eu

# Fail with a clear message instead of a bare "Permission denied". If this
# script fails, the data folder is left behind and later starts skip
# initialisation, so the roles would silently never be created.
for name in lexora_owner_password lexora_app_password; do
  if [ ! -r "/run/secrets/$name" ]; then
    echo "10-roles.sh: /run/secrets/$name is missing or not readable by user $(id -un)." >&2
    echo "10-roles.sh: secret files must be readable inside the container (see secrets/README.md)." >&2
    exit 1
  fi
done

owner_password="$(cat /run/secrets/lexora_owner_password)"
app_password="$(cat /run/secrets/lexora_app_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="$owner_password" -v app_password="$app_password" <<'SQL'
CREATE ROLE lexora_owner LOGIN PASSWORD :'owner_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE lexora_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Stop runaway queries and abandoned transactions from the application.
ALTER ROLE lexora_app SET statement_timeout = '30s';
ALTER ROLE lexora_app SET idle_in_transaction_session_timeout = '60s';
SQL

for database in lexora_dev lexora_test lexora_shadow; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v db="$database" <<'SQL'
CREATE DATABASE :"db" OWNER lexora_owner;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
SQL

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" <<'SQL'
ALTER SCHEMA public OWNER TO lexora_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
done

# The application role may connect to the development and test databases
# only, and gets row-level rights on tables the owner creates there.
for database in lexora_dev lexora_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" -v db="$database" <<'SQL'
GRANT CONNECT ON DATABASE :"db" TO lexora_app;
GRANT USAGE ON SCHEMA public TO lexora_app;

ALTER DEFAULT PRIVILEGES FOR ROLE lexora_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lexora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lexora_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lexora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lexora_owner
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE lexora_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO lexora_app;
SQL
done
