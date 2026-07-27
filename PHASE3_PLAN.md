# Phase 3 — Refactoring and Hardening Plan

> **Historical Document** — This plan was generated before fixes were applied. The monolithic `content.js` (C2/L5) has since been deleted as dead code. Other findings may have been addressed.

**Target:** FTMStudio Chrome Extension (`file-to-markdown-extension/`)
**Generated:** 2026-07-27
**Scope:** 27 defects (C1–C6, H1–H9, M1–M7, L1–L5) + 8 bottlenecks (B1–B8)

---

## Finding Index

| ID | Severity | Summary |
|----|----------|---------|
| C1 | Critical | background.js has broken IIFE structure — top-level `await`, orphaned blocks, dangling code |
| C2 | Critical | content.js (1247 lines) is a monolith duplicating all content/ modules — double init, double listeners |
| C3 | Critical | offscreen.js `loadScript()` declares `const script` twice — SyntaxError prevents all library loading |
| C4 | Critical | offscreen.js `createTurndown()` references undefined `turndown` variable instead of `converter` |
| C5 | Critical | offscreen.js table rule has unclosed scope and references `turndown.turndown()` — broken table conversion |
| C6 | Critical | background.js has top-level `await` outside async context — IIFE cannot execute |
| H1 | High | background.js orphaned `if (message.type === 'CLOSE_OFFSCREEN')` inside port handler — unreachable |
| H2 | High | background.js has two conflicting `chrome.storage.onChanged` listeners |
| H3 | High | background.js has two conflicting `chrome.runtime.onInstalled` listeners |
| H4 | High | Two divergent `DEFAULT_CONFIG` definitions in background.js |
| H5 | High | content.js and content/ modules both register capture-phase event listeners — double fire |
| H6 | High | offscreen.js `handleProcessRequest` missing `let` declaration for `markdown` in PDF branch |
| H7 | High | ReDoS detector in content.js/postprocess.js uses unsafe heuristic patterns |
| H8 | High | offscreen.js SRI hashes applied to chrome-extension:// URLs — will silently fail or block loads |
| H9 | High | popup.html/popup.js missing `images` category checkbox — users can't toggle image conversion |
| M1 | Medium | content.js and content/ modules both maintain independent config state |
| M2 | Medium | Two independent conversion history arrays (content.js vs content/history.js) |
| M3 | Medium | YAML escaping inconsistent between content.js and content/postprocess.js |
| M4 | Medium | Re-dispatch creates different event types (DragEvent vs generic Event) across codepaths |
| M5 | Medium | CSV cell sanitizer has inconsistent injection-protection across codepaths |
| M6 | Medium | offscreen.js PDF worker path not set in `loadPdfJs()` — only set in `handleProcessRequest` |
| M7 | Medium | Popup DEFAULT_CONFIG diverges from background DEFAULT_CONFIG (missing images, extra keys) |
| L1 | Low | `FTM._aiHostsSet` cache never invalidated on config update |
| L2 | Low | `visibilitychange` cleanup destroys toast on tab switch — user loses decision prompt |
| L3 | Low | RTF regex cleanup is overly aggressive — strips content-bearing commands |
| L4 | Low | History debounce (2s) can lose data on extension shutdown |
| L5 | Low | manifest.json loads both content.js AND content/ modules — redundant execution |
| B1 | Bottleneck | All 9 content scripts injected on every page at document_start |
| B2 | Bottleneck | PapaParse injected into page context via script tag — security + global pollution |
| B3 | Bottleneck | `file.arrayBuffer()` copies before Transferable transfer — unnecessary allocation |
| B4 | Bottleneck | Small CSV read fully into memory before PapaParse — no true streaming for < threshold |
| B5 | Bottleneck | Regex pipeline always runs strip-whitespace + collapse-newlines even with zero rules |
| B6 | Bottleneck | Toast Shadow DOM fully created/destroyed per interaction — no reuse |
| B7 | Bottleneck | `chrome.storage.local.get(null)` loads entire storage including history on every config read |
| B8 | Bottleneck | Offscreen document created/destroyed per batch — no reuse within session |

---

## P0 — Blocks All Functionality (Must Fix First)

### Fix C3: Duplicate `const script` declaration in offscreen.js

- **Fix ID:** C3
- **Target:** `offscreen.js` → `loadScript()` (lines ~48–75)
- **Change:** Remove the second `const script = document.createElement('script')` declaration. The function currently declares `script` at line ~49, then again at line ~63. Delete lines 63–64 entirely (the second declaration and its `script.src` assignment). Keep only the first declaration which already sets `script.src` and adds SRI attributes.
- **Dependencies:** None
- **Risk:** None — this is a pure syntax fix. The second declaration is dead code that shadows the first.

### Fix C6: Top-level `await` outside async context in background.js

- **Fix ID:** C6
- **Target:** `background.js` → module scope (lines ~90–105)
- **Change:** The `await offscreenCreating` block at line ~96 is at the top level of the IIFE, which is not async. Wrap the entire offscreen creation + await + cleanup in an async IIFE or move it into a named `async function ensureOffscreen()` that is called from the `onConnect` handler. Specifically:
  - Replace the bare `await offscreenCreating` + `try/finally` block with: `async function ensureOffscreen() { /* existing offscreen creation logic */ }`
  - Call `ensureOffscreen()` from inside `onConnect` handler (which already calls `createOffscreen()` — reconcile these two names)
- **Dependencies:** None
- **Risk:** If offscreen creation is moved into `onConnect`, the first port connection will be slightly slower. Mitigation: call `ensureOffscreen()` eagerly on service worker startup if desired.

### Fix C1: background.js structural corruption — rewrite required

- **Fix ID:** C1
- **Target:** `background.js` (entire file, 347 lines)
- **Change:** The file has severe structural corruption:
  1. Two `const DEFAULT_CONFIG` declarations (lines ~35 and ~180) — merge into one at top
  2. Two `chrome.runtime.onInstalled.addListener` blocks (lines ~55 and ~195) — merge into one
  3. Two `chrome.storage.onChanged.addListener` blocks (lines ~125 and ~145) — merge into one
  4. Orphaned `if (message.type === 'CLOSE_OFFSCREEN')` block inside `onConnect` (line ~108) — move to `onMessage` listener
  5. Orphaned `if (message.type === 'KEEP_ALIVE')` block (line ~140) — move to `onMessage` listener
  6. Dangling `return false;` (line ~115) — remove
  7. Duplicate `onConnect` handler blocks with conflicting port setup — consolidate into one
  8. Orphaned `port.onDisconnect.addListener(cleanup)` and `offscreenPort.onDisconnect` (lines ~138–142) — integrate into main handler
  - **Recommended approach:** Rewrite the entire file from scratch with a clean structure:
    ```
    1. DEFAULT_CONFIG (single definition)
    2. Offscreen lifecycle (ensureOffscreen, closeOffscreen)
    3. onInstalled handler (single)
    4. onConnect handler (single, clean port bridging)
    5. onMessage handler (CREATE_OFFSCREEN, CLOSE_OFFSCREEN, KEEP_ALIVE)
    6. storage.onChanged handler (single)
    7. onSuspend handler
    ```
- **Dependencies:** C6 (await fix), H1–H4 (all resolved by rewrite)
- **Risk:** **HIGH** — Complete rewrite of the relay layer. Must test: (a) offscreen creation/destruction lifecycle, (b) port message forwarding in both directions, (c) config sync to all tabs, (d) install/update migration. Regression test matrix: fresh install, update from v1, concurrent file conversions, service worker restart mid-conversion.

---

## P1 — Blocks Core Functionality

### Fix C2 + L5: Remove monolithic content.js, keep modular content/ files

- **Fix ID:** C2, L5
- **Target:** `manifest.json` + `content.js`
- **Change:**
  1. In `manifest.json`, remove `"content.js"` from the `content_scripts[0].js` array (it's not currently listed there — verify). The manifest already loads the `content/` modules. **However**, `content.js` is a standalone IIFE that exists as a separate file. Verify it is NOT loaded by the manifest. If it's loaded via any other mechanism, remove that reference.
  2. If `content.js` is truly unused (not referenced in manifest), archive it to `content.js.bak` and leave a comment. If it IS loaded alongside content/ modules, remove it from the loading mechanism immediately — it causes double initialization.
  3. Verify that ALL functionality from `content.js` exists in the modular files:
     - Image processing (`processImageFile`) → **MISSING** from content/ modules. Add to `content/converters.js`.
     - Magic byte detection (`verifyFileTypeMatchesExtension`) → exists in `content/converters.js` as `sniffFileContent` but less complete. Merge the `detectFileTypeFromBytes` logic into `content/converters.js`.
- **Dependencies:** C1 (background.js must work first)
- **Risk:** If content.js is the actually-loaded file and content/ modules are NOT loaded, this breaks everything. **Verify manifest.json content_scripts matches reality.** The manifest shows content/ modules are loaded — content.js appears to be a development artifact or the "v7 monolith" that was meant to replace the modular approach but both coexist.

### Fix C4 + C5: Fix createTurndown() in offscreen.js

- **Fix ID:** C4, C5
- **Target:** `offscreen.js` → `createTurndown()` (lines ~82–120)
- **Change:**
  1. The function creates `const converter = new Turndown(...)` but then references `turndown` (undefined) in the table rule. Replace all `turndown` references with `converter`:
     - `turndown.addRule('tables', ...)` → `converter.addRule('tables', ...)`
     - Inside the table rule replacement: `turndown.turndown(cellHtml)` → `converter.turndown(cellHtml)`
  2. The table rule replacement function has an unclosed scope — the function body doesn't have a proper closing `}` and `return` before the next `converter.addRule('noImages', ...)`. Fix the table rule to properly return the markdown table string:
     ```javascript
     converter.addRule('tables', {
       filter: 'table',
       replacement: function(content, node) {
         // ... table processing logic ...
         const header = '| ' + normalized[0].join(' | ') + ' |';
         const separator = '| ' + normalized[0].map(() => '---').join(' | ') + ' |';
         const body = normalized.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n');
         return '\n\n' + header + '\n' + separator + '\n' + body + '\n\n';
       }
     });
     ```
  3. The `noImages` rule uses the variable name `converter` (correct) but is defined after the broken table rule. After fixing the table rule, verify `noImages` is properly scoped.
- **Dependencies:** C3 (loadScript must work for Turndown to load)
- **Risk:** Table conversion output format changes. Existing tests/snapshots may need updating. The fix is straightforward but the table markdown generation logic must be validated against sample DOCX/EPUB files with tables.

### Fix H5: Eliminate double event listener registration

- **Fix ID:** H5
- **Target:** `content.js` + `content/intercept.js`
- **Change:** This is resolved by C2 (removing content.js). If content.js must be kept for some reason, add a guard:
  ```javascript
  if (window.__FTM_INITIALIZED) return;
  window.__FTM_INITIALIZED = true;
  ```
  at the top of both `content.js` and `content/intercept.js` init functions.
- **Dependencies:** C2
- **Risk:** Low if content.js is removed. If guard approach is used, verify it doesn't break the modular loading order.

### Fix H6: Missing `let` declaration for `markdown` in offscreen.js PDF branch

- **Fix ID:** H6
- **Target:** `offscreen.js` → `handleProcessRequest()` (line ~390)
- **Change:** In the `switch (extension)` block, the `.pdf` case uses `markdown = await processPdf(...)` without declaring `markdown`. Add `let markdown;` before the switch, or use `return { markdown: await processPdf(...), fileName }` to match the other cases:
  ```javascript
  case '.pdf':
    if (typeof pdfjsLib === 'undefined') {
      await loadScript('lib/pdf.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
    }
    return { markdown: await processPdf(arrayBuffer, fileName), fileName };
  ```
- **Dependencies:** C3, C6
- **Risk:** None — pure variable declaration fix.

### Fix H8: Remove SRI from chrome-extension:// script loading

- **Fix ID:** H8
- **Target:** `offscreen.js` → `loadScript()` (lines ~48–55)
- **Change:** Remove the SRI hash application block. Chrome extensions cannot use `crossOrigin="anonymous"` on `chrome-extension://` URLs — the browser will reject the script load. Remove:
  ```javascript
  // DELETE these lines:
  const sriHash = SRI_HASHES[src];
  if (sriHash) {
    script.integrity = sriHash;
    script.crossOrigin = 'anonymous';
  }
  ```
  Optionally keep the `SRI_HASHES` constant for documentation, but add a comment explaining why it's not applied. Better: remove entirely and add integrity verification via a build step or `web_accessible_resources` restriction.
- **Dependencies:** None
- **Risk:** Removes integrity verification. Libraries could be tampered with if the extension directory is compromised. Mitigation: rely on Chrome's extension signing + `web_accessible_resources` restrictions.

### Fix H9: Add images category to popup

- **Fix ID:** H9
- **Target:** `popup.html` + `popup.js`
- **Change:**
  1. In `popup.html`, add inside `.format-toggles`:
     ```html
     <label class="format-row">
       <div class="format-info">
         <span class="format-name">Images</span>
         <span class="format-exts">.png .jpg .gif .webp .svg</span>
       </div>
       <input type="checkbox" id="cat-images" checked class="switch">
     </label>
     ```
  2. In `popup.js`, add `'images'` to the `categoryCheckboxes` array:
     ```javascript
     const categoryCheckboxes = ['pdf', 'documents', 'spreadsheets', 'code', 'markup', 'presentations', 'images'];
     ```
- **Dependencies:** None
- **Risk:** None — additive change.

### Fix M7: Unify DEFAULT_CONFIG across all files

- **Fix ID:** M7, H4
- **Target:** `background.js`, `popup.js`, `content/config.js`
- **Change:** Create a single source of truth. The canonical DEFAULT_CONFIG should be:
  ```javascript
  const DEFAULT_CONFIG = {
    enabled: true,
    smartMode: true,
    autoConvert: false,
    autoDismissSeconds: 10,
    domainBlacklist: [],
    domainWhitelist: [],
    customAiHosts: [],
    categories: {
      documents: true, pdf: true, spreadsheets: true, code: true,
      markup: true, presentations: true, images: true
    },
    yamlFrontmatter: true,
    csvStreamThreshold: 5,
    stripTrailingWhitespace: true,
    enforceHeadingHierarchy: false,
    regexPipeline: [],
    conversionHistory: [],
    maxConversions: 50
  };
  ```
  - Place this in a shared file (e.g., `content/shared-config.js`) or keep it in background.js and have popup.js/content.js read from storage only.
  - Remove all duplicate definitions. The popup should not define its own DEFAULT_CONFIG — it should read from storage and use fallback only for missing keys.
- **Dependencies:** C1 (background.js rewrite)
- **Risk:** If any file relied on its divergent defaults (e.g., background missing `smartMode`), behavior changes. Verify all config consumers handle missing keys gracefully.

---

## P2 — Improves Quality and Reliability

### Fix M1: Consolidate config state between content.js and content/ modules

- **Fix ID:** M1
- **Target:** Resolved by C2 (removing content.js)
- **Change:** After removing content.js, verify `content/config.js` is the single config authority. All other content/ modules reference `FTM.config` from `content/config.js`.
- **Dependencies:** C2
- **Risk:** Low — verification only.

### Fix M2: Consolidate conversion history

- **Fix ID:** M2
- **Target:** Resolved by C2 (removing content.js). `content/history.js` is the single history module.
- **Change:** After removing content.js, verify `content/history.js` `FTM.recordConversion` is the only history recording function. Ensure `content/intercept.js` calls `FTM.recordConversion` (it already does).
- **Dependencies:** C2
- **Risk:** Low.

### Fix M3: Unify YAML escaping

- **Fix ID:** M3
- **Target:** `content/postprocess.js` → `FTM.escapeYamlString()`
- **Change:** The postprocess version is more complete (escapes `:`, `[`, `]`, `{`, `}`). The content.js version is simpler. After removing content.js, the postprocess version is authoritative. **Verify it's correct:**
  ```javascript
  FTM.escapeYamlString = function (str) {
    return str
      .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/:/g, '\\:')
      .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
      .replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  };
  ```
  This is already in `content/postprocess.js`. No change needed after C2.
- **Dependencies:** C2
- **Risk:** None — postprocess version is strictly more correct.

### Fix M4: Standardize re-dispatch event types

- **Fix ID:** M4
- **Target:** `content/intercept.js` → `reDispatchEvent()`
- **Change:** The current code correctly creates `DragEvent` for drops and `Event` for input changes. This is actually correct behavior — no change needed. The original content.js used generic `Event` for drops which was wrong. The modular version is better.
- **Dependencies:** None
- **Risk:** None — current behavior is correct.

### Fix M5: Consolidate CSV cell sanitizer

- **Fix ID:** M5
- **Target:** `content/converters.js` → `streamCsvToMarkdown()`
- **Change:** `streamCsvToMarkdown` does inline sanitization instead of using `FTM.sanitizeCsvCell` from `content/utils.js`. Replace:
  ```javascript
  // In streamCsvToMarkdown, replace inline sanitization:
  const cells = row.map(c => {
    const raw = String(c !== null && c !== undefined ? c : '');
    const sanitized = /^[=+\-@]/.test(raw) ? "'" + raw : raw;
    return sanitized.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  });
  // With:
  const cells = row.map(c => FTM.sanitizeCsvCell(c).replace(/\|/g, '\\|').replace(/\n/g, ' '));
  ```
- **Dependencies:** None
- **Risk:** Low — `FTM.sanitizeCsvCell` already handles the `=+\-@` prefix injection.

### Fix M6: Set PDF worker path in loadPdfJs()

- **Fix ID:** M6
- **Target:** `offscreen.js` — add a `loadPdfJs()` function (currently missing; PDF.js is loaded inline in `handleProcessRequest`)
- **Change:** Create a proper `loadPdfJs()` function:
  ```javascript
  async function loadPdfJs() {
    if (pdfjsLib) return;
    await loadScript('lib/pdf.min.js');
    pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  }
  ```
  Then in `handleProcessRequest`, replace the inline PDF loading with `await loadPdfJs()`.
- **Dependencies:** C3, H8
- **Risk:** Low — extracts existing logic into a proper function.

### Fix H7: Improve ReDoS detection

- **Fix ID:** H7
- **Target:** `content/postprocess.js` → `FTM.isRegexSafe()`
- **Change:** The current implementation uses performance.now() timing (good) plus a heuristic nested-quantifier check. The heuristic regex `/(\\([^)]*[+*]\\)[+*]|\\(\\.[*]\\)[+*]|[+*]{2,})/` is itself safe but can miss complex ReDoS patterns. Improve by:
  1. Add a character limit on user patterns: `if (pattern.length > 200) return false;`
  2. Add a test with a longer adversarial string (200+ chars) for timing-based detection
  3. Keep the heuristic as a fast-path rejection
  ```javascript
  FTM.isRegexSafe = function (pattern) {
    if (pattern.length > 200) return false; // Reject overly complex patterns
    try {
      const regex = new RegExp(pattern, 'g');
      const adversarial = 'a'.repeat(200) + '!';
      const s = performance.now();
      regex.test(adversarial);
      if (performance.now() - s > 100) return false;
      return true;
    } catch {
      return false;
    }
  };
  ```
- **Dependencies:** None
- **Risk:** May reject some legitimate long patterns. The 200-char limit is generous for typical regex rules.

### Fix B1: Lazy-load content scripts

- **Fix ID:** B1
- **Target:** `manifest.json` + `content/intercept.js`
- **Change:** Instead of injecting 9 scripts on every page at `document_start`, inject only a minimal bootstrap (~2KB) that checks domain and lazily loads the rest:
  1. Create `content/bootstrap.js` (~50 lines) that:
     - Loads config from storage
     - Checks `enabled`, `smartMode`, blacklist
     - If should activate, dynamically injects the remaining scripts
  2. Update manifest to only inject `content/bootstrap.js` at `document_start`
  3. Bootstrap loads: `constants.js`, `utils.js`, `config.js`, `postprocess.js`, `converters.js`, `binary.js`, `history.js`, `toast.js`, `intercept.js` via `chrome.runtime.getURL()` + script injection or `importScripts()`
- **Dependencies:** C2, C1
- **Risk:** Dynamic script injection in content scripts has CSP implications. Some sites with strict CSP may block inline scripts. Mitigation: use `chrome.scripting.executeScript()` from background for the injection, or keep manifest injection but defer initialization.

### Fix B2: Move PapaParse loading to offscreen document

- **Fix ID:** B2
- **Target:** `content/converters.js` + `offscreen.js`
- **Change:** PapaParse is currently injected into the page context via `<script>` tag, polluting the page's global scope. For large CSV files that need streaming, move PapaParse-based processing to the offscreen document:
  1. Add CSV handling to `offscreen.js` alongside binary file processing
  2. For CSV files below the stream threshold, continue processing in content script (no PapaParse needed — use the fallback parser)
  3. For large CSVs, send the ArrayBuffer to offscreen for PapaParse processing
  4. Remove `FTM.loadPapaParse` from `content/converters.js`
- **Dependencies:** C1, C3, C4
- **Risk:** Adds latency for large CSV processing (port round-trip). Mitigation: only route large CSVs to offscreen; small ones use the built-in parser.

### Fix B3: Verify Transferable usage

- **Fix ID:** B3
- **Target:** `content/binary.js` → `processBinaryFile()`
- **Change:** The current code correctly uses `port.postMessage(msg, [arrayBuffer])` which transfers ownership. However, `file.arrayBuffer()` creates a copy from the File object. This is unavoidable — File.arrayBuffer() always returns a new ArrayBuffer. The Transferable transfer after that is correct. **No code change needed**, but add a comment explaining this is the optimal path:
  ```javascript
  // file.arrayBuffer() creates a copy from the File system — unavoidable.
  // The [arrayBuffer] transfer list then moves ownership to offscreen with zero additional copy.
  ```
- **Dependencies:** None
- **Risk:** None — documentation only.

### Fix B5: Conditional regex pipeline execution

- **Fix ID:** B5
- **Target:** `content/postprocess.js` → `FTM.applyRegexPipeline()`
- **Change:** The function always runs strip-whitespace and collapse-newlines, even when there are zero regex rules and these options are disabled. Add early returns:
  ```javascript
  FTM.applyRegexPipeline = function (text) {
    const needsStrip = FTM.config.stripTrailingWhitespace !== false;
    const needsCollapse = true; // Always collapse excessive newlines
    const needsHeading = FTM.config.enforceHeadingHierarchy;
    const rules = FTM.config.regexPipeline;
    const hasRules = rules && rules.length > 0;

    if (!needsStrip && !needsCollapse && !needsHeading && !hasRules) return text;

    if (needsStrip) text = text.replace(/[ \t]+$/gm, '');
    if (needsCollapse) text = text.replace(/\n{4,}/g, '\n\n\n');
    if (needsHeading) text = FTM.enforceHeadingHierarchy(text);
    // ... rest of regex rules
  };
  ```
  This is a minor optimization — the regex operations are fast. The real win is avoiding the function call entirely when no post-processing is needed.
- **Dependencies:** None
- **Risk:** None.

### Fix B6: Reuse toast Shadow DOM

- **Fix ID:** B6
- **Target:** `content/toast.js`
- **Change:** Instead of creating and destroying the entire Shadow DOM for each file interaction, keep the toast host in the DOM and update content:
  ```javascript
  FTM.showToast = function (file) {
    if (!toastHost) FTM.createToast(); // Only create once
    const el = toastRoot.getElementById('ftm-filename');
    if (el) el.textContent = file.name + ' (' + FTM.formatBytes(file.size) + ')';
    toastHost.style.opacity = '1';
    toastHost.style.transform = 'translateX(0)';
  };
  ```
  Modify `destroyToast` to just hide (opacity 0, transform off-screen) instead of removing from DOM. Add a `FTM.removeToast()` for page unload cleanup.
- **Dependencies:** None
- **Risk:** Stale toast state if not properly reset between uses. Ensure all UI elements (progress bar, timer, filename) are reset in `showToast`.

### Fix B7: Selective storage reads

- **Fix ID:** B7
- **Target:** `content/config.js` → `FTM.loadConfig()`
- **Change:** Replace `chrome.storage.local.get(null, ...)` with a specific key list:
  ```javascript
  const CONFIG_KEYS = [
    'enabled', 'smartMode', 'autoConvert', 'autoDismissSeconds',
    'domainBlacklist', 'domainWhitelist', 'customAiHosts', 'categories',
    'yamlFrontmatter', 'csvStreamThreshold', 'stripTrailingWhitespace',
    'enforceHeadingHierarchy', 'regexPipeline', 'maxConversions'
  ];
  chrome.storage.local.get(CONFIG_KEYS, (items) => { ... });
  ```
  This avoids loading `conversionHistory` (which can be large) on every config read.
- **Dependencies:** None
- **Risk:** If new config keys are added, the key list must be updated. Mitigation: add a comment listing the keys and a version check.

### Fix B8: Reuse offscreen document within session

- **Fix ID:** B8
- **Target:** `content/binary.js` + `background.js`
- **Change:** Currently, `CLOSE_OFFSCREEN` is sent when `pendingConversions` drops to 0. Instead, keep the offscreen alive for a grace period (e.g., 30s) before closing:
  ```javascript
  let offscreenCloseTimer = null;
  FTM.decrementPending = function () {
    pendingConversions = Math.max(0, pendingConversions - 1);
    if (pendingConversions <= 0) {
      if (offscreenCloseTimer) clearTimeout(offscreenCloseTimer);
      offscreenCloseTimer = setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'CLOSE_OFFSCREEN' });
        offscreenCloseTimer = null;
      }, 30000);
    }
    return pendingConversions <= 0;
  };
  ```
  Also, don't send `CREATE_OFFSCREEN` for every conversion — only if the offscreen was closed.
- **Dependencies:** C1
- **Risk:** Slightly higher memory usage while offscreen is held open. 30s timeout is reasonable.

---

## P3 — Nice-to-Have

### Fix L1: Invalidate AI hosts cache on config update

- **Fix ID:** L1
- **Target:** `content/utils.js` → `FTM.shouldActivate()`
- **Change:** In the `CONFIG_UPDATE` message handler in `content/config.js`, add:
  ```javascript
  FTM._aiHostsSet = null; // Invalidate cache
  ```
  This forces re-creation of the Set on next `shouldActivate()` call.
- **Dependencies:** None
- **Risk:** None.

### Fix L2: Don't cleanup on tab switch

- **Fix ID:** L2
- **Target:** `content/intercept.js` → `cleanup()` and visibilitychange listener
- **Change:** Remove the `visibilitychange` listener that calls cleanup on `hidden`. The toast should persist across tab switches — the user may switch back to approve/deny. Keep `pagehide` and `beforeunload` cleanup.
  ```javascript
  // REMOVE:
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cleanup();
  });
  ```
- **Dependencies:** None
- **Risk:** Toast persists in background tabs, consuming minimal DOM resources. The countdown timer continues running (correct behavior — file should be auto-denied if user doesn't return).

### Fix L3: Refine RTF command stripping

- **Fix ID:** L3
- **Target:** `content/converters.js` → `FTM.readRtfFile()`
- **Change:** The current regex `\\[a-z]+\\s?-?\\d+;?` strips ALL RTF commands including `\u` (Unicode escapes) which are handled separately below. Reorder the replacements so Unicode/escape handling happens BEFORE the generic command strip:
  ```javascript
  let cleaned = text
    .replace(/\\obj(?=.*?})[\s\S]*?}/g, '')
    .replace(/\\pict[\s\S]*?}/g, '')
    .replace(/\\bin[\s\S]*?}/g, '')
    // Handle Unicode BEFORE generic command strip
    .replace(/\\u(-?\d+)\??/g, (_, code) => {
      const n = parseInt(code, 10);
      return n >= 0 && n <= 65535 ? String.fromCharCode(n) : '?';
    })
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par\s*/g, '\n')
    .replace(/\\line\s*/g, '\n')
    .replace(/\\tab\s*/g, '\t')
    // NOW strip remaining commands
    .replace(/\\[a-z]+\s?-?\d+;?/g, '')
    .replace(/\\[a-z]+\s?/g, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  ```
- **Dependencies:** None
- **Risk:** Low — reordering replacements may change output for edge-case RTF files. Test with sample RTFs.

### Fix L4: Persist history immediately on shutdown

- **Fix ID:** L4
- **Target:** `content/history.js`
- **Change:** Add a flush function and call it on page unload:
  ```javascript
  FTM.flushHistory = function () {
    if (historyPersistTimer) {
      clearTimeout(historyPersistTimer);
      historyPersistTimer = null;
      chrome.storage.local.set({ conversionHistory: [...conversionHistory] });
    }
  };
  ```
  In `content/intercept.js` cleanup:
  ```javascript
  function cleanup() {
    FTM.flushHistory();
    // ... rest of cleanup
  }
  ```
- **Dependencies:** None
- **Risk:** None — additive change.

---

## Execution Order

```
Phase A — Critical Fixes (P0):
  C3 → C6 → C1 (includes H1, H2, H3, H4)

Phase B — Core Functionality (P1):
  C2+L5 → C4+C5 → H5 → H6 → H8 → H9 → M7

Phase C — Quality (P2):
  M1, M2, M3, M4, M5, M6 (all resolved by C2 or independent)
  H7, B1, B2, B3, B5, B6, B7, B8

Phase D — Polish (P3):
  L1, L2, L3, L4
```

**Estimated total effort:** 3–5 days for a single engineer familiar with Chrome extension APIs.

**Critical path:** C3 → C6 → C1 → C2 → B1 (background.js rewrite + content.js removal + lazy loading)

---

## Risk Summary

| Risk Level | Fixes | Mitigation |
|-----------|-------|------------|
| **HIGH** | C1 (background rewrite) | Full regression test: install, update, port lifecycle, concurrent conversions, service worker restart |
| **MEDIUM** | C2 (content.js removal), B1 (lazy loading), B2 (PapaParse offscreen) | Verify manifest loading order, test on sites with strict CSP, validate CSV processing paths |
| **LOW** | C4, C5, H6, H8, H9, M3, M5, M6, B6 | Straightforward fixes with clear expected behavior |
| **NONE** | C3, H7, M4, B3, B5, B7, L1, L2, L3, L4, B8 | Additive or documentation-only changes |

---

## Testing Checklist

After applying all fixes, verify:

- [ ] Extension installs cleanly (no console errors)
- [ ] Service worker starts and stays running
- [ ] Drop .docx on ChatGPT → toast appears → convert → markdown delivered
- [ ] Drop .pdf on Claude → toast appears → convert → markdown with pages
- [ ] Drop .xlsx on any site → markdown table output
- [ ] Drop .csv (small) → table output without PapaParse
- [ ] Drop .csv (large, >5MB) → streamed table output
- [ ] Drop .epub → chapter-by-chapter markdown
- [ ] Drop .pptx → slide-by-slide markdown
- [ ] Drop .png/.jpg → base64 embedded markdown
- [ ] Drop .rtf → cleaned text markdown
- [ ] Auto-dismiss countdown works (10s default)
- [ ] Enter key converts, Escape key skips
- [ ] Popup: all toggles persist to storage
- [ ] Popup: images category checkbox works
- [ ] Popup: regex rules add/edit/remove
- [ ] Popup: history shows conversions, export works
- [ ] Smart Mode: only activates on AI sites
- [ ] Blacklist: blocks activation on listed domains
- [ ] Config sync: popup change → content script updates
- [ ] Service worker restart mid-conversion → graceful error
- [ ] Concurrent file drops → no state corruption
- [ ] 50MB file → size limit error
- [ ] Empty file → appropriate error
- [ ] Tab switch → toast persists
- [ ] Page navigation → cleanup fires
