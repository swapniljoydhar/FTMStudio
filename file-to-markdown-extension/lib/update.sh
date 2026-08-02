#!/usr/bin/env bash
# ===========================================================================
# lib/update.sh — Download and verify third-party libraries
# ===========================================================================
# Usage:
#   ./lib/update.sh              verify every file against lockfile.json
#   ./lib/update.sh <file.js>    re-download one entry and verify it
#   ./lib/update.sh all          re-download everything and verify
#
# Names, URLs and hashes come from lockfile.json, so the lockfile is the only
# place a version is recorded (they used to be duplicated in this script).
# ===========================================================================

set -euo pipefail

LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCKFILE="$LIB_DIR/lockfile.json"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

lock_names() {
  python3 -c "import json,sys; print('\n'.join(json.load(open(sys.argv[1]))['libraries']))" "$LOCKFILE"
}

lock_field() {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['libraries'][sys.argv[2]][sys.argv[3]])" "$LOCKFILE" "$1" "$2"
}

verify() {
  local name="$1" expected actual
  expected="$(lock_field "$name" sha256_hex)"
  if [ ! -f "$LIB_DIR/$name" ]; then
    printf "${RED}MISSING${NC}  %s\n" "$name"; return 1
  fi
  actual="$(sha256sum "$LIB_DIR/$name" | cut -d' ' -f1)"
  if [ "$actual" = "$expected" ]; then
    printf "${GREEN}OK${NC}       %s (%s)\n" "$name" "$(lock_field "$name" version)"
  else
    printf "${RED}MISMATCH${NC} %s\n  expected: %s\n  actual:   %s\n" "$name" "$expected" "$actual"; return 1
  fi
}

download() {
  local name="$1" url code
  url="$(lock_field "$name" source)"
  printf "${YELLOW}Downloading${NC} %s\n" "$name"
  code="$(curl -sL -w '%{http_code}' -o "$LIB_DIR/$name.tmp" "$url")"
  if [ "$code" -lt 200 ] || [ "$code" -ge 400 ] || [ ! -s "$LIB_DIR/$name.tmp" ]; then
    rm -f "$LIB_DIR/$name.tmp"
    printf "${RED}DOWNLOAD FAILED${NC} %s (HTTP %s)\n" "$name" "$code"; return 1
  fi
  mv "$LIB_DIR/$name.tmp" "$LIB_DIR/$name"
  verify "$name"
}

verify_all() {
  local failures=0 total=0
  while read -r name; do
    total=$((total + 1))
    verify "$name" || failures=$((failures + 1))
  done < <(lock_names)
  echo ""
  if [ "$failures" -eq 0 ]; then
    printf "${GREEN}All %s libraries verified.${NC}\n" "$total"
  else
    printf "${RED}%s of %s libraries failed verification.${NC}\n" "$failures" "$total"; return 1
  fi
}

case "${1:-}" in
  "")   echo "Verifying libraries against lockfile..."; echo ""; verify_all ;;
  all)  while read -r name; do download "$name" || true; done < <(lock_names); echo ""; verify_all ;;
  *)    download "$1" ;;
esac
