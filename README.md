# FTM Studio — File to Markdown Converter

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Privacy First](https://img.shields.io/badge/Privacy-100%25%20Local-green)]()
[![Version](https://img.shields.io/badge/version-2.0.0-orange)]()
[![Tests](https://img.shields.io/badge/tests-233%20passing-brightgreen)]()

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

- **ReDoS Protection** — timing-based regex validation
- **CSV Formula Injection** — sanitizes `=`, `+`, `-`, `@` prefixed cells
- **YAML Injection** — escapes special characters in filenames
- **Magic Byte Detection** — identifies binary formats by signature
- **Content Size Limits** — 50MB binary / 10MB text hard limits
- **Fail-Closed Activation** — extension disables itself on errors instead of activating everywhere

### Other Capabilities

- **Zero-Copy Architecture** — Transferable Objects for instant ArrayBuffer transfer
- **Shadow DOM Toast** — encapsulated, non-intrusive prompt with file type badges
- **Capture-Phase Interception** — fires before React/Vue/Svelte handlers
- **YAML Frontmatter** — auto-injects metadata
- **Regex Pipeline** — custom sanitization rules (ReDoS-protected)
- **CSV Streaming** — handles large files via Papa Parse
- **Conversion History** — persistent log with file sizes and JSON export
- **Dark Mode** — respects system preference
- **AI Site Search** — filter through 200+ built-in AI platforms
- **Processing Spinner** — visual feedback during binary file conversion

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

2. **Smart Mode Check** — `shouldActivate()` checks if the current site is a known AI platform (200+ built-in hosts). If Smart Mode is off, it activates everywhere. Blacklisted domains are always skipped.

3. **File Type Detection** — The file extension maps to a category (documents, pdf, spreadsheets, etc.). If that category is enabled in settings, the file is intercepted. A secondary magic-byte check verifies the actual file type matches the extension.

4. **Toast Prompt** — A Shadow DOM toast appears with the file name, type badge, and size. Users can press Enter to convert, Esc to skip, or wait for the auto-skip countdown.

5. **Conversion** — Based on file type:
   - **Text files** (`.txt`, `.md`, `.py`, `.js`, `.json`, etc.) — Read directly via `FileReader`, wrapped in a code block
   - **CSV** — Parsed via Papa Parse, converted to Markdown table. Large files (>5MB) use streaming mode
   - **RTF** — Stripped to plain text via regex
   - **Images** — Converted to base64 data URI and embedded as Markdown images
   - **Binary files** (`.docx`, `.xlsx`, `.pdf`, `.epub`, `.pptx`) — ArrayBuffer sent via Transferable Objects to an offscreen document where parser libraries (mammoth, SheetJS, PDF.js, JSZip) run in isolation

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
│  constants.js → utils.js → config.js → postprocess  │
│  converters.js → binary.js → history.js → toast.js  │
│  intercept.js (entry point, event handlers)         │
└───────────────────────┬─────────────────────────────┘
                        │ Port: "ftm"
                        ▼
┌─────────────────────────────────────────────────────┐
│  Layer 2: Background Service Worker                 │
│                                                     │
│  background.js — port routing, offscreen lifecycle, │
│  config sync, install/update handling               │
└───────────────────────┬─────────────────────────────┘
                        │ Port: "ftm-offscreen-internal"
                        ▼
┌─────────────────────────────────────────────────────┐
│  Layer 3: Offscreen Document (ephemeral)            │
│                                                     │
│  offscreen.js — loads parser libraries on demand,   │
│  processes binary files, aggressively cleans up     │
│                                                     │
│  Libraries: mammoth, xlsx, jszip, turndown,         │
│  turndown-plugin-gfm, pdf.js, papaparse             │
└─────────────────────────────────────────────────────┘
```

**Why three layers?**
- **Content scripts** can't load libraries from extension resources (CSP restrictions)
- **Service workers** can't access DOM APIs (needed for parser libraries)
- **Offscreen document** is a hidden DOM context that can load libraries and parse files, then destroy itself when done — zero memory overhead when idle

### Transferable Objects (Zero-Copy)

When a binary file needs processing, the ArrayBuffer is transferred (not copied) to the offscreen document:

```js
// Content script — transfers ownership instantly
port.postMessage(
  { type: 'PROCESS_BINARY_FILE', data: { fileName, extension, arrayBuffer } },
  [arrayBuffer]  // ← Transferable flag: ownership moves, no clone
);

// After this call, arrayBuffer.byteLength === 0 in the content script
// The offscreen document now owns the memory
```

This means a 50MB DOCX file doesn't temporarily double to 100MB during transfer.

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
| ReDoS | Timing-based regex test (>50ms on 30-char string = rejected) |
| CSV Formula Injection | Cells prefixed with `'` before `=`, `+`, `-`, `@` |
| YAML Injection | Escapes `:`, `"`, `\n`, `[]`, `{}` |
| Binary Disguise | Magic byte signatures + null-byte heuristic |
| Domain Blacklist Bypass | Exact/suffix hostname matching |
| Memory Leaks | Aggressive cleanup with try-catch, port-based lifecycle |
| Race Conditions | Promise-based mutex, guarded counter, cleaned flag |
| Large File DoS | 50MB binary / 10MB text hard limits |
| Activation Fail-Open | `shouldActivate()` returns false on errors |
| Port Hijacking | Duplicate port connections rejected |

---

## Development

### Testing

```bash
node test.js            # 87 unit tests
node test-pipeline.js   # 146 pipeline integration tests
```

233 tests covering security-critical functions (ReDoS, CSV injection, YAML injection, domain matching, Smart Mode, heading hierarchy, magic byte detection, regex sanitization, file routing, state machine, concurrent operations).

### Library Management

Libraries are pinned in `lib/lockfile.json` with SHA-256 hashes.

```bash
./lib/update.sh              # Verify all 8 libraries
./lib/update.sh pdfjs        # Update PDF.js specifically
./lib/update.sh turndown-gfm # Update Turndown GFM plugin
./lib/update.sh all          # Update everything
```

### Project Structure

```
FTMStudio/
├── file-to-markdown-extension/   # The extension
│   ├── manifest.json             # MV3 config, permissions, CSP
│   ├── background.js             # Service worker (port routing)
│   ├── content/                  # Content script modules
│   │   ├── constants.js          # Magic numbers, extension maps, AI hosts
│   │   ├── utils.js              # Pure utilities, Smart Mode logic
│   │   ├── config.js             # Config state, chrome.storage sync
│   │   ├── postprocess.js        # YAML, regex pipeline, CSV sanitization
│   │   ├── converters.js         # Text/CSV/RTF/image conversion
│   │   ├── binary.js             # Offscreen bridge (Transferable Objects)
│   │   ├── history.js            # Conversion history (debounced)
│   │   ├── toast.js              # Shadow DOM toast UI
│   │   └── intercept.js          # Event capture, dispatch, init
│   ├── offscreen.js / .html      # Ephemeral binary parser
│   ├── popup.html / .js / .css   # Settings dashboard
│   ├── lib/                      # 8 pinned parser libraries
│   └── icons/                    # Extension icons (16/48/128px)
├── test.js                       # Unit tests (87)
├── test-pipeline.js              # Integration tests (146)
├── README.md
└── SECURITY_AUDIT.md
```

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
- Run `node test.js && node test-pipeline.js` before submitting PRs
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

*Version 2.0.0*
