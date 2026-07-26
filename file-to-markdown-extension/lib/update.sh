#!/usr/bin/env bash
# ===========================================================================
# lib/update.sh — Download and verify third-party libraries
# Usage: ./lib/update.sh [library-name]
#   Without args: verify all libraries against lockfile hashes
#   With args:    update specific library (e.g., ./lib/update.sh pdfjs)
# ===========================================================================

set -euo pipefail

LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCKFILE="$LIB_DIR/lockfile.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

verify_hash() {
  local file="$1"
  local expected="$2"
  if [ ! -f "$file" ]; then
    echo -e "${RED}MISSING${NC} $file"
    return 1
  fi
  local actual
  actual=$(sha256sum "$file" | cut -d' ' -f1)
  if [ "$actual" = "$expected" ]; then
    echo -e "${GREEN}OK${NC}      $file"
    return 0
  else
    echo -e "${RED}MISMATCH${NC} $file"
    echo "  Expected: $expected"
    echo "  Actual:   $actual"
    return 1
  fi
}

download_lib() {
  local name="$1"
  local url="$2"
  local expected_hash="$3"

  echo -e "${YELLOW}Downloading${NC} $name..."
  curl -sL "$url" -o "$LIB_DIR/$name"

  local actual
  actual=$(sha256sum "$LIB_DIR/$name" | cut -d' ' -f1)
  if [ "$actual" = "$expected_hash" ]; then
    echo -e "${GREEN}Verified${NC}  $name (sha256: ${actual:0:16}...)"
  else
    echo -e "${RED}HASH MISMATCH${NC} for $name"
    echo "  Expected: $expected_hash"
    echo "  Actual:   $actual"
    echo "  The CDN may have updated. Check the source URL."
    return 1
  fi
}

# ── Verify mode (no args) ──
if [ $# -eq 0 ]; then
  echo "Verifying libraries against lockfile..."
  echo ""
  failures=0

  verify_hash "$LIB_DIR/mammoth.browser.min.js" "596ef52239e52d8ee3cee10b2ee4a72596abf900d0e4f468593f956e9f1809b0" || ((failures++))
  verify_hash "$LIB_DIR/xlsx.mini.min.js" "3120abba1fd0ea031f25ab22ac93e726f6f63467da1a6349b82e82f3df5d775c" || ((failures++))
  verify_hash "$LIB_DIR/jszip.min.js" "acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e" || ((failures++))
  verify_hash "$LIB_DIR/turndown.min.js" "fd0e2aa0785c13c39fa1ddc0b3b19520e541b69801c1369ea4aabfe7913a0dea" || ((failures++))
  verify_hash "$LIB_DIR/pdf.min.js" "5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946" || ((failures++))
  verify_hash "$LIB_DIR/pdf.worker.min.js" "feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b" || ((failures++))
  verify_hash "$LIB_DIR/papaparse.min.js" "b8e870c5d2b29772f10c9fa9a693c8b896aac8540ed6701e3cc6304c683febdb" || ((failures++))

  echo ""
  if [ $failures -eq 0 ]; then
    echo -e "${GREEN}All 7 libraries verified.${NC}"
  else
    echo -e "${RED}$failures library(ies) failed verification.${NC}"
    exit 1
  fi
  exit 0
fi

# ── Update mode ──
case "$1" in
  mammoth)
    download_lib "mammoth.browser.min.js" \
      "https://cdn.jsdelivr.net/npm/mammoth@latest/mammoth.browser.min.js" \
      "596ef52239e52d8ee3cee10b2ee4a72596abf900d0e4f468593f956e9f1809b0"
    ;;
  xlsx)
    download_lib "xlsx.mini.min.js" \
      "https://cdn.sheetjs.com/xlsx-0.18.5/package/dist/xlsx.mini.min.js" \
      "3120abba1fd0ea031f25ab22ac93e726f6f63467da1a6349b82e82f3df5d775c"
    ;;
  jszip)
    download_lib "jszip.min.js" \
      "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js" \
      "acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e"
    ;;
  turndown)
    download_lib "turndown.min.js" \
      "https://cdn.jsdelivr.net/npm/turndown@3.4.7/dist/turndown.min.js" \
      "fd0e2aa0785c13c39fa1ddc0b3b19520e541b69801c1369ea4aabfe7913a0dea"
    ;;
  pdfjs)
    download_lib "pdf.min.js" \
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js" \
      "5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946"
    download_lib "pdf.worker.min.js" \
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js" \
      "feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b"
    ;;
  papaparse)
    download_lib "papaparse.min.js" \
      "https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js" \
      "b8e870c5d2b29772f10c9fa9a693c8b896aac8540ed6701e3cc6304c683febdb"
    ;;
  all)
    echo "Updating all libraries..."
    for lib in mammoth xlsx jszip turndown pdfjs papaparse; do
      $0 "$lib" || echo -e "${YELLOW}Warning: $lib update may have hash mismatch (check CDN)${NC}"
    done
    ;;
  *)
    echo "Usage: $0 [mammoth|xlsx|jszip|turndown|pdfjs|papaparse|all]"
    echo "  No args = verify all libraries"
    exit 1
    ;;
esac
