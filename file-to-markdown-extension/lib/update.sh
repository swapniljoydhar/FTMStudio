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
  local http_code
  http_code=$(curl -sL -w '%{http_code}' -o "$LIB_DIR/$name" "$url")

  if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 400 ]; then
    echo -e "${RED}DOWNLOAD FAILED${NC} for $name (HTTP $http_code)"
    rm -f "$LIB_DIR/$name"
    return 1
  fi

  if [ ! -s "$LIB_DIR/$name" ]; then
    echo -e "${RED}DOWNLOAD FAILED${NC} for $name (empty file)"
    rm -f "$LIB_DIR/$name"
    return 1
  fi

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

  verify_hash "$LIB_DIR/mammoth.browser.min.js" "7be06532b3edfef02ce8878dcb1d3a473d37f97018450b44b02397943fb76e26" || ((failures++))
  verify_hash "$LIB_DIR/xlsx.mini.min.js" "3120abba1fd0ea031f25ab22ac93e726f6f63467da1a6349b82e82f3df5d775c" || ((failures++))
  verify_hash "$LIB_DIR/jszip.min.js" "84327f63cf26fafd49b7d318c4a4a4a9d0606228a54f6d6f07e61d1029d694ac" || ((failures++))
  verify_hash "$LIB_DIR/turndown.min.js" "8744cc00d5299f7a12984db79807947318c4d915a9d73f75acd3e51657ac7e1a" || ((failures++))
  verify_hash "$LIB_DIR/pdf.min.js" "e0e389e9807b2d82bebd05622e2c699a7a9a3ef279b687c1393d81244b0c31f8" || ((failures++))
  verify_hash "$LIB_DIR/pdf.worker.min.js" "fd7a073fe718f2a4c2fb95ec0a834e3774ba8ab74ccaf1797a99da6592fcc600" || ((failures++))
  verify_hash "$LIB_DIR/papaparse.min.js" "5cdfaca6e7f550399be8488c7ef241e028543019a6a26dcca1a5f019775b8e85" || ((failures++))
  verify_hash "$LIB_DIR/turndown-plugin-gfm.min.js" "fb5bb3316ea198a531f1fb1104553879fd62086841bded17effe324e5571cd95" || ((failures++))

  echo ""
  if [ $failures -eq 0 ]; then
    echo -e "${GREEN}All 8 libraries verified.${NC}"
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
      "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js" \
      "7be06532b3edfef02ce8878dcb1d3a473d37f97018450b44b02397943fb76e26"
    ;;
  xlsx)
    download_lib "xlsx.mini.min.js" \
      "https://cdn.sheetjs.com/xlsx-0.18.5/package/dist/xlsx.mini.min.js" \
      "3120abba1fd0ea031f25ab22ac93e726f6f63467da1a6349b82e82f3df5d775c"
    ;;
  jszip)
    download_lib "jszip.min.js" \
      "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js" \
      "84327f63cf26fafd49b7d318c4a4a4a9d0606228a54f6d6f07e61d1029d694ac"
    ;;
  turndown)
    download_lib "turndown.min.js" \
      "https://cdn.jsdelivr.net/npm/turndown@3.4.7/dist/turndown.min.js" \
      "8744cc00d5299f7a12984db79807947318c4d915a9d73f75acd3e51657ac7e1a"
    ;;
  turndown-gfm)
    download_lib "turndown-plugin-gfm.min.js" \
      "https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.min.js" \
      "fb5bb3316ea198a531f1fb1104553879fd62086841bded17effe324e5571cd95"
    ;;
  pdfjs)
    download_lib "pdf.min.js" \
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js" \
      "e0e389e9807b2d82bebd05622e2c699a7a9a3ef279b687c1393d81244b0c31f8"
    download_lib "pdf.worker.min.js" \
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js" \
      "fd7a073fe718f2a4c2fb95ec0a834e3774ba8ab74ccaf1797a99da6592fcc600"
    ;;
  papaparse)
    download_lib "papaparse.min.js" \
      "https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js" \
      "5cdfaca6e7f550399be8488c7ef241e028543019a6a26dcca1a5f019775b8e85"
    ;;
  all)
    echo "Updating all libraries..."
    for lib in mammoth xlsx jszip turndown turndown-gfm pdfjs papaparse; do
      $0 "$lib" || echo -e "${YELLOW}Warning: $lib update may have hash mismatch (check CDN)${NC}"
    done
    ;;
  *)
    echo "Usage: $0 [mammoth|xlsx|jszip|turndown|turndown-gfm|pdfjs|papaparse|all]"
    echo "  No args = verify all libraries"
    exit 1
    ;;
esac
