#!/usr/bin/env bash
#
# Stand up a self-hosted Supabase next to BROC on a single machine.
#
#   ./selfhost.sh /opt/broc-supabase
#
# This orchestrates Supabase's own self-hosting bundle rather than vendoring a
# copy of it. Their docker compose is a dozen services — Postgres, Auth,
# PostgREST, Realtime, Storage, the API gateway, Studio — and it changes. A
# snapshot pasted into this repo would be wrong within months and wrong in a
# way nobody notices until an install fails. So: pin a release, fetch it, and
# fill in the parts that are ours.
#
# Pinned deliberately. Read Supabase's release notes before moving it.
SUPABASE_REF="self-hosted/v0.8.1"

set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "usage: $0 <directory to install Supabase into>" >&2
  echo "example: $0 /opt/broc-supabase" >&2
  exit 2
fi

command -v git    >/dev/null || { echo "git not found" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker not found" >&2; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 not found" >&2; exit 2; }

if [[ -e "$TARGET" && -n "$(ls -A "$TARGET" 2>/dev/null)" ]]; then
  echo "$TARGET already exists and is not empty. Refusing to overwrite it." >&2
  exit 1
fi

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

echo "==> Fetching Supabase $SUPABASE_REF"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --depth 1 --branch "$SUPABASE_REF" https://github.com/supabase/supabase "$tmp/supabase" --quiet

mkdir -p "$TARGET"
cp -rf "$tmp/supabase/docker/." "$TARGET"
cp "$TARGET/.env.example" "$TARGET/.env"
printf 'ref=%s\n' "$SUPABASE_REF" > "$TARGET/.supabase-version"

echo "==> Generating secrets"
# Lengths are Supabase's requirements, not arbitrary: SECRET_KEY_BASE >= 64,
# VAULT_ENC_KEY exactly 32, REALTIME_DB_ENC_KEY exactly 16, PG_META_CRYPTO_KEY
# >= 32. Alphanumeric only — punctuation in POSTGRES_PASSWORD breaks the
# connection strings some of the services assemble by hand.
POSTGRES_PASSWORD="$(rand 40)"
DASHBOARD_USERNAME="broc"
DASHBOARD_PASSWORD="$(rand 28)"
SECRET_KEY_BASE="$(rand 64)"
VAULT_ENC_KEY="$(rand 32)"
REALTIME_DB_ENC_KEY="$(rand 16)"
PG_META_CRYPTO_KEY="$(rand 40)"

set_env() {  # set_env KEY VALUE — replace in place, or append if absent
  local k="$1" v="$2" f="$TARGET/.env"
  if grep -qE "^${k}=" "$f"; then
    python3 - "$f" "$k" "$v" <<'PY'
import sys, io
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3]
lines = io.open(path, encoding='utf-8').read().split('\n')
out = [f'{key}={val}' if l.startswith(key + '=') else l for l in lines]
io.open(path, 'w', encoding='utf-8').write('\n'.join(out))
PY
  else
    printf '%s=%s\n' "$k" "$v" >> "$f"
  fi
}

set_env POSTGRES_PASSWORD    "$POSTGRES_PASSWORD"
set_env DASHBOARD_USERNAME   "$DASHBOARD_USERNAME"
set_env DASHBOARD_PASSWORD   "$DASHBOARD_PASSWORD"
set_env SECRET_KEY_BASE      "$SECRET_KEY_BASE"
set_env VAULT_ENC_KEY        "$VAULT_ENC_KEY"
set_env REALTIME_DB_ENC_KEY  "$REALTIME_DB_ENC_KEY"
set_env PG_META_CRYPTO_KEY   "$PG_META_CRYPTO_KEY"
chmod 600 "$TARGET/.env"

cat <<INFO

==> Supabase bundle is in $TARGET

Two things this script will not guess for you:

  1. URLs. Edit $TARGET/.env and set SUPABASE_PUBLIC_URL, API_EXTERNAL_URL and
     SITE_URL to the address users will actually reach — a hostname or a LAN
     IP, not localhost, unless this only ever serves the machine it runs on.
     Auth redirects break in confusing ways when these are wrong.

  2. API keys. Supabase generates its publishable and secret keys with its own
     tooling, and the mechanism has changed across releases. Follow
     https://supabase.com/docs/guides/self-hosting/docker for $SUPABASE_REF,
     then copy the resulting values into BROC's deploy/.env as
     NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.

Then:

    cd $TARGET && docker compose pull && sh run.sh start

    # wait for Postgres, then from this repo:
    DATABASE_URL='postgresql://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres' \\
      ./deploy/migrate.sh

    cd deploy && ./preflight.sh && docker compose up -d --build

Studio:  http://<host>:8000   user $DASHBOARD_USERNAME
BROC:   http://<host>:3000

The generated credentials are in $TARGET/.env (mode 600). Back that file up
somewhere real — losing VAULT_ENC_KEY or SECRET_KEY_BASE means losing data
that was encrypted with them.
INFO
