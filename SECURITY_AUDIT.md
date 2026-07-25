# Security Audit & Improvement Suggestions

## Executive Summary

**Extension**: FTM Studio v6.5.0  
**Audit Date**: 2026  
**Auditor**: AI Code Analysis  
**Risk Level**: LOW (with recommended improvements)

---

## 🔍 Vulnerability Assessment

### 1. XSS Vectors — MEDIUM RISK

#### Finding: InnerHTML Usage
**Location**: `content.js:167`, `popup.js:186,194,274,299`

```javascript
// content.js:167
container.innerHTML = `...`;

// popup.js:194
div.innerHTML = `...`;
```

**Risk**: Template literals with interpolated user data could enable XSS if file names contain malicious scripts.

**Current Mitigation**: File names are displayed via `textContent` in most cases, but the toast template uses `innerHTML`.

**Recommendation**:
```javascript
// ✅ Safer approach - use textContent for dynamic content
const filenameEl = document.createElement('span');
filenameEl.className = 'ftm-toast-filename';
filenameEl.id = 'ftm-filename';
filenameEl.textContent = fileName; // Safe!
container.appendChild(filenameEl);
```

**Priority**: Medium  
**Effort**: Low

---

### 2. ReDoS Protection — PARTIALLY MITIGATED

#### Finding: Regex Pipeline Validation
**Location**: `content.js:905-923`

```javascript
const unsafePatterns = [
  /(.*?){3,}/,           // Nested quantifiers
  /(\w*?)+/,             // Quantified groups
  // ... more patterns
];
```

**Risk**: The current detection is heuristic-based and may miss sophisticated ReDoS patterns.

**Current State**: Basic protection exists but is not comprehensive.

**Recommendation**:
```javascript
// ✅ Integrate safe-regex or regexp-tree library
import { analyze } from 'regexp-tree';

function isRegexSafe(pattern) {
  try {
    const ast = regexpTree.parse(pattern);
    const result = analyze(ast);
    return !result.hasAmbiguity;
  } catch {
    return false;
  }
}
```

**Priority**: Low  
**Effort**: Medium (requires bundler)

---

### 3. Content Security Policy — MISSING

#### Finding: No CSP Headers
**Location**: `manifest.json`

**Risk**: Without CSP, the extension is vulnerable to injection attacks if any third-party script is compromised.

**Recommendation**: Add to `manifest.json`:
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```

**Priority**: High  
**Effort**: Low

---

### 4. Library Integrity — NO SRI

#### Finding: Third-Party Libraries Not Hashed
**Location**: `lib/*.js`

**Risk**: If library files are tampered with, malicious code could execute.

**Recommendation**:
1. Generate SHA-256 hashes for all libraries
2. Add `<script integrity="sha256-..." crossorigin="anonymous">` tags
3. Pin library versions in documentation

**Priority**: Medium  
**Effort**: Low

---

### 5. Permission Scope — OVERLY BROAD

#### Finding: `<all_urls>` Host Permission
**Location**: `manifest.json:12`

```json
"host_permissions": ["<all_urls>"]
```

**Risk**: While necessary for functionality, this grants access to sensitive pages (banking, email, etc.).

**Current Mitigation**: Domain blacklist feature exists.

**Recommendation**:
1. Add optional permissions model:
```json
"optional_host_permissions": ["<all_urls>"]
```
2. Request permissions on-demand when user first visits a site
3. Add explicit warning in popup about permission scope

**Priority**: Low  
**Effort**: High (UX change)

---

### 6. Storage Security — UNENCRYPTED

#### Finding: Config Stored in Plain Text
**Location**: `chrome.storage.local`

**Risk**: Conversion history and regex rules stored unencrypted. Could expose sensitive file names.

**Recommendation**:
```javascript
// ✅ Encrypt sensitive data before storage
async function encryptData(data) {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
  // Store key securely, encrypt data
}
```

**Note**: Chrome extension storage is already sandboxed per-extension, so risk is limited.

**Priority**: Low  
**Effort**: Medium

---

### 7. Memory Safety — WELL HANDLED ✅

#### Finding: Aggressive Cleanup Implemented
**Location**: `offscreen.js:606-632`

```javascript
function performAggressiveCleanup() {
  window.mammoth = null;
  window.XLSX = null;
  // ... remove script tags, clear DOM
}
```

**Assessment**: Excellent memory management. Libraries properly nulled after use.

**Status**: No action needed ✅

---

### 8. Transferable Objects — CORRECTLY USED ✅

#### Finding: Zero-Copy ArrayBuffer Transfer
**Location**: `content.js:813-816`

```javascript
port.postMessage(
  { type: 'PROCESS_BINARY_FILE', data: { fileName, extension, arrayBuffer } },
  [arrayBuffer]  // Transferable!
);
```

**Assessment**: Proper use of Transferable Objects prevents unnecessary memory copies.

**Status**: No action needed ✅

---

### 9. Error Handling — MOSTLY ROBUST

#### Finding: Try-Catch Blocks Present
**Locations**: Throughout codebase

**Strengths**:
- PDF.js worker path validation (`offscreen.js:308`)
- Transform matrix validation (`offscreen.js:354-356`)
- Timeout handlers for script loading

**Weaknesses**:
- Some error messages could leak internal state
- No centralized error reporting

**Recommendation**:
```javascript
// ✅ Sanitize error messages before displaying
function sanitizeError(err) {
  const msg = err.message || 'Unknown error';
  // Remove paths, stack traces
  return msg.replace(/[A-Z]:\\[^"']+/g, '[REDACTED PATH]');
}
```

**Priority**: Low  
**Effort**: Low

---

### 10. Race Conditions — PROTECTED ✅

#### Finding: Reference Counting for Concurrent Conversions
**Location**: `content.js:758-808`

```javascript
let pendingConversions = 0;
const conversionId = ++pendingConversions;
// Only close offscreen when last conversion completes
if (--pendingConversions <= 0) {
  chrome.runtime.sendMessage({ type: 'CLOSE_OFFSCREEN' });
}
```

**Assessment**: Proper reference counting prevents premature offscreen closure.

**Status**: No action needed ✅

---

## 📋 Code Quality Issues

### 1. Magic Numbers
**Issue**: Hardcoded values scattered throughout

```javascript
// content.js:500
if (file.size > 1024) { ... }  // Why 1024?

// content.js:770
const MAX_FILE_SIZE = 50 * 1024 * 1024;  // Better!
```

**Recommendation**: Extract constants to top of file:
```javascript
const CONSTANTS = {
  SNIFF_THRESHOLD_BYTES: 1024,
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
  CSV_STREAM_THRESHOLD_MB: 5,
  TOAST_COUNTDOWN_DEFAULT_SEC: 10,
  SCRIPT_LOAD_TIMEOUT_MS: 15000,
  CONVERSION_TIMEOUT_MS: 60000,
  MAX_HISTORY_ENTRIES: 50
};
```

---

### 2. Duplicate Code
**Issue**: Script loading logic duplicated

```javascript
// content.js:613-639 - loadPapaParse()
// offscreen.js:29-54 - loadScript()
```

**Recommendation**: Create shared utility module:
```javascript
// utils/scriptLoader.js
export async function loadScript(src, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    const timeoutId = setTimeout(() => {
      script.onerror(new Error('Load timeout: ' + src));
    }, timeoutMs);
    script.onload = () => { clearTimeout(timeoutId); resolve(); };
    script.onerror = () => { clearTimeout(timeoutId); reject(); };
    document.head.appendChild(script);
  });
}
```

---

### 3. Inconsistent Error Messages
**Issue**: Mixed formats

```javascript
throw new Error('File too large: ' + formatBytes(file.size) + '. Maximum...');
throw new Error(`Stream CSV processing failed: ${err.message}`);
reject(new Error('Offscreen processing timed out (60s)'));
```

**Recommendation**: Standardize format:
```javascript
const Errors = {
  FILE_TOO_LARGE: (size, max) => 
    `File too large (${size}). Maximum supported: ${max}`,
  CONVERSION_TIMEOUT: () => 
    'Conversion timed out after 60 seconds',
  LIBRARY_LOAD_FAILED: (lib) => 
    `Failed to load ${lib} library`
};
```

---

### 4. Missing JSDoc
**Issue**: Many functions lack documentation

**Recommendation**: Add JSDoc comments:
```javascript
/**
 * Intercepts file drop events and prompts user for Markdown conversion.
 * @param {DragEvent} event - The captured drop event
 * @returns {void}
 */
function handleDropCapture(event) { ... }
```

---

## 🚀 Performance Optimizations

### 1. Debounce Config Saves
**Issue**: Every slider movement triggers storage write

```javascript
timerSlider.addEventListener('input', () => {
  timerValue.textContent = val + 's';
});
timerSlider.addEventListener('change', () => {  // ✅ Good!
  saveConfig({ autoDismissSeconds: val });
});
```

**Status**: Already optimized in most places. Check all sliders.

---

### 2. Lazy Load Parser Libraries
**Status**: Already implemented ✅

```javascript
// offscreen.js:545-550
case '.docx':
  if (typeof mammoth === 'undefined') {
    await loadScript('lib/mammoth.browser.min.js');
  }
```

---

### 3. PDF Worker Path Optimization
**Issue**: Worker path set on every PDF conversion

```javascript
// offscreen.js:308
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
```

**Recommendation**: Set once during offscreen initialization:
```javascript
// Run only once when offscreen document loads
(async function initPDFWorker() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 
      chrome.runtime.getURL('lib/pdf.worker.min.js');
  }
})();
```

---

### 4. CSV Row Limit
**Finding**: Hard limit at 100,000 rows

```javascript
// content.js:575
if (rowCount >= 100000) return;
```

**Recommendation**: Make configurable:
```javascript
const MAX_CSV_ROWS = config.maxCsvRows || 100000;
```

---

## 🔧 Refactoring Recommendations

### 1. Module Structure
**Current**: All code in single files (content.js: 1111 lines)

**Recommended**: Split into modules:
```
content/
├── index.js          # Initialization
├── interception.js   # Event handlers
├── toast.js          # Shadow DOM UI
├── converters/       # File processors
│   ├── text.js
│   ├── csv.js
│   └── rtf.js
├── binary-bridge.js  # Offscreen communication
└── utils/
    ├── config.js
    ├── validators.js
    └── formatters.js
```

**Benefit**: Easier maintenance, better tree-shaking if bundled.

---

### 2. State Management
**Current**: Global `config` object mutated directly

**Recommended**: Immutable updates with validation:
```javascript
class ConfigManager {
  constructor() {
    this._config = DEFAULT_CONFIG;
  }
  
  update(partial) {
    const validated = this._validate(partial);
    this._config = { ...this._config, ...validated };
    this._persist();
    this._notifyListeners();
  }
  
  _validate(config) {
    // Schema validation
    if (config.autoDismissSeconds < 0 || config.autoDismissSeconds > 30) {
      throw new Error('Invalid timer value');
    }
    return config;
  }
}
```

---

### 3. Event Bus Pattern
**Current**: Direct function calls for toast actions

**Recommended**: Pub/sub for decoupling:
```javascript
const EventBus = {
  _listeners: new Map(),
  on(event, cb) { /* ... */ },
  emit(event, data) { /* ... */ }
};

// Usage
EventBus.on('FILE_INTERCEPTED', (file) => showToast(file));
EventBus.emit('FILE_INTERCEPTED', file);
```

---

## 📊 Testing Gaps

### Missing Test Coverage

1. **Unit Tests**: None present
   - Recommend: Jest + Puppeteer for extension testing
   
2. **Integration Tests**:
   - File interception flow
   - Port communication between content/background/offscreen
   - Config sync across tabs

3. **E2E Tests**:
   - Upload DOCX → Verify Markdown output
   - Test blacklist enforcement
   - Verify dark mode rendering

4. **Performance Tests**:
   - Memory usage with large files (50MB)
   - Concurrent conversion handling
   - Script load timeout scenarios

---

## ✅ Positive Findings

The following security best practices are **already implemented**:

| Feature | Status | Location |
|---------|--------|----------|
| Transferable Objects | ✅ | `content.js:815` |
| Capture-phase interception | ✅ | `content.js:987` |
| Shadow DOM encapsulation | ✅ | `content.js:159` |
| Content sniffing | ✅ | `content.js:471-494` |
| ReDoS pattern detection | ✅ | `content.js:905-923` |
| Aggressive memory cleanup | ✅ | `offscreen.js:606-632` |
| Reference counting | ✅ | `content.js:758-808` |
| Input sanitization (YAML) | ✅ | `content.js:870-877` |
| Timeout handlers | ✅ | Multiple locations |
| Error boundaries | ✅ | Try-catch blocks |

---

## 🎯 Priority Action Items

### Critical (Immediate) - ✅ COMPLETED
- [x] Add Content Security Policy to manifest (`manifest.json` updated)

### High (Next Release) - ✅ COMPLETED
- [x] Replace innerHTML with textContent for dynamic content (`content.js`, `popup.js` refactored)
- [x] Add SRI hashes to library script tags (`offscreen.js` updated with SRI_HASHES constant)
- [ ] Implement proper error message sanitization (low priority - current implementation is acceptable)

### Medium (Future)
- [ ] Integrate regexp-tree for better ReDoS detection (current heuristic approach provides adequate protection)
- [ ] Add encryption for sensitive storage data (chrome.storage.local is sandboxed per-extension)
- [ ] Create automated test suite

### Low (Nice-to-Have)
- [ ] Refactor into ES modules
- [ ] Add JSDoc documentation
- [ ] Implement immutable config management
- [ ] Consider optional permissions model

---

## 📝 Conclusion

FTM Studio demonstrates **strong security fundamentals** with excellent privacy guarantees (100% local processing) and solid architectural decisions (Transferable Objects, Shadow DOM, capture-phase interception).

The main areas for improvement are:
1. **CSP headers** (critical for extension security)
2. **XSS prevention** (replace innerHTML patterns)
3. **Library integrity** (add SRI hashes)

With these improvements, the extension would achieve enterprise-grade security posture while maintaining its privacy-first philosophy.

**Overall Risk Rating**: LOW  
**Recommended Actions**: 3 Critical, 3 High, 4 Medium, 4 Low

---

*Audit completed: 2026*  
*Extension version audited: 6.5.0*
