# FTM Studio — File to Markdown Converter

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Privacy First](https://img.shields.io/badge/Privacy-100%25%20Local-green)]()
[![Version](https://img.shields.io/badge/version-3.0.0-orange)]()
[![Tests](https://img.shields.io/badge/tests-62%20passing-brightgreen)]()

A **privacy-first**, **100% local** Chrome extension that intercepts file uploads on AI/chatbot websites and converts documents to structured Markdown **before data leaves your browser**. All processing happens client-side — no servers, no cloud, no tracking.

---

## Features

### Smart Mode

The extension only activates on **AI and chatbot sites** by default — no annoying popups on Gmail, banking, or social media.

- **200+ built-in AI platforms** auto-detected (ChatGPT, Claude, Gemini, Cursor, Midjourney, etc.)
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

- **ReDoS Protection** — structural pattern rejection plus adversarial timing probes, cached per pattern and flags
- **CSV Formula Injection** — sanitizes `=`, `+`, `-`, `@`, `|`, tab and CR prefixed cells, including leading whitespace
- **YAML Injection** — metadata emitted as double-quoted scalars with legal escapes only
- **Magic Byte Detection** — identifies binary formats by signature
- **Content Size Limits** — 50MB binary / 10MB text / 10MB image hard limits
- **Fail-Closed Activation** — extension disables itself on errors instead of activating everywhere

### Other Capabilities

- **Chunked Binary Transport** — files stream to the parser in bounded base64 chunks (extension messaging is JSON, so transfer lists are silently ignored)
- **On-Demand Injection** — content scripts are registered dynamically, so nothing is injected into non-AI pages
- **Shadow DOM Toast** — encapsulated, non-intrusive prompt with file type badges
- **Capture-Phase Interception** — fires before React/Vue/Svelte handlers
- **YAML Frontmatter** — auto-injects metadata
- **Regex Pipeline** — custom sanitization rules (ReDoS-protected)
- **CSV Streaming** — handles large files via Papa Parse
- **Conversion History** — persistent log with file sizes and JSON export
- **Dark Mode** — respects system preference
- **AI Site Search** — filter through 200+ built-in AI platforms
- **Processing Spinner** — visual feedback during binary file conversion
- **Multi-File Uploads** — the first eligible file is converted and the remaining files are re-dispatched untouched

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

---

## How It Works

### The Big Picture

FTM Studio sits quietly in your browser and watches for file uploads. When you drag a file onto an AI chatbot (or click a file input), it intercepts the upload, converts the file to Markdown, and substitutes the converted file — all before the data reaches the website.

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER PAGE                             │
│                                                                 │
│   User drops file ──→ Content Script (intercept.js)             │
│                           │                                     │
│                           ▼                                     │
│                    ┌──────────────┐                             │
│                    │  Toast UI    │  "Convert to Markdown?"     │
│                    │  (Shadow DOM)│  [Convert] [Skip]           │
│                    └──────┬───────┘                             │
│                           │                                     │
│                    ┌──────▼───────┐                             │
│                    │  Convert?    │                             │
│                    └──┬───────┬───┘                             │
│                   Yes │       │ No                              │
│                       ▼       ▼                                 │
│              Process file   Pass through                        │
│                       │     unchanged                           │
│                       ▼                                         │
│            ┌─────────────────────┐                             │
│            │  File Type Router   │                             │
│            └──┬──────┬──────┬───┘                             │
│               │      │      │                                  │
│          Text/CSV  Image  Binary (DOCX, PDF, XLSX, etc.)       │
│               │      │      │                                  │
│               ▼      ▼      ▼                                  │
│          Content   Content  ┌──────────────┐                   │
│          Script    Script   │ Offscreen    │                   │
│          (local)   (local)  │ Document     │                   │
│                             │ (isolated)   │                   │
│                             └──────┬───────┘                   │
│                                    │                           │
│                             ┌──────▼───────┐                   │
│                             │  Markdown    │                   │
│                             │  Result      │                   │
│                             └──────┬───────┘                   │
│                                    │                           │
│                             ┌──────▼───────┐                   │
│                             │ Post-process │                   │
│                             │ • YAML meta  │                   │
│                             │ • Regex rules│                   │
│                             │ • Sanitize   │                   │
│                             └──────┬───────┘                   │
│                                    │                           │
│                             ┌──────▼───────┐                   │
│                             │ Substitute   │                   │
│                             │ .md file via │                   │
│                             │ DataTransfer │                   │
│                             │ API          │                   │
│                             └──────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Flow

1. **Event Capture** — `intercept.js` registers capture-phase listeners for `drop` and `change` events. Capture phase fires *before* the page's own handlers (React, Vue, Svelte), so the extension gets first dibs.

2. **Smart Mode Check** — the verdict is computed once per document and cached (invalidated on config changes). `shouldActivate()` checks if the current site is a known AI platform (200+ built-in hosts). If Smart Mode is off, it activates everywhere. Blacklisted domains are always skipped.

3. **File Type Detection** — The file extension maps to a category (documents, pdf, spreadsheets, etc.). If that category is enabled in settings, the file is intercepted. A secondary magic-byte check verifies the actual file type matches the extension.

4. **Toast Prompt** — A Shadow DOM toast appears with the file name, type badge, and size. Users can press Enter to convert, Esc to skip, or wait for the auto-skip countdown.

5. **Conversion** — Based on file type:
   - **Text files** (`.txt`, `.md`, `.py`, `.js`, `.json`, etc.) — Read directly via `FileReader`, wrapped in a code block
   - **CSV** — Parsed via Papa Parse, converted to Markdown table. Large files (>5MB) use streaming mode
   - **RTF** — Stripped to plain text via regex
   - **Images** — Converted to base64 data URI and embedded as Markdown images
   - **Binary files** (`.docx`, `.xlsx`, `.pdf`, `.epub`, `.pptx`) — bytes are sent in bounded base64 chunks to an offscreen document where parser libraries (mammoth, SheetJS, PDF.js, JSZip) run in isolation

6. **Post-Processing** — The Markdown goes through:
   - Trailing whitespace removal
   - Blank line collapsing
   - Heading hierarchy enforcement (optional)
   - Custom regex pipeline (optional)
   - YAML frontmatter injection (filename, size, timestamp)

7. **File Substitution** — The original file in the upload input is replaced with a `.md` file using the DataTransfer API. A `change` event is dispatched so the website's JavaScript picks up the new file.

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Content Script (runs on every page)       │
│                                                     │
│  shared/{constants,text,config}.js                  │
│  content/{config,activation,postprocess}.js         │
│  content/{converters,transport,router}.js           │
│  content/{history,toast,intercept}.js               │
│  Registered dynamically (chrome.scripting), so only │
│  activatable hosts are instrumented.                │
└───────────────────────┬─────────────────────────────┘
                        │ Port: "ftm"
                        ▼
┌─────────────────────────────────────────────────────┐
│  Layer 2: Background Service Worker                 │
│                                                     │
│  background.js + sw/{offscreen-manager,bridge,      │
│  registrar}.js — port bridging, refcounted offscreen │
│  lifecycle, config fan-out, script registration     │
└───────────────────────┬─────────────────────────────┘
                        │ Port: "ftm-offscreen-internal"
                        ▼
┌─────────────────────────────────────────────────────┐
│  Layer 3: Offscreen Document (ephemeral)            │
│                                                     │
│  offscreen.js + offscreen/{loader,documents,        │
│  archives,tabular}.js — one session per port, libs  │
│  loaded lazily, document closed when idle           │
│                                                     │
│  Libraries: mammoth, xlsx, jszip, turndown,         │
│  turndown-plugin-gfm, pdf.js, papaparse             │
└─────────────────────────────────────────────────────┘
```

**Why three layers?**
- **Content scripts** can't load libraries from extension resources (CSP restrictions)
- **Service workers** can't access DOM APIs (needed for parser libraries)
- **Offscreen document** is a hidden DOM context that can load libraries and parse files, then destroy itself when done — zero memory overhead when idle

### Chunked Binary Transport

`chrome.runtime.Port.postMessage` has no transfer-list parameter and serialises
its payload as JSON, so `ArrayBuffer`s cannot be moved (or even sent) over it.
Bytes are therefore framed as bounded base64 chunks:

```js
port.postMessage({ type: 'BEGIN', data: { fileName, extension, size, totalChunks } });
for (const base64 of FTM.text.encodeChunks(bytes)) {
  port.postMessage({ type: 'CHUNK', data: { base64 } });
}
port.postMessage({ type: 'END' });
```

Each chunk is 512 KB, so peak transport overhead is bounded regardless of file
size, and the offscreen document reassembles the payload before parsing.

### Smart Mode Activation

```
User visits a site
       │
       ▼
Is domain blacklisted? ──Yes──→ Skip (never activate)
       │ No
       ▼
Is Smart Mode ON? ──No──→ Activate everywhere
       │ Yes
       ▼
Is domain in whitelist?
Or in built-in AI hosts (200+)?
Or in custom overrides (+domain)?
       │
    Yes │         No
       ▼          ▼
  Activate      Skip
```

Custom overrides:
- `+my-ai.com` — add a site to the activation list
- `-poe.com` — remove a built-in site from activation

---

## Configuration

Click the extension icon to open the settings dashboard.

### General Tab

| Option | Description |
|--------|-----------|
| **Master Toggle** | Enable/disable the extension entirely |
| **Smart Mode** | Only intercept on AI/chatbot sites (default: on) |
| **Auto-Convert** | Convert files without showing the toast prompt |
| **AI Sites** | Search, add, or remove AI platforms |
| **File Formats** | Enable/disable specific file categories |
| **Blocked Domains** | Exclude specific sites |

### Advanced Tab

| Option | Description |
|--------|-----------|
| **YAML Frontmatter** | Inject metadata header |
| **CSV Stream Threshold** | Size threshold for streaming (1–50 MB) |
| **Strip Trailing Whitespace** | Clean up extra spaces |
| **Enforce Heading Hierarchy** | Normalize heading levels |
| **RegEx Pipeline** | Custom find/replace rules |

### History Tab

- View past conversions with file sizes
- Export history as JSON
- Clear conversion log

---

## Security & Privacy

### Privacy

- **No network requests** — 100% local processing
- **No telemetry** — zero analytics or tracking
- **No cloud storage** — config in `chrome.storage.local`
- **Ephemeral offscreen** — parser libraries unloaded after each conversion

### Threat Mitigations

| Threat | Mitigation |
|--------|-----------|
| ReDoS | Structural pattern rejection (nested/bounded quantifiers) + adversarial timing probes, cached per pattern *and* flags with a bounded LRU |
| CSV Formula Injection | Cells prefixed with `'` before `=`, `+`, `-`, `@` |
| YAML Injection | Values emitted as double-quoted scalars with only legal YAML escapes |
| Binary Disguise | Magic byte signatures + null-byte heuristic |
| Domain Blacklist Bypass | Exact/suffix hostname matching |
| Memory Leaks | Reference-counted offscreen document closed when idle; bounded chunk buffers |
| Race Conditions | Messages received before the offscreen document exists are queued, not dropped |
| Large File DoS | 50MB binary / 10MB text / 10MB image hard limits, bounded message queue |
| Activation Fail-Open | `shouldActivate()` returns false on errors; registration fails closed instead of falling back to `<all_urls>` |
| Extension Fingerprinting | No `web_accessible_resources`; parser libraries are only reachable from extension pages |
| Arbitrary Code Execution | PDF.js 4.10.38 with `isEvalSupported: false` (CVE-2024-4367) |

---

## Development

### Testing

```bash
npm install
npm test          # node --test test/ — 62 tests against the real sources
npm run lint      # eslint
npm run verify:libs   # SHA-256 verification of the pinned parser libraries
```

The suite loads the actual extension modules in a `vm` context with stubbed
Chrome APIs (`test/harness.js`) instead of re-implementing them, so regressions
in the shipped code cannot pass unnoticed. It covers the shared text/config
helpers, activation gating, post-processing and ReDoS defences, the chunked
transport and offscreen session protocol, bridge queueing and offscreen
refcounting, fail-closed script registration, history merging, and static
source/manifest invariants.

### Library Management

Libraries are pinned in `lib/lockfile.json` with SHA-256 hashes.

```bash
./lib/update.sh                 # Verify all 8 libraries against lockfile.json
./lib/update.sh pdf.min.mjs     # Re-download one lockfile entry
./lib/update.sh all             # Re-download everything
```

Names, URLs, versions and hashes all come from `lockfile.json`, so the script
and the lockfile cannot drift apart.

### Project Structure

```
FTMStudio/
├── file-to-markdown-extension/   # The extension
│   ├── manifest.json             # MV3 config, permissions, CSP
│   ├── background.js             # Service worker entry point
│   ├── shared/                   # Loaded in every context
│   │   ├── constants.js          # Limits, extension maps, AI hosts, protocol
│   │   ├── text.js               # Escaping, tables, base64 chunks, history merge
│   │   └── config.js             # Defaults + prototype-safe merge
│   ├── sw/                       # Service worker modules
│   │   ├── offscreen-manager.js  # Refcounted offscreen lifecycle
│   │   ├── bridge.js             # Content ↔ offscreen port bridge
│   │   └── registrar.js         # Dynamic content-script registration
│   ├── content/                  # Injected modules
│   │   ├── config.js             # Config state + CONFIG_UPDATE handling
│   │   ├── activation.js         # Cached host gating, file eligibility
│   │   ├── postprocess.js        # YAML frontmatter, regex pipeline, ReDoS guard
│   │   ├── converters.js         # Text/RTF/image conversion
│   │   ├── transport.js          # Chunked port transport
│   │   ├── router.js             # Extension → converter dispatch
│   │   ├── history.js            # Debounced, merge-on-write history
│   │   ├── toast.js              # Shadow DOM toast UI (CSS countdown)
│   │   └── intercept.js          # Event capture, session state, re-dispatch
│   ├── offscreen.js / .html      # Session protocol + parser host
│   ├── offscreen/                # loader, documents, archives, tabular
│   ├── popup.html / .js / .css   # Settings dashboard
│   ├── lib/                      # 8 pinned parser libraries
│   └── icons/                    # Extension icons (16/48/128px)
├── test/                         # node:test suite + real-source harness
├── package.json / eslint.config.mjs
├── README.md
└── SECURITY_AUDIT.md
```

---

## Strengths & Weaknesses

### Strengths

| Strength | Detail |
|----------|--------|
| **100% Private** | Zero network requests. No telemetry, no cloud, no tracking. All processing happens locally in the browser. Even the parser libraries are bundled — no CDN calls at runtime. |
| **Zero Memory Overhead When Idle** | The offscreen document (where heavy parsers run) is created on demand and destroyed immediately after use. When no file is being converted, the extension uses near-zero memory. |
| **Bounded Binary Transport** | Files are framed as 512 KB base64 chunks over the port, so transport overhead stays constant instead of scaling with file size. |
| **Smart Mode** | Only activates on 200+ known AI platforms by default. Won't intercept uploads on Gmail, banking, government, or social media sites. Reduces attack surface and avoids annoying users. |
| **Capture-Phase Interception** | Event listeners fire at capture phase, before React/Vue/Svelte synthetic event handlers. This means the extension intercepts files even on heavily-frameworked SPAs. |
| **Shadow DOM Isolation** | The toast UI uses `mode: 'closed'` Shadow DOM, so host page CSS can't break the extension's styling, and the extension can't leak styles into the page. |
| **Security-Hardened** | ReDoS protection, CSV formula injection prevention, YAML injection escaping, magic byte validation, fail-closed activation, port race condition guards, message validation. |
| **Tests Run Against the Real Sources** | 62 `node:test` cases load the shipped modules in a `vm` context with stubbed Chrome APIs, so a regression in the extension fails the suite. |
| **Library Integrity Verification** | All 8 parser libraries pinned with SHA-256 hashes in `lockfile.json`. `update.sh` verifies integrity before and after updates. |
| **Modular Architecture** | Shared, service-worker, content and offscreen modules with single responsibilities and no duplicated config/conversion logic. |
| **Graceful Degradation** | If a conversion fails, the original file is re-dispatched so the upload still works. |
| **Accessibility** | ARIA labels, roles, expanded states on all interactive elements. Focus-visible styles for keyboard navigation. Screen reader compatible. |

### Weaknesses

| Weakness | Detail | Impact |
|----------|--------|--------|
| **Text-Only PDF Extraction** | PDF.js extracts text content only. Scanned PDFs (image-based), password-protected PDFs, and PDFs with complex layouts (tables, multi-column) produce poor output. | Medium — common use case with degraded quality |
| **No DOCX Visual Layout** | Mammoth.js extracts semantic HTML from DOCX, not visual layout. Tables, images, headers/footers, and complex formatting are lost or simplified. | Medium — output differs from visual appearance |
| **No DRM/Protected Content** | DRM-protected EPUBs, encrypted PDFs, and password-protected Office files cannot be processed. | Low — expected limitation, no workaround possible |
| **ReDoS Protection Is Heuristic** | Structural detection plus adversarial timing probes rejects the known catastrophic shapes, including bounded nested quantifiers, but is not a formal automaton analysis. | Low — mitigated by the 2MB pipeline input guard |
| **`<all_urls>` Host Permission** | The permission is still requested so Smart Mode can register scripts for user-added hosts, but scripts are only *registered* for activatable hosts. | Low — no code runs on non-matching sites |
| **One Converted File Per Upload** | Multi-file uploads convert the first eligible file; the remaining files are passed through unchanged rather than converted. | Low — most AI chatbots accept one document at a time |
| **No Streaming for Binary Files** | Binary files (DOCX, PDF, XLSX) are fully loaded into memory before processing. Very large files (near the 50MB limit) may cause temporary memory spikes. | Low — 50MB cap prevents extreme cases |
| **RTF Parser Is Basic** | Regex-based RTF stripping handles common cases but fails on complex RTF with nested groups, embedded objects, or OLE elements. | Low — RTF is increasingly rare |
| **No Offline Installation** | Libraries are bundled in the extension, so it works offline. However, the `update.sh` tool requires internet to download library updates. | Negligible — only affects development |
| **Chrome-Only** | Uses Chrome-specific APIs (offscreen documents, `chrome.runtime.getContexts`). Not compatible with Firefox, Safari, or Edge (without Chromium). | Low — Chrome has ~65% browser market share |

---

## Known Limitations

| Format | Limitation |
|--------|-----------|
| **DOCX** | Mammoth extracts semantics, not visual layout. Images stripped. |
| **PDF** | Text-only. Scanned PDFs (images) not supported. |
| **PPTX** | Text content only. Animations and media ignored. |
| **EPUB** | DRM-protected ebooks cannot be processed. |
| **RTF** | Basic parser; embedded images/OLE not supported. |

---

## Contributing

- Follow existing code style (single quotes, no semicolons optional)
- Test on Chrome 116+
- Run `npm test && npm run lint` before submitting PRs
- No new external dependencies without discussion

---

## License

MIT License

---

## Acknowledgments

- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — DOCX parsing
- [SheetJS](https://github.com/SheetJS/sheetjs) — XLSX/XLS parsing
- [PDF.js](https://github.com/mozilla/pdf.js) — PDF text extraction
- [JSZip](https://github.com/Stuk/jszip) — ZIP handling (EPUB/PPTX)
- [Turndown](https://github.com/mixmark-io/turndown) — HTML to Markdown
- [Turndown GFM](https://github.com/mixmark-io/turndown-plugin-gfm) — GitHub Flavored Markdown
- [Papa Parse](https://github.com/mholt/PapaParse) — CSV streaming

---

*Version 3.0.0*
