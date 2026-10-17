#!/usr/bin/env bash
#
# Apply BROC's migrations to any PostgreSQL 15+ database, in order, exactly
# once each.
#
#   DATABASE_URL=postgresql://... ./migrate.sh
#   DATABASE_URL=postgresql://... ./migrate.sh --dry-run
#   DATABASE_URL=postgresql://... ./migrate.sh --verify
#
# Works against Supabase Cloud, a self-hosted Supabase, or a plain Postgres.
# Requires psql on the PATH (apt install postgresql-client).
#
# Why a ledger table rather than just re-running every file: migrations 001-007
# predate the re-runnable convention and will fail on a second pass. Everything
# from 008 on is written to be idempotent, but relying on that to paper over a
# missing ledger means a failure mode that only shows up on someone else's
# server, months later.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
VERIFY_SQL="$REPO_ROOT/supabase/verify_install.sql"

DRY_RUN=0
VERIFY_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --verify)  VERIFY_ONLY=1 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^#\s\?//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  echo "  Supabase Cloud: Project Settings -> Database -> Connection string -> URI" >&2
  exit 2
fi

command -v psql >/dev/null || { echo "psql not found. Install postgresql-client." >&2; exit 2; }

psql_q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX "$@"; }

if [[ "$VERIFY_ONLY" == 1 ]]; then
  [[ -f "$VERIFY_SQL" ]] || { echo "missing $VERIFY_SQL" >&2; exit 1; }
  exec psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$VERIFY_SQL"
fi

echo "==> Connecting"
server_version="$(psql_q -c 'SHOW server_version;')"
echo "    PostgreSQL $server_version"

# The ledger lives in the application schema so it travels with a pg_dump of
# the database and an operator can see it in Studio. A dry run must leave the
# database untouched, so it reads the ledger without creating it.
if [[ "$DRY_RUN" == 0 ]]; then
  psql_q -c "
    SET client_min_messages = warning;
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version     text        PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      checksum    text
    );
  " >/dev/null
fi

ledger_exists="$(psql_q -c "SELECT to_regclass('public.schema_migrations') IS NOT NULL;")"

applied_count=0
skipped_count=0

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [[ ${#migrations[@]} -eq 0 ]]; then
  echo "No migrations found in $MIGRATIONS_DIR" >&2
  exit 1
fi

for file in "${migrations[@]}"; do
  version="$(basename "$file" .sql)"
  sum="$(sha256sum "$file" | cut -c1-16)"

  if [[ "$ledger_exists" == "t" ]]; then
    existing="$(psql_q -c "SELECT coalesce(checksum, '-') FROM public.schema_migrations WHERE version = '$version';")"
  else
    existing=""
  fi

  if [[ -n "$existing" ]]; then
    if [[ "$existing" != "$sum" && "$existing" != "-" ]]; then
      echo "    ~ $version  (already applied, but the file has changed since)"
    else
      echo "    . $version"
    fi
    skipped_count=$((skipped_count + 1))
    continue
  fi

  if [[ "$DRY_RUN" == 1 ]]; then
    echo "    + $version  (would apply)"
    applied_count=$((applied_count + 1))
    continue
  fi

  echo "    + $version"

  # The migration and its ledger row go in one transaction, so a failure
  # leaves the database exactly as it was and the run can simply be repeated.
  tmp="$(mktemp)"
  {
    cat "$file"
    printf "\nINSERT INTO public.schema_migrations (version, checksum) VALUES ('%s', '%s')\n  ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum;\n" "$version" "$sum"
  } > "$tmp"

  if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$tmp"; then
    rm -f "$tmp"
    echo >&2
    echo "FAILED on $version. Nothing from that migration was applied." >&2
    echo "Fix the cause and re-run; migrations already applied will be skipped." >&2
    exit 1
  fi
  rm -f "$tmp"
  applied_count=$((applied_count + 1))
done

echo
echo "==> $applied_count applied, $skipped_count already present"

if [[ "$DRY_RUN" == 1 ]]; then
  echo "    (dry run — nothing was written)"
  exit 0
fi

if [[ -f "$VERIFY_SQL" ]]; then
  echo
  echo "==> Verifying"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$VERIFY_SQL"
fi
