#!/usr/bin/env bash
# Applies every migration to a throwaway database and runs the assertions in supabase/tests/.
# Needs a reachable PostgreSQL (PGHOST, PGPORT, PGUSER, PGPASSWORD as usual) whose user may create databases.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="orbita_sql_test_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1"; }
run supabase/tests/stub.sql
for migration in supabase/migrations/*.sql; do run "$migration"; done
run supabase/tests/sync_push.test.sql
