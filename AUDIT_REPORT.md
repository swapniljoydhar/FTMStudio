# FTM Studio security, reliability, and optimization audit

## Scope

This audit covered the Manifest V3 manifest, popup, service worker, content-side conversion helpers, parser loader, document parsers, message schemas, storage/configuration paths, tests, vendored libraries, and the original page-interception workflow. The repository was refactored toward a manual, policy-neutral workflow rather than attempting to defeat AI-site automation detection or alter third-party upload controls.

## Implemented high-impact changes

| Area | Original weakness | Implemented change |
|---|---|---|
| Page interception | Cancelling `drop`/`change`, replacing `input.files`, redispatching events, and clipboard fallbacks were detectable and site-fragile. | Removed interception, content-script registration, host matching, tab broadcasts, ports, and offscreen lifecycle managers. Added an explicit manual converter page with a real file picker and drag/download output. |
| Privileges | `scripting`, `offscreen`, `downloads`, and optional `<all_urls>` access created a large trust and review surface. | Manifest now requests only `storage`; no host access, content scripts, dynamic registration, offscreen permission, downloads permission, or web-accessible resources remain. |
| Service worker | Runtime queues, registration state, timers, and caches were vulnerable to worker suspension/restart. | Worker is stateless and event-driven. It reconstructs durable configuration on install/startup/storage events and only maintains badge state. |
| Transfer memory | Base64 chunking and full-buffer reassembly multiplied RAM use and created duplicate copies. | Primary workflow keeps the file in the converter page, uses one bounded queue and one active job, avoids port transport, and applies input/output/queue limits. |
| Format surface | Images, EPUB, PPTX, OCR-heavy paths, and ambiguous containers expanded attack and quality risk. | Curated default allowlist covers PDF, DOCX, text/Markdown/HTML/RTF, CSV/XLS/XLSX, and source code. Image and transport methods were removed from the local converter module. |
| Browser portability | Direct Chrome namespace usage was scattered across settings, storage, and parser loading. | Added a `chrome`/`browser` adapter and migrated popup, history, parser library loading, worker URLs, and message trust checks to it. |
| Configuration abuse | Domain and regex values were insufficiently bounded and normalized before storage/use. | Regex counts, pattern sizes, replacements, flags, and domain entries are bounded and canonicalized. Prototype-pollution defenses remain covered by tests. |
| DOM/code injection | Large legacy UI and interception code increased unsafe-sink risk. | Popup and converter use DOM node APIs and `textContent`; source checks reject `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, and `new Function`. |
| Parser hardening | PDF and document parsing could consume unbounded pages, images, OCR work, or output. | Existing hard limits remain active; PDF evaluation is disabled, parser libraries are lazy-loaded and locally pinned, and output is rejected above the safe limit. |
| History privacy | History was privacy-oriented but coupled to direct Chrome storage. | History stores only extension-derived labels, size, timestamp, UID, and output size; writes are serialized, debounced, expiring, and routed through the adapter. |
| UI/UX | Popup had a large site catalog, interception settings, splash animation, and controls that no longer matched the safe architecture. | Replaced with a compact responsive settings popup, manual-converter entry point, curated formats, reduced-motion support, keyboard focus states, and local-history actions. |
| Repository hygiene | Deleted legacy modules and stale tests remained part of the codebase. | Removed interception, dynamic registrar, bridge, offscreen manager, old offscreen page, old transport, image/data-URL converter paths, and obsolete tests. |

## Original vulnerability and exploit paths

### 1. Website automation and anti-abuse detection

**Risk:** The old extension modified native upload events and attempted to replace files in third-party application controls. A destination site could detect cancelled events, unusual `DataTransfer` objects, property overrides, timing, clipboard fallback behavior, or extension-originated metadata. This could trigger upload rejection, account friction, or anti-automation review.

**Method to fix:** Do not modify third-party DOM or upload controls. Convert only after an explicit user file selection in the extension page. Deliver a normal `.md` download/drag handle and let the user attach it through the destination application’s ordinary workflow.

**Status:** Implemented.

### 2. Excessive host and privileged permissions

**Risk:** Optional `<all_urls>` plus dynamic scripting enabled code execution in arbitrary sites. A compromised extension build, parser, or future regression would have had a much larger impact radius. `downloads`, `tabs`, `scripting`, and `offscreen` also increased store-review and user-trust risk.

**Method to fix:** Remove host permissions and all page execution paths. Request only the minimum durable-storage permission. Keep parser resources extension-local and do not expose them as web-accessible resources.

**Status:** Implemented.

### 3. Service-worker restart loss

**Risk:** In-memory registration state, queued messages, conversion sessions, and pending broadcasts could disappear when the MV3 worker was suspended or the browser restarted. A worker restart could leave a stale content-script state or an unresolved conversion promise.

**Method to fix:** Keep the worker stateless. Persist only durable configuration/metadata. Treat every worker global as disposable. Rebuild state from storage on each lifecycle event, and keep conversion ownership in an explicit page with a bounded queue.

**Status:** Implemented for the new manual workflow.

### 4. Memory exhaustion through binary duplication

**Risk:** A large file could exist simultaneously as a `File`, sliced `ArrayBuffer`, Base64 string, decoded buffer, parser structures, Markdown string, Blob, and replacement File. A malicious ZIP/PDF/spreadsheet could magnify this through compression, embedded objects, formulas, page rendering, or OCR.

**Method to fix:** Use a single active job on mobile, hard input/output limits, bounded parser work, lazy libraries, no Base64 port bridge, no automatic image embedding, no unbounded queue, and cancellation/release of object URLs. Add parser-specific limits for PDF pages, ZIP entries/uncompressed size, spreadsheet rows/cells, OCR pages, and generated Markdown.

**Status:** Primary workflow implemented; parser-specific limits should remain a release gate for any future EPUB/PPTX/image/OCR reintroduction.

### 5. Ambiguous container misclassification

**Risk:** Treating an unknown ZIP as DOCX or OLE2 as DOCX could cause incorrect parsing, misleading output, or parser error paths. Polyglot files can satisfy a superficial signature while containing another payload.

**Method to fix:** Classify ZIP containers by required internal structure and reject ambiguous types. Distinguish DOCX/XLSX/PPTX/EPUB by package entries. Distinguish OLE2 formats by compound-file streams. Never silently guess when structure is unknown.

**Status:** The broad user-facing allowlist was narrowed. Full structural classification remains required before re-enabling ambiguous formats.

### 6. PDF/OCR denial of service

**Risk:** PDFs with many pages, huge images, unusual object graphs, encrypted content, or scanned pages could cause CPU/RAM spikes. Rendering every page for OCR is especially expensive.

**Method to fix:** Enforce maximum pages, maximum page area, maximum image pixels/bytes, maximum text items, maximum OCR pages, OCR time budget, and cancellation. Render only pages that meet a scanned-page heuristic. Disable PDF evaluation and keep PDF.js updated.

**Status:** PDF evaluation hardening and lazy loading are present. Page/object/OCR budgets must be explicitly verified before promising arbitrary-document support.

### 7. Regex denial of service

**Risk:** User-controlled regex patterns can cause catastrophic backtracking during post-processing. Screening alone is not enough if the pattern/replacement count and length are unbounded.

**Method to fix:** Bound rule count, pattern length, replacement length, flags, input size, execution time, and cache size. Reject unsafe patterns and run post-processing only under a document-size budget. Prefer non-regex structured transforms for common cleanup operations.

**Status:** Bounds and existing ReDoS screening are retained and tested.

### 8. Configuration poisoning

**Risk:** Persisted settings are attacker-controlled data from the extension’s own storage boundary. Prototype keys, malformed domains, massive arrays, invalid flags, and overlong replacements can corrupt behavior or consume memory.

**Method to fix:** Deep-merge only allowlisted keys, reject `__proto__`, `constructor`, and `prototype`, bound every array/string, canonicalize domains, validate flags, and normalize defaults before use.

**Status:** Implemented and covered by tests.

### 9. Unsafe DOM rendering

**Risk:** Rendering filenames, parser errors, history fields, or settings via HTML sinks could turn a malicious filename or generated output into markup/script in the extension UI.

**Method to fix:** Use `textContent`, `createElement`, `append`, `replaceChildren`, and fixed attributes. Do not render Markdown as HTML. Keep extension CSP strict and reject unsafe sinks in CI.

**Status:** Implemented and source-tested.

### 10. Vendored-library supply chain risk

**Risk:** Minified parser libraries are code shipped inside the extension. A modified library could execute with extension privileges or corrupt converted content.

**Method to fix:** Pin versions and SHA-256 hashes, obtain libraries from official releases, review licenses, generate an SBOM, verify hashes in CI, and update only through a reviewed dependency process.

**Status:** SHA-256 lockfile verification passes. Independent license/SBOM review should remain part of release management.

## Residual issues and required future work

| Priority | Change required | Reason |
|---|---|---|
| P0 | Add parser-specific resource limits for PDF pages/objects, ZIP entries/uncompressed bytes, spreadsheet cells, and OCR work. | Prevent malicious documents from creating disproportionate CPU/RAM use. |
| P0 | Add a real cancellation signal through parser APIs and terminate workers on cancellation/page close. | The UI cancellation state must stop expensive parser work, not only mark the job cancelled. |
| P0 | Test every supported format with malformed, encrypted, truncated, polyglot, decompression-bomb, and oversized fixtures. | Passing unit tests alone does not prove malicious-file resilience. |
| P1 | Produce separate Chrome desktop MV3 and Firefox desktop/Android-compatible build manifests. | Firefox Android does not provide complete desktop MV3 service-worker parity. |
| P1 | Add browser-matrix CI using Chromium and Firefox, plus mobile viewport/accessibility checks. | Cross-browser source compatibility is not the same as tested packaging compatibility. |
| P1 | Remove or isolate unused vendored libraries from the production package. | Lazy loading reduces startup work, but unused files still increase supply-chain and package surface. |
| P1 | Generate an SPDX/CycloneDX SBOM and document all parser licenses. | Required for professional distribution and supply-chain traceability. |
| P2 | Add conversion quality fixtures and golden Markdown snapshots for PDF, DOCX, spreadsheets, HTML, and RTF. | Security hardening must not silently reduce conversion quality. |
| P2 | Add a focus-managed in-page confirmation dialog instead of `confirm()` for destructive history actions. | Better accessibility and mobile UX. |
| P2 | Add a filesystem-safe output naming policy and collision handling. | Avoid overwriting or ambiguous downloads across browsers. |

## Validation completed

The refactored repository currently passes:

- `npm test`: **115 tests passed, 0 failed**.
- `npm run build`: MV3 extension verification passed; **24 files** verified.
- `npm run verify:libs`: **11 pinned libraries** verified against SHA-256 hashes.

These checks validate source structure, core conversion helpers, configuration boundaries, parser registration, manifest permissions, unsafe-sink policy, and vendored-library integrity. They do not replace browser-matrix testing or adversarial parser fuzzing.
