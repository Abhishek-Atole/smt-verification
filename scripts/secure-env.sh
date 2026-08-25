#!/usr/bin/env bash
#
# secure-env.sh — harden the project's .env files and (optionally) rotate secrets.
#
# Secrets are NEVER printed. All generation uses `openssl rand`. Every file that
# is modified is backed up first (chmod 600) and rewritten atomically; only the
# targeted KEY= lines change, everything else is preserved byte-for-byte.
#
# TIERS (additive flags; no flag = dry-run report, changes nothing):
#   --harden          chmod 600 + backup every .env file.          SAFE / reversible.
#   --rotate-license  regenerate VITE_LICENSE_HMAC_KEY.            Needs confirm.
#                      · invalidates any issued license (must re-issue);
#                      · needs a frontend restart to load;
#                      · also ships in the client bundle, so this is hardening,
#                        not true secrecy.
#   --rotate-seeds    regenerate SEED_*_PASSWORD.                  Needs confirm.
#                      · only affects a future DB re-seed, not live users.
#   --rotate-weak     alias for --rotate-license + --rotate-seeds.
#   --rotate-shared  regenerate AUDIT_HMAC_SECRET / JWT_SECRET /    DANGEROUS.
#                    JWT_ADMIN_SECRET / QR_SIGNING_KEY.
#                      · AUDIT_HMAC_SECRET  -> breaks the audit-log HMAC chain
#                        (all past rows fail verify until a stop+rebase).
#                      · JWT_SECRET/ADMIN   -> logs every user/admin out.
#                      · QR_SIGNING_KEY     -> invalidates every printed QR/label.
#   --yes            skip the interactive typed confirmation for rotations.
#
# DATABASE_URL and ANTHROPIC_API_KEY are never rotated or synced (the DB-URL
# divergence between prod and .env.dev is intentional).
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
ROOT="$(dirname -- "$SCRIPT_DIR")"

ENV_FILES=( ".env" ".env.dev" "artifacts/feeder-scanner/.env" "artifacts/api-server/.env" )

WEAK_KEYS=( "VITE_LICENSE_HMAC_KEY" )          # + any SEED_*_PASSWORD found at runtime
SHARED_KEYS=( "AUDIT_HMAC_SECRET" "JWT_SECRET" "JWT_ADMIN_SECRET" "QR_SIGNING_KEY" )
NEVER_KEYS=( "DATABASE_URL" "ANTHROPIC_API_KEY" )

DO_HARDEN=0; DO_LICENSE=0; DO_SEEDS=0; DO_SHARED=0; ASSUME_YES=0
for a in "$@"; do case "$a" in
  --harden) DO_HARDEN=1 ;;
  --rotate-license) DO_LICENSE=1 ;;
  --rotate-seeds) DO_SEEDS=1 ;;
  --rotate-weak) DO_LICENSE=1; DO_SEEDS=1 ;;
  --rotate-shared) DO_SHARED=1 ;;
  --yes) ASSUME_YES=1 ;;
  *) echo "unknown flag: $a" >&2; exit 2 ;;
esac; done

# ---- helpers (none echo secret values) --------------------------------------
gen_key() { openssl rand -hex 32; }                                   # 64 hex chars
gen_pw()  { openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24; }

getval() { # $1 file $2 key  -> value on stdout (captured, never shown)
  grep -m1 -E "^[[:space:]]*$2=" "$1" 2>/dev/null \
    | sed -E "s/^[[:space:]]*$2=//; s/^['\"]//; s/['\"][[:space:]]*\$//" || true
}
haskey() { grep -qE "^[[:space:]]*$2=" "$1" 2>/dev/null; }

classify() { # $1 value -> EMPTY|PLACEHOLDER|WEAK|ok  (value never printed)
  local v="$1"
  [ -z "$v" ] && { echo EMPTY; return; }
  if printf '%s' "$v" | grep -qiE 'change-?me|your[-_]?|placeholder|example|xxxx+|secret-here|<[^>]+>'; then
    echo PLACEHOLDER; return; fi
  [ "${#v}" -lt 16 ] && { echo WEAK; return; }
  echo ok
}

ensure_ignored() { # abort rather than risk a secret-bearing backup entering git
  local rel="$1"
  if ! git -C "$ROOT" check-ignore -q -- "$rel" 2>/dev/null; then
    echo "REFUSING: backup path '$rel' is not git-ignored." >&2; exit 3
  fi
}

declare -A _BACKED_UP
backup() { # $1 abs file ; $2 rel path — idempotent per run (never clobbers the original backup)
  [ -n "${_BACKED_UP[$1]:-}" ] && return 0
  local ts bak; ts="$(date +%Y%m%d-%H%M%S)"; bak="$1.bak-$ts"
  ensure_ignored "$2.bak-$ts"
  cp -p -- "$1" "$bak"; chmod 600 -- "$bak"
  _BACKED_UP[$1]=1
  echo "    backed up -> $(basename -- "$bak")"
}

replace_key() { # $1 abs file $2 key $3 value  (atomic, only the KEY= line changes)
  local tmp; tmp="$(mktemp -- "$1.tmpXXXXXX")"
  awk -v k="$2" -v v="$3" '
    $0 ~ "^[[:space:]]*" k "=" { print k "=\"" v "\""; next } { print }
  ' "$1" > "$tmp"
  chmod 600 -- "$tmp"; mv -- "$tmp" "$1"
}

confirm() { # $1 = message ; requires typing YES unless --yes
  [ "$ASSUME_YES" = 1 ] && return 0
  echo; echo "$1"; printf "  type YES to proceed: "
  local ans; read -r ans; [ "$ans" = "YES" ]
}

# expand SEED_*_PASSWORD found in any file into the weak set
seed_keys() {
  { for f in "${ENV_FILES[@]}"; do [ -f "$ROOT/$f" ] && \
      grep -oE '^[[:space:]]*SEED_[A-Z0-9_]*PASSWORD' "$ROOT/$f" | tr -d ' '; done; } \
    | sort -u
}

# ---- 1. always: report ------------------------------------------------------
echo "== permissions (effective / dereferenced) =="
for f in "${ENV_FILES[@]}"; do
  [ -e "$ROOT/$f" ] && printf "  %s%s  %s\n" "$(stat -L -c '%a' "$ROOT/$f")" "$([ -L "$ROOT/$f" ] && echo ' (symlink)')" "$f"
done

echo; echo "== secret classification (values never shown) =="
mapfile -t SEED_KEYS < <(seed_keys)
ALL_KEYS=( "${WEAK_KEYS[@]}" "${SEED_KEYS[@]}" "${SHARED_KEYS[@]}" "${NEVER_KEYS[@]}" )
for k in "${ALL_KEYS[@]}"; do
  line="  $k:"
  for f in "${ENV_FILES[@]}"; do
    [ -f "$ROOT/$f" ] || continue
    haskey "$ROOT/$f" "$k" || continue
    line+=" [$(basename "$(dirname "$ROOT/$f")")/$(basename "$f")=$(classify "$(getval "$ROOT/$f" "$k")")]"
  done
  echo "$line"
done

if [ "$DO_HARDEN$DO_LICENSE$DO_SEEDS$DO_SHARED" = "0000" ]; then
  echo; echo "DRY RUN — no changes. Re-run with --harden and/or --rotate-license / --rotate-seeds / --rotate-shared."
  exit 0
fi

# ---- 2. harden --------------------------------------------------------------
if [ "$DO_HARDEN" = 1 ]; then
  echo; echo "== hardening perms to 600 (backup first) =="
  echo "  NOTE: if a systemd service runs as a *different* user than the file owner,"
  echo "        600 will lock it out — use 640 + shared group there instead."
  for f in "${ENV_FILES[@]}"; do
    [ -f "$ROOT/$f" ] || continue
    [ -L "$ROOT/$f" ] && { echo "  $f -> symlink; target hardened via its own entry"; continue; }
    echo "  $f"; backup "$ROOT/$f" "$f"; chmod 600 -- "$ROOT/$f"; echo "    perms -> 600"
  done
fi

# ---- 3a. rotate license key ------------------------------------------------
if [ "$DO_LICENSE" = 1 ]; then
  if confirm "ROTATE VITE_LICENSE_HMAC_KEY to a new strong value.
  · Any already-issued/installed license STOPS validating (must re-issue).
  · Frontend must be restarted to load it; it also ships in the client bundle."; then
    for k in "${WEAK_KEYS[@]}"; do
      val="$(gen_key)"; n=0
      for f in "${ENV_FILES[@]}"; do [ -f "$ROOT/$f" ] && [ ! -L "$ROOT/$f" ] && haskey "$ROOT/$f" "$k" \
        && { backup "$ROOT/$f" "$f"; replace_key "$ROOT/$f" "$k" "$val"; n=$((n+1)); }; done
      echo "  rotated $k across $n file(s)"; unset val
    done
  else echo "  skipped license rotation."; fi
fi

# ---- 3b. rotate seed passwords ---------------------------------------------
if [ "$DO_SEEDS" = 1 ]; then
  if confirm "ROTATE SEED_*_PASSWORD to new strong values.
  · Only affects a future DB re-seed, not existing users."; then
    for k in "${SEED_KEYS[@]}"; do
      val="$(gen_pw)"; n=0
      for f in "${ENV_FILES[@]}"; do [ -f "$ROOT/$f" ] && [ ! -L "$ROOT/$f" ] && haskey "$ROOT/$f" "$k" \
        && { backup "$ROOT/$f" "$f"; replace_key "$ROOT/$f" "$k" "$val"; n=$((n+1)); }; done
      echo "  rotated $k across $n file(s)"; unset val
    done
  else echo "  skipped seed rotation."; fi
fi

# ---- 4. rotate shared (dangerous) ------------------------------------------
if [ "$DO_SHARED" = 1 ]; then
  if confirm "ROTATE shared server secrets — DESTRUCTIVE:
  · AUDIT_HMAC_SECRET -> breaks audit-log chain verification (needs API stop + rebase).
  · JWT_SECRET / JWT_ADMIN_SECRET -> logs every user and admin out.
  · QR_SIGNING_KEY -> invalidates every already-printed QR/label.
  Restart api-server afterwards."; then
    for k in "${SHARED_KEYS[@]}"; do
      val="$(gen_key)"; n=0
      for f in "${ENV_FILES[@]}"; do [ -f "$ROOT/$f" ] && [ ! -L "$ROOT/$f" ] && haskey "$ROOT/$f" "$k" \
        && { [ "$DO_HARDEN" = 1 ] || backup "$ROOT/$f" "$f"; replace_key "$ROOT/$f" "$k" "$val"; n=$((n+1)); }; done
      echo "  rotated $k across $n file(s)"; unset val
    done
  else echo "  skipped shared rotation."; fi
fi

echo; echo "Done. Restart affected services for changes to take effect:"
echo "  sudo systemctl restart smtverify-api smtverify-frontend"
