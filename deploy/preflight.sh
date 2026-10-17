#!/usr/bin/env bash
#
# Check a deployment before it fails at three in the morning.
#
#   ./preflight.sh
#
# Reads the actual source rather than trusting .env.example, so it stays
# correct as the code changes.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/.env"
fails=0
warns=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails+1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; warns=$((warns+1)); }

echo
echo "Prerequisites"
for c in docker node psql; do
  if command -v "$c" >/dev/null; then ok "$c $( "$c" --version 2>/dev/null | head -1 )"
  else
    case "$c" in
      psql) warn "psql not found — needed only to run migrate.sh (apt install postgresql-client)" ;;
      *)    bad  "$c not found" ;;
    esac
  fi
done
if docker compose version >/dev/null 2>&1; then ok "docker compose $(docker compose version --short 2>/dev/null)"
else bad "docker compose v2 not available"; fi

echo
echo "Build configuration"
if grep -qE "output:\s*['\"]standalone['\"]" "$REPO_ROOT/next.config.ts" 2>/dev/null; then
  ok "next.config.ts sets output: 'standalone'"
else
  bad "next.config.ts does not set output: 'standalone' — the Docker build will fail at the COPY of .next/standalone"
fi

echo
echo "Environment"
if [[ ! -f "$ENV_FILE" ]]; then
  bad "no .env in deploy/ (cp .env.example .env)"
else
  ok ".env present"

  # Every variable the code actually reads.
  mapfile -t used < <(
    grep -rhoE "process\.env\.[A-Z0-9_]+" \
      "$REPO_ROOT/app" "$REPO_ROOT/lib" "$REPO_ROOT/components" 2>/dev/null \
      | sed 's/.*process\.env\.//' | sort -u
  )

  # Variables Next or the runtime provide; not ours to set.
  builtin_re='^(NODE_ENV|PORT|HOSTNAME|VERCEL.*|NEXT_RUNTIME|NEXT_TELEMETRY_DISABLED|npm_.*)$'

  # Read by the code but genuinely optional, each with a built-in default:
  # white-label branding and which SSO buttons the login page shows. Absent is
  # a fine answer, so it is a note rather than a problem. (Both are inlined at
  # BUILD time; docker-compose.yml passes them to the image build, so a change
  # needs `docker compose up -d --build`.)
  optional_re='^(NEXT_PUBLIC_PRODUCT_.*|NEXT_PUBLIC_SSO_.*)$'

  for v in "${used[@]}"; do
    [[ "$v" =~ $builtin_re ]] && continue
    line="$(grep -E "^${v}=" "$ENV_FILE" 2>/dev/null | head -1)"
    value="${line#*=}"
    if [[ -z "$line" && "$v" =~ $optional_re ]]; then
      warn "$v not set (optional; the built-in default applies)"
    elif [[ -z "$line" ]]; then
      bad "$v is read by the code but absent from .env"
    elif [[ -z "$value" ]]; then
      warn "$v is empty (fine if the feature it gates is unused)"
    else
      ok "$v set"
    fi
  done

  # The three that are never optional.
  for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
    val="$(grep -E "^${v}=" "$ENV_FILE" 2>/dev/null | head -1)"; val="${val#*=}"
    [[ -z "$val" ]] && bad "$v must be set — BROC cannot start without it"
  done

  # A service-role key in a NEXT_PUBLIC_ variable would be shipped to every
  # browser that loads the app. Worth one line of paranoia.
  if grep -qE "^NEXT_PUBLIC_[A-Z0-9_]*(SERVICE|SECRET|PRIVATE)" "$ENV_FILE"; then
    bad "a NEXT_PUBLIC_ variable holds something named SERVICE/SECRET/PRIVATE — it will be compiled into the browser bundle"
  fi
fi

echo
echo "Migrations"
n=$(ls -1 "$REPO_ROOT"/supabase/migrations/*.sql 2>/dev/null | wc -l)
[[ "$n" -gt 0 ]] && ok "$n migration files found" || bad "no migrations in supabase/migrations/"
if [[ -n "${DATABASE_URL:-}" ]] && command -v psql >/dev/null; then
  pending="$(DATABASE_URL="$DATABASE_URL" "$(dirname "${BASH_SOURCE[0]}")/migrate.sh" --dry-run 2>/dev/null | grep -c 'would apply')"
  [[ "$pending" == "0" ]] && ok "database is up to date" || warn "$pending migration(s) pending — run ./migrate.sh"
else
  warn "DATABASE_URL not exported; skipped the pending-migration check"
fi

echo
if [[ "$fails" -gt 0 ]]; then
  echo "$fails problem(s), $warns warning(s). Fix the problems before deploying."
  exit 1
fi
echo "Ready. $warns warning(s)."
