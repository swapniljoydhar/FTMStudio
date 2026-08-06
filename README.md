# FTM Studio — File to Markdown Converter

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Privacy First](https://img.shields.io/badge/Privacy-100%25%20Local-green)]()
[![Version](https://img.shields.io/badge/version-3.0.0-orange)]()
[![Tests](https://img.shields.io/badge/tests-139%20passing-brightgreen)]()

A **privacy-first**, **100% local** Chrome extension that intercepts file uploads on AI/chatbot websites and converts documents to structured Markdown **before data leaves your browser**. All processing happens client-side — no servers, no cloud, no tracking.

---

## Features

### Smart Mode

The extension only activates on **AI and chatbot sites** by default — no annoying popups on Gmail, banking, or social media.

- **220+ built-in AI platforms** auto-detected (ChatGPT, Claude, Gemini, Grok, DeepSeek, Cursor, Midjourney, etc.)
- **Custom sites** — add your own AI tools or internal platforms
- **Blacklist** — exclude specific sites even on Smart Mode
- **Classic Mode** — toggle off Smart Mode to intercept everywhere

### Supported Formats

| Category | Extensions |
|----------|-----------|
| **Documents** | `.docx`, `.txt`, `.rtf`, `.md` |
| **PDF** | `.pdf` |
| **Spreadsheets** | `.csv`, `.xlsx`, `.xls` |
| **Presentations** | `.pptx` |
| **Markup & Ebooks** | `.html`, `.epub`, `.svg` |
| **Source Code** | `.py`, `.js`, `.cpp`, `.css`, `.json`, `.xml` |
| **Images** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` |

### Security Features

- **ReDoS Protection** — progressive scaling probe with 15ms budget and exponential growth detection
- **CSV Formula Injection** — risky cells wrapped in code spans instead of corrupting prefixes
- **YAML Injection** — filenames sanitized with `plain()` before YAML serialization
- **Magic Byte Detection** — identifies binary formats by signature
- **Polyglot Defense** — structural validation (PDF `%%EOF`, DOCX ZIP integrity) beyond magic bytes
- **Content Size Limits** — 50MB binary / 10MB text / 10MB image hard limits
- **Fail-Closed Activation** — visible error toast on config corruption instead of silent disable
- **SW Keepalive** — heartbeat prevents Chrome from killing service worker during long conversions
- **DataTransfer Fallback** — multi-strategy injection with clipboard backup for hardened sites

### Visual Indicators

- **Toolbar Badge** — green when active, gray "OFF" badge when disabled
- **Popup Header** — accent border, pulsing status dot, logo dimming reflects state
- **Splash Animation** — GPU-only intro animation with `#` icon morph (respects `prefers-reduced-motion`)
- **Auto-Focus** — Convert button receives keyboard focus for accessibility

### Conversion Quality

- **Layout-Aware PDF** — multi-column line clustering, table detection from column alignment
- **DOCX Images** — preserved as base64 data URIs (2MB cap per image)
- **RTF Parser** — full state-machine parser handling nested groups, CP1252, bold/italic
- **EPUB Chapter Titles** — extracted from HTML headings, not filenames
- **Heading Hierarchy** — no skipped levels (H1→H3 becomes H1→H2)
- **TOC Removal** — dot-leader table-of-contents patterns stripped automatically
- **Cover Artifact Stripping** — license notices, boilerplate, empty headings removed
- **HTML Entity Decode** — handles double-encoded entities (`&amp;amp;` → `&`)
- **YAML Frontmatter** — includes `token_estimate`, `content_hash`, `word_count`, `recommended_chunk_level`
- **Image Mode** — choose `embedded` (default), `placeholder`, or `external`; local DOCX images use a placeholder for the latter two modes because no external image URL exists
- **PDF Header/Footer Dedup** — repeated lines across pages removed
- **Password-Protected PDFs** — clear error message instead of silent failure

### Secrets and environment variables

FTM Studio is a client-only extension and currently requires no runtime secrets
or environment variables. It does not use Supabase, Stripe, OAuth, JWT signing,
database connections, or third-party API credentials. Keep `.env` files local;
`.env.example` documents the current no-variable configuration. Never place a
service-role key, secret key, database connection string, OAuth client secret, or
JWT signing secret in extension code or a browser-exposed environment variable.

Git history warning: if a secret was ever hardcoded in an earlier revision,
removing it from the current tree does not remove it from Git history. Rotate
any previously hardcoded secrets immediately, then purge the exposed value from
repository history as appropriate.

### Other Capabilities

- **Streaming Transport** — files stream in 512KB chunks; only one chunk in memory at a time (~3× less RAM)
- **On-Demand Injection** — content scripts registered dynamically, nothing injected on non-AI pages
- **Shadow DOM Toast** — `mode: 'open'` for screen reader accessibility, `role="alert"`, `aria-live`
- **Capture + Bubble Phase** — handles React 18 synthetic events
- **Preserve Original MIME** — optional mode for picky upload validators
- **Scanned PDF OCR** — Tesseract.js WASM fallback (lazy-loaded, zero overhead for text-based PDFs)
- **Regex Pipeline** — custom sanitization rules (ReDoS-protected)
- **CSV Streaming** — handles large files via Papa Parse
- **Conversion History** — privacy-safe (extension-only filenames), 30-day auto-expiry, JSON export
- **Dark Mode** — respects system preference
- **Responsive UI** — adapts to narrow popup widths (300px+)
- **Collapsible Sections** — Output and File Formats collapse to reduce visual clutter

---

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/swapniljoydhar/FTMStudio.git
   cd FTMStudio
   ```
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `file-to-markdown-extension` folder

**Minimum Chrome version:** 116

### Permissions

The extension uses `storage`, `offscreen`, `scripting`, and `downloads`. It declares `<all_urls>` because Classic Mode intentionally supports arbitrary websites; Smart Mode dynamically registers and activates only on configured AI hosts. All conversion remains local.

---

## How It Works

### The Big Picture

FTM Studio sits quietly in your browser and watches for file uploads. When you drag a file onto an AI chatbot (or click a file input), it intercepts the upload, converts the file to Markdown, and substitutes the converted file — all before the data reaches the website.

### Step-by-Step Flow

1. **Event Capture** — `intercept.js` registers capture and bubble listeners for `drop` and `change` events, with per-event deduplication so React 18 compatibility does not duplicate conversion work.

2. **Smart Mode Check** — verdict computed once per document and cached. Checks 220+ built-in hosts plus custom overrides.

3. **File Type Detection** — extension maps to a category. Magic-byte sniffing detects disguised binaries (e.g., `.md` files with DOCX content). Structural validation checks PDF `%%EOF` and DOCX ZIP integrity.

4. **Toast Prompt** — accessible Shadow DOM toast (`mode: 'open'`, `role="alert"`) with auto-focused Convert button.

5. **Streaming Conversion** — binary files stream in 512KB chunks via `file.slice()` to the offscreen document. Only one chunk in memory at a time. Keepalive heartbeat prevents SW from being killed during long conversions.

6. **Post-Processing** — normalize → strip TOC → strip cover artifacts → enforce heading hierarchy → regex pipeline → YAML frontmatter.

7. **Multi-Strategy Injection** — DataTransfer API → property override → clipboard fallback. Original file re-dispatched on any failure.

### Three-Layer Architecture

```text
┌─────────────────────────────────────────────────────┐
│  Layer 1: Content Script (registered when enabled)  │
│  shared/{constants,text,config}.js                  │
│  content/{config,activation,postprocess}.js         │
│  content/{converters,transport,router}.js           │
│  content/{history,toast,intercept}.js               │
└───────────────────────┬─────────────────────────────┘
                        │ Port: "ftm"
                        ▼
┌─────────────────────────────────────────────────────┐
│  Layer 2: Background Service Worker                 │
│  background.js + sw/{offscreen-manager,bridge,      │
│  registrar}.js — port bridging, keepalive heartbeat │
│  refcounted offscreen lifecycle, config fan-out     │
└───────────────────────┬─────────────────────────────┘
                        │ Port: "ftm-offscreen-internal"
                        ▼
┌─────────────────────────────────────────────────────┐
│  Layer 3: Offscreen Document (ephemeral)            │
│  offscreen.js + offscreen/{loader,documents,        │
│  archives,tabular}.js — one session per port, libs  │
│  loaded lazily, document closed when idle           │
│  Libraries: mammoth, xlsx, jszip, turndown,         │
│  turndown-plugin-gfm, pdf.js, papaparse             │
└─────────────────────────────────────────────────────┘
```

### Streaming Binary Transport

Files stream via `file.slice()` — only one 512KB chunk in memory at a time:

```text
Sender (content script):          Receiver (offscreen):
  file.slice(0, 512KB)              chunk 1 → decode → bounded write
  → base64 → send → release         chunk 2 → decode → bounded write
  file.slice(512KB, 1MB)             chunk 3 → decode → bounded write
  → base64 → send → release         ... → parser input
```

Transport memory is bounded to one chunk at a time; the receiver uses one declared-size buffer for formats that require random access.

---

## Configuration

Click the extension icon to open the settings dashboard with collapsible sections.

### General Tab

| Option | Description |
|--------|-----------|
| **Master Toggle** | Enable/disable the extension entirely |
| **Smart Mode** | Only intercept on AI/chatbot sites (default: on) |
| **Auto-Convert** | Convert files without showing the toast prompt |
| **YAML Frontmatter** | Inject metadata header (with token estimate, content hash) |
| **Preserve Original MIME** | Use source file's MIME type on converted `.md` |
| **Image Mode** | `embedded` (default), `placeholder`, or `external`; local DOCX images use a placeholder for the latter two modes |
| **File Formats** | Enable/disable specific file categories (collapsible) |

### Sites Tab

| Option | Description |
|--------|-----------|
| **AI Sites** | Search, add, or remove AI platforms (220+ built-in) |
| **Custom Sites** | Add your own AI tools or internal platforms |
| **Blocked Domains** | Exclude specific sites even on Smart Mode |

### Advanced Tab

| Option | Description |
|--------|-----------|
| **CSV Stream Threshold** | Size threshold for streaming (1–50 MB) |
| **Strip Trailing Whitespace** | Clean up extra spaces |
| **Enforce Heading Hierarchy** | Normalize heading levels, prevent skipped levels |
| **RegEx Pipeline** | Custom find/replace rules (ReDoS-protected) |

### History Tab

- Privacy-safe: filenames stored as `*.ext` only (not raw names)
- Auto-expires entries older than 30 days
- Export history as JSON (with privacy warning)
- Clear conversion log

---

## Security & Privacy

### Privacy

- **No network requests** — 100% local processing
- **No telemetry** — zero analytics or tracking
- **No cloud storage** — config in `chrome.storage.local`
- **Ephemeral offscreen** — the document closes and releases parser state when idle
- **Privacy-safe history** — filenames stored as extension patterns only, 30-day auto-expiry

### Threat Mitigations

| Threat | Mitigation |
|--------|-----------|
| ReDoS | Progressive scaling probe (3 input sizes, 15ms budget, 10× growth rejection) |
| CSV Formula Injection | Risky cells wrapped in code spans (`` `+880...` ``) — neutralizes formulas without corrupting data |
| YAML Injection | Filenames sanitized with `plain()` before `yamlString()` — control chars stripped |
| Binary Disguise | Magic byte signatures + null-byte heuristic + structural validation (PDF `%%EOF`, DOCX ZIP) |
| Polyglot Files | Structural validation after magic byte check; `isEvalSupported: false` in PDF.js |
| Domain Blacklist Bypass | Exact/suffix hostname matching |
| Memory Leaks | Streaming transport (one 512KB chunk at a time); refcounted offscreen; bounded caches |
| Race Conditions | Messages queued before offscreen exists; `session.busy` set before async sniff |
| Large File DoS | 50MB binary / 10MB text / 10MB image hard limits |
| Service Worker Death | Keepalive heartbeat every 10s during active conversion |
| DataTransfer Rejection | Multi-strategy: DataTransfer → property override → clipboard fallback |
| Config Corruption | Visible error toast; falls back to defaults instead of silent disable |
| Silent Failures | Original file re-dispatched on any conversion error |
| History PII Leak | Filenames stored as `*.ext` only; 30-day auto-expiry |
| Screen Reader Inaccessibility | `mode: 'open'` shadow, `role="alert"`, `aria-live`, auto-focus |

---

## Development

### Testing

```bash
npm install
npm test          # node — 139 tests against the real sources
npm run lint      # eslint
npm run verify:libs   # SHA-256 verification of the pinned parser libraries
```

GitHub Actions runs these same checks on every push and pull request. The
The [library lockfile](file-to-markdown-extension/lib/lockfile.json) is authoritative for
vendor versions, URLs, sizes, and SHA-256 hashes; it includes the English Tesseract
data required by scanned-PDF OCR. Run `npm run verify:libs` after any intentional
library update.

### Project Structure

```text
FTMStudio/
├── file-to-markdown-extension/
│   ├── manifest.json
│   ├── background.js              # Service worker + badge + keepalive init
│   ├── shared/
│   │   ├── constants.js           # Limits, extension maps, AI hosts, protocol
│   │   ├── text.js                # Escaping, tables, RTF parser, HTML entity decode
│   │   └── config.js              # Defaults + prototype-safe merge
│   ├── sw/
│   │   ├── offscreen-manager.js   # Refcounted offscreen lifecycle
│   │   ├── bridge.js              # Content ↔ offscreen relay + keepalive
│   │   └── registrar.js           # Dynamic content-script registration
│   ├── content/
│   │   ├── config.js              # Config state + CONFIG_UPDATE handling
│   │   ├── activation.js          # Host gating, file eligibility
│   │   ├── postprocess.js         # YAML, regex, ReDoS, TOC, cover stripping
│   │   ├── converters.js          # Text/RTF/image conversion
│   │   ├── transport.js           # Streaming chunked transport
│   │   ├── router.js              # Extension → converter dispatch
│   │   ├── history.js             # Privacy-safe, auto-expiring history
│   │   ├── toast.js               # Accessible toast UI (open shadow, a11y)
│   │   └── intercept.js           # Sniffing, validation, multi-strategy injection
│   ├── offscreen.js / .html       # Session protocol + parser host
│   ├── offscreen/
│   │   ├── loader.js              # On-demand library loading
│   │   ├── documents.js           # DOCX/PDF/spreadsheet parsers
│   │   ├── archives.js            # EPUB/PPTX parsers
│   │   └── tabular.js             # CSV parser
│   ├── popup.html / .js / .css    # Settings dashboard + splash + accordions
│   ├── lib/                       # Pinned parser libraries
│   └── icons/                     # Extension icons
├── test/                          # 139 node:test cases
├── package.json
├── README.md
├── LICENSE
├── NOTICE.md
└── SECURITY_AUDIT.md
```

---

## Acknowledgments

- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — DOCX parsing
- [SheetJS](https://github.com/SheetJS/sheetjs) — XLSX/XLS parsing
- [PDF.js](https://github.com/mozilla/pdf.js) — PDF text extraction
- [JSZip](https://github.com/Stuk/jszip) — ZIP handling (EPUB/PPTX)
- [Turndown](https://github.com/mixmark-io/turndown) — HTML to Markdown
- [Turndown GFM](https://github.com/mixmark-io/turndown-plugin-gfm) — GitHub Flavored Markdown
- [Papa Parse](https://github.com/mholt/PapaParse) — CSV streaming
- [Tesseract.js](https://github.com/naptha/tesseract.js) — OCR for scanned PDFs (lazy-loaded)
- Inspired by [microsoft/markitdown](https://github.com/microsoft/markitdown), [epub2MD](https://github.com/uxiew/epub2MD), [any2md](https://github.com/rocklambros/any2md), [fb2cng](https://github.com/rupor-github/fb2cng)

---

## License

FTM Studio's original source code is licensed under the [Apache License 2.0](LICENSE).

Bundled third-party libraries retain their respective licenses. See [NOTICE.md](NOTICE.md)
for the dependency and attribution summary.

---

*Version 3.0.0 — 139 tests passing*
