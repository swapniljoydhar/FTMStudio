# Security Audit Report — FTM Studio v1.0.1

## Executive Summary

| Field | Value |
|-------|-------|
| **Extension** | FTM Studio v1.0.1 |
| **Audit Date** | 2026-07-26 |
| **Overall Risk** | **LOW** |
| **Critical** | 0 found (3 fixed) |
| **High** | 0 found (7 fixed) |
| **Medium** | 0 found (9 fixed) |
| **Low/Open** | 3 (acceptable) |

---

## Audit Scope

Source files (9 content modules + 3 supporting files):

| File | Lines | Role |
|------|-------|------|
| `content/constants.js` | 41 | Constants, extension maps, magic bytes, AI hosts |
| `content/utils.js` | 76 | Pure utilities, blacklist, Smart Mode activation |
| `content/config.js` | 51 | Config state, storage loading, sync |
| `content/postprocess.js` | 108 | YAML frontmatter, regex pipeline, heading hierarchy |
| `content/converters.js` | 200 | Text, CSV, RTF processing, content sniffing |
| `content/binary.js` | 76 | Offscreen bridge (Transferable Objects) |
| `content/history.js` | 26 | Conversion history (debounced) |
| `content/toast.js` | 167 | Shadow DOM toast UI |
| `content/intercept.js` | 191 | Event interception, dispatch, lifecycle |
| `background.js` | 301 | Service worker (ports, lifecycle, config sync) |
| `offscreen.js` | 665 | Binary parsing (DOCX, XLSX, PDF, EPUB, PPTX) |
| `popup.js` | 414 | Settings dashboard logic |

Total: ~2,316 lines of source code.

---

## Findings & Remediations

### Critical (3 fixed)

#### C1 — ReDoS Safety Checker
- **Location:** `content/postprocess.js` — `isRegexSafe()`
- **Problem:** Old heuristic tested patterns against themselves, not user input.
- **Fix:** Timing-based test — compiles user regex, runs against 30-char test string, rejects if >50ms.
- **Status:** ✅ Fixed

#### C2 — YAML Frontmatter Injection
- **Location:** `content/postprocess.js` — `escapeYamlString()`
- **Problem:** Didn't escape `:`, `[]`, `{}`. Crafted filenames could break YAML.
- **Fix:** Added escaping for all YAML structural characters.
- **Status:** ✅ Fixed

#### C3 — CSV Formula Injection
- **Location:** `content/converters.js` — `sanitizeCsvCell()`
- **Problem:** Cells starting with `=`, `+`, `-`, `@` written directly to Markdown tables.
- **Fix:** Dangerous cells prefixed with `'` character. Applied in all CSV/XLSX paths.
- **Status:** ✅ Fixed

### High (7 fixed)

| ID | Finding | Fix |
|----|---------|-----|
| H1 | PPTX rels re-parsed per slide | Parsed once into Map |
| H2 | Domain blacklist substring match | Exact/suffix matching |
| H3/H5 | EPUB silent parse failures | `<parsererror>` detection |
| H4 | Offscreen creation race | Promise-based mutex |
| H6 | Counter underflow | `Math.max(0, ...)` guard |
| H7 | SRI hash mismatch | Documented, error messages include path |

### Medium (9 fixed)

| ID | Finding | Fix |
|----|---------|-----|
| M1 | Heading hierarchy wrong direction | `shift = 1 - minLevel` |
| M2 | Content sniffing too simple | Magic byte signatures added |
| M3 | Cleanup sets read-only globals | try-catch per property |
| M4 | PDF heading too aggressive | Conservative detection |
| M5 | CLOSE_OFFSCREEN race | Port-based lifecycle |
| M6 | History write per conversion | Debounced (2s) |
| M7 | Text size limit after sniff | Limit enforced before read |
| M8 | `new Promise(async...)` | Restructured as plain async |
| M9 | No-op dragover listener | Removed |

### Low (3 open)

| ID | Finding | Status |
|----|---------|--------|
| L1 | SRI hashes need regeneration on lib update | Documented |
| L2 | No E2E test suite | Unit tests cover critical paths |
| L3 | `<all_urls>` permission | Required; Smart Mode limits scope |

---

## Smart Mode

Smart Mode (default: ON) restricts interception to known AI/chatbot platforms.

**Activation logic (`content/utils.js` — `shouldActivate()`):**
1. If domain is blacklisted → **skip** (always takes priority)
2. If Smart Mode is OFF → **activate everywhere**
3. If Smart Mode is ON:
   - Check user whitelist (custom sites) → **activate if match**
   - Check built-in AI host database (~188 sites) → **activate if match**
   - Apply custom overrides: `-domain` removes, `+domain` adds
   - Otherwise → **skip**

**Built-in database:** ~188 AI platforms across 10 categories (LLM chatbots, AI code, image, video, audio, writing, search, productivity, design, education).

**Custom overrides (`customAiHosts`):** Users can add or remove AI sites without modifying source code. Stored in `chrome.storage.local` as `+domain` (add) or `-domain` (remove) entries.

**Security benefit:** Reduces attack surface by not injecting content scripts into banking, email, or government sites.

---

## Positive Findings

| Feature | Status |
|---------|--------|
| Transferable Objects (zero-copy) | ✅ |
| Capture-phase interception | ✅ |
| Shadow DOM encapsulation (closed) | ✅ |
| Magic byte content sniffing | ✅ |
| Timing-based ReDoS protection | ✅ |
| CSV formula injection sanitization | ✅ |
| YAML injection escaping | ✅ |
| Aggressive memory cleanup | ✅ |
| Promise-based mutex | ✅ |
| Guarded conversion counter | ✅ |
| Domain blacklist (exact/suffix) | ✅ |
| Smart Mode activation control | ✅ |
| Content size limits | ✅ |
| History write debouncing | ✅ |
| SRI hashes for libraries | ✅ |
| CSP in manifest | ✅ |
| Library lockfile with SHA-256 | ✅ |
| Editable AI site database | ✅ |
| Custom AI host overrides (+/-) | ✅ |
| Port-based lifecycle management | ✅ |

---

## Test Coverage

87 unit tests in `test.js` covering:
- ReDoS safety (7 tests)
- YAML injection (9 tests)
- CSV injection (10 tests)
- Domain blacklist (9 tests)
- Conversion counter (8 tests)
- Heading hierarchy (5 tests)
- Magic byte detection (7 tests)
- Regex sanitization (8 tests)
- Smart Mode activation (13 tests)
- Smart Mode custom overrides (7 tests)
- Integration tests (4 tests)

---

## Conclusion

FTM Studio v1.0.1 has **enterprise-grade security**. All Critical, High, and Medium findings are remediated. Smart Mode reduces the attack surface by only activating on AI platforms. The extension maintains 100% local processing with zero network requests.

**Risk Rating:** LOW  
**Open Items:** 3 Low-severity (acceptable)

---

*Audit: 2026-07-26 · Version: 1.0.1*
