# Security Audit Report — FTM Studio v3.0

## Executive Summary

| Field | Value |
|-------|-------|
| **Extension** | FTM Studio v3.0 |
| **Audit Date** | 2026-08-03 |
| **Overall Risk** | **LOW** |
| **Critical** | 0 found (3 fixed) |
| **High** | 0 found (9 fixed) |
| **Medium** | 0 found (11 fixed) |
| **Low/Open** | 0 unresolved security findings |

---

## Threat Mitigations

### ReDoS Protection (Progressive Scaling Probe)

| Old | New |
|-----|-----|
| 4 fixed probe strings, single 50ms budget | 3 progressively larger inputs, 15ms per probe |
| No growth detection | Rejects if time grows >10× between doublings |
| Total budget: up to 200ms | Total budget: max 45ms |

**How it works:**
1. Structural check: rejects known catastrophic patterns (`(a+)+`, `a**`, etc.) — zero cost
2. Progressive probe: tests with 16, 32, 64 character inputs
3. If any probe exceeds 15ms → reject
4. If time grows >10× between doublings → reject (exponential backtracking)

### CSV Formula Injection (Code Spans)

| Old | New |
|-----|-----|
| `'` prefix on risky cells | Backtick code span wrapping |
| Corrupts `+8801712345678` → `'+8801712345678` | Renders as `` `+8801712345678` `` (code span) |
| Visible corruption in output | Neutralizes formula, preserves data |

**Why code spans:** Markdown code spans (`` `...` ``) render as literal text. Excel/Sheets don't execute formulas inside code spans. The original data is preserved exactly.

### YAML Frontmatter Injection (Double Sanitization)

| Old | New |
|-----|-----|
| `yamlString(file.name)` only | `plain(file.name)` then `yamlString()` |
| Control chars could survive | `plain()` strips all U+0000–001F and U+007F first |

**Defense in depth:** Even if `yamlString()` has a gap, `plain()` has already removed all control characters that could break YAML structure.

### Polyglot File Defense (Structural Validation)

| Old | New |
|-----|-----|
| Magic byte check only | Magic bytes + structural validation |
| Polyglot PDF with JS payload passes | `%%EOF` marker required at end of file |
| Malformed ZIP passes as DOCX | End-of-central-directory signature verified |

**Structural checks:**
- **PDF:** Last 64 bytes must contain `%%EOF`
- **DOCX/XLSX/PPTX/EPUB:** ZIP end-of-central-directory record (PK\x05\x06) must exist

### Service Worker Keepalive

| Old | New |
|-----|-----|
| No keepalive during conversion | 10-second heartbeat while offscreen processes |
| Chrome kills SW after 30s idle | Heartbeat keeps SW alive |

**How it works:** When the bridge sends END to offscreen, it starts a 10s interval timer that pings the content script port. When the result comes back (or error/disconnect), the timer stops. The `__keepalive__` messages are ignored by the content script.

### DataTransfer Fallback (Multi-Strategy Injection)

| Old | New |
|-----|-----|
| Single DataTransfer attempt | 3 fallback strategies |
| Capture phase only | Both phases with per-event deduplication |
| Silently fails on hardened sites | Clipboard fallback with user notification |

**Strategies:**
1. **DataTransfer API** — standard method
2. **Property override** — direct `Object.defineProperty` on input.files
3. **Clipboard write** — copies markdown to clipboard, notifies user to paste

**React 18 compatibility:** Listeners at both capture and bubble phase ensure React synthetic events can't swallow interception.

### History Privacy

| Old | New |
|-----|-----|
| Raw filenames stored | Extension pattern only (`*.pdf`) |
| No expiry | 30-day auto-expiry |
| No dedup protection | UID prevents same-timestamp collisions |

**What's stored:** `{ file: "*.pdf", size: 12345, extension: ".pdf", timestamp: "2026-08-02T...", uid: "a1b2c3", outputSize: 6789 }`

**What's NOT stored:** `Salary_Swapnil_2025.pdf`, `Medical_Report.pdf`, or any other sensitive filename.

### Accessibility (Open Shadow DOM)

| Old | New |
|-----|-----|
| `mode: 'closed'` | `mode: 'open'` |
| No screen reader support | `role="alert"`, `aria-live="polite"` |
| No keyboard focus | Auto-focus Convert button after drop |
| Invisible to assistive tech | Visible to screen readers |

### Fail-Closed Feedback

| Old | New |
|-----|-----|
| Silent disable on config corruption | Visible error toast |
| User sees nothing, thinks it's a bug | "Settings corrupted — using defaults" |
| No recovery path | Falls back to defaults, extension remains functional |

---

## Threat Matrix

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| ReDoS in regex pipeline | Critical | Progressive scaling probe | ✅ Fixed |
| YAML frontmatter injection | Critical | `plain()` + `yamlString()` double sanitize | ✅ Fixed |
| CSV formula injection | Critical | Code span wrapping | ✅ Fixed |
| Polyglot files | High | Structural validation (%%EOF, ZIP EOCD) | ✅ Fixed |
| Service worker death mid-conversion | High | Keepalive heartbeat | ✅ Fixed |
| DataTransfer rejection by sites | High | Multi-strategy + clipboard fallback | ✅ Fixed |
| History PII leak | High | Extension-only filenames, 30-day expiry | ✅ Fixed |
| Silent failure on config corruption | Medium | Visible error toast + defaults fallback | ✅ Fixed |
| Screen reader inaccessibility | Medium | Open shadow, role="alert", auto-focus | ✅ Fixed |
| Binary file disguise | Medium | Magic bytes + structural validation | ✅ Fixed |
| Memory exhaustion (large files) | Medium | Streaming transport, bounded preallocated reassembly, and size checks | ✅ Fixed |
| PDF password-protected | Medium | Clear error message | ✅ Fixed |
| Domain blacklist bypass | Low | Exact/suffix hostname matching | ✅ Fixed |
| Offscreen creation race | Low | Promise-based mutex | ✅ Fixed |
| `<all_urls>` permission | Low | Required for explicit Classic Mode; Smart Mode registers only configured hosts | Accepted |
| Library hash drift | Low | SHA-256 lockfile and `npm run verify:libs` | Accepted |

---

## Positive Findings

| Feature | Status |
|---------|--------|
| Streaming binary transport (512KB chunks) | ✅ |
| Capture + bubble phase interception | ✅ |
| Open Shadow DOM for accessibility | ✅ |
| Magic byte + structural file validation | ✅ |
| Progressive scaling ReDoS protection | ✅ |
| Code span CSV sanitization | ✅ |
| Double YAML injection sanitization | ✅ |
| Keepalive heartbeat during conversion | ✅ |
| Multi-strategy file injection with fallback | ✅ |
| Privacy-safe history (extension-only names) | ✅ |
| 30-day history auto-expiry | ✅ |
| Visible error on config corruption | ✅ |
| Auto-focus Convert button | ✅ |
| `isEvalSupported: false` in PDF.js | ✅ |
| CSP in manifest (`script-src 'self'`) | ✅ |
| Library lockfile with SHA-256 hashes | ✅ |
| Refcounted offscreen lifecycle | ✅ |
| Smart Mode activation control (220+ hosts) | ✅ |
| Content size limits (50MB/10MB/10MB) | ✅ |
| History write debouncing (2s) | ✅ |
| Responsive UI (300px+ popup width) | ✅ |
| Collapsible sections (Output, File Formats) | ✅ |
| GPU-only splash animation | ✅ |
| `prefers-reduced-motion` support | ✅ |

---

## Test Coverage

144 tests across 11 test files:

| File | Tests | Coverage |
|------|-------|----------|
| `config.test.js` | 9 | Config defaults, merge, prototype pollution |
| `documents.test.js` | 13 | PDF line clustering, table detection, cell rendering |
| `history.test.js` | 5 | Privacy, merging, expiry, cap, failed write |
| `pipeline.test.js` | 9 | Binary transport, oversized files, routing, formula injection |
| `postprocess.test.js` | 14 | Frontmatter, TOC, cover artifacts, heading hierarchy, ReDoS |
| `sources.test.js` | 8 | Source compilation, manifest, service worker loading |
| `text.test.js` | 26 | RTF parser, CSV sanitization, YAML, HTML entities, base64 |
| `worker.test.js` | 12 | Offscreen lifecycle, bridge, registrar, session protocol |
| `converters.test.js` | 14 | Text, RTF, image, offscreen converters, CSV streaming |
| `messages.test.js` | 28 | BEGIN/CHUNK/END validation, ACK, RESULT, port trust |
| `archives.test.js` | 6 | EPUB and PPTX parser registration and error handling |

---

## Conclusion

FTM Studio v3.0 addresses all identified security threats with defense-in-depth strategies. The extension maintains 100% local processing with zero network requests, privacy-safe history, and progressive security hardening.

**Risk Rating:** LOW  
**Accepted low-risk items:** `<all_urls>` remains required for explicit Classic Mode; vendor integrity is enforced by the library lockfile.

Licensing and third-party attribution are documented in [LICENSE](LICENSE),
[NOTICE.md](NOTICE.md), and the SPDX `license` field in `package.json`.

---

*Audit: 2026-08-08 · Version: 3.0.0 · Tests: 144 passing*
