# Phase 3 — Rewrite and Verification Record

**Updated:** 2026-08-03
**Target:** `file-to-markdown-extension/`

## Completed changes

- Strengthened BEGIN/CHUNK/END validation and ordered chunk handling.
- Replaced repeated offscreen buffer growth with bounded preallocation.
- Added active-parse tracking before releasing parser libraries.
- Deduplicated capture/bubble interception for a single DOM event.
- Applied category settings to the effective sniffed file type.
- Cached and coalesced background configuration broadcasts.
- Reduced repeated popup site-stat scans with a removal `Set`.
- Removed timed-out library script elements and deduplicated in-flight loads.
- Removed the unused npm `tesseract.js` development dependency.

## Verification

- Manifest V3 service worker remains unchanged and valid.
- No `innerHTML`, `document.write`, `eval`, or `new Function` exists in first-party code.
- All port senders remain sender-ID validated.
- All parser libraries remain local and lazily loaded.
- Vendor versions and SHA-256 hashes are verified by `npm run verify:libs`.
- Apache-2.0 licensing and third-party attribution are documented in `LICENSE` and `NOTICE.md`.
- 87 tests pass and ESLint reports zero errors.

The unrestricted host permission is retained because Classic Mode is an explicit feature that must work on arbitrary sites. Smart Mode continues to restrict dynamic registration and activation.
