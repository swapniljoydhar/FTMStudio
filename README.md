# FTM Studio — File to Markdown Converter

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Privacy First](https://img.shields.io/badge/Privacy-100%25%20Local-green)]()
[![Version](https://img.shields.io/badge/version-1.0.1-orange)]()

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
| **Markup & Ebooks** | `.html`, `.epub` |
| **Source Code** | `.py`, `.js`, `.cpp`, `.css`, `.json`, `.xml` |

### Security Features

- **ReDoS Protection** — timing-based regex validation
- **CSV Formula Injection** — sanitizes `=`, `+`, `-`, `@` prefixed cells
- **YAML Injection** — escapes special characters in filenames
- **Magic Byte Detection** — identifies binary formats by signature
- **Content Size Limits** — 50MB binary / 10MB text hard limits

### Other Capabilities

- **Zero-Copy Architecture** — Transferable Objects for instant ArrayBuffer transfer
- **Shadow DOM Toast** — encapsulated, non-intrusive prompt
- **Capture-Phase Interception** — fires before React/Vue/Svelte handlers
- **YAML Frontmatter** — auto-injects metadata
- **Regex Pipeline** — custom sanitization rules (ReDoS-protected)
- **CSV Streaming** — handles large files via Papa Parse
- **Conversion History** — persistent log with JSON export
- **Dark Mode** — respects system preference

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

---

## Configuration

Click the extension icon to open the settings dashboard.

### General Tab

| Option | Description |
|--------|-----------|
| **Master Toggle** | Enable/disable the extension entirely |
| **Smart Mode** | Only intercept on AI/chatbot sites (default: on) |
| **Custom Sites** | Add your own domains for interception |
| **Auto-dismiss Timer** | Toast countdown (0–30 seconds, 0 = manual) |
| **Format Toggles** | Enable/disable specific file types |
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

- View past conversions
- Export history as JSON
- Clear conversion log

---

## Architecture

```
content/
├── constants.js    # Shared constants, extension maps, magic bytes, AI hosts
├── utils.js        # Pure utilities (formatBytes, shouldActivate, etc.)
├── config.js       # Config state, loading, chrome.storage sync
├── postprocess.js  # YAML frontmatter, regex pipeline, heading hierarchy
├── converters.js   # Text, CSV, RTF processing + content sniffing
├── binary.js       # Offscreen bridge (Transferable Objects)
├── history.js      # Conversion history (debounced persistence)
├── toast.js        # Shadow DOM toast UI
└── intercept.js    # Event interception, dispatch, lifecycle, init

background.js       # Service worker (port routing, lifecycle, config sync)
offscreen.js        # Ephemeral document (binary parsing: DOCX, XLSX, PDF, EPUB, PPTX)
popup.html/js/css   # Settings dashboard
lib/                # Third-party parsers (mammoth, xlsx, pdf.js, jszip, turndown, papaparse)
```

### Data Flow

1. User uploads file on an AI site (Smart Mode checks `shouldActivate()`)
2. `intercept.js` captures the event at capture phase
3. Shadow DOM toast prompts user to convert or skip
4. On approve, file is processed:
   - **Text/CSV/RTF** → converted in content script
   - **Binary (DOCX/XLSX/PDF/EPUB/PPTX)** → ArrayBuffer sent via Transferable port to offscreen document
5. Post-processing: regex pipeline, YAML frontmatter, CSV sanitization
6. Original FileList replaced with Markdown Blob via DataTransfer API

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
| Race Conditions | Promise-based mutex, guarded counter |
| Large File DoS | 50MB binary / 10MB text hard limits |

---

## Development

### Testing

```bash
node test.js
```

87 tests covering security-critical functions (ReDoS, CSV injection, YAML injection, domain matching, Smart Mode, heading hierarchy, magic byte detection, regex sanitization).

### Library Management

Libraries are pinned in `lib/lockfile.json` with SHA-256 hashes.

```bash
./lib/update.sh          # Verify all 7 libraries
./lib/update.sh pdfjs    # Update PDF.js specifically
./lib/update.sh all      # Update everything
```

### Project Structure

```
FTMStudio/
├── file-to-markdown-extension/   # The extension
│   ├── manifest.json
│   ├── background.js
│   ├── content/                   # Content script modules
│   ├── offscreen.js / .html
│   ├── popup.html / .js / .css
│   ├── lib/
│   └── icons/
├── test.js                        # Unit tests
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
- Test on Chrome 115+
- Run `node test.js` before submitting PRs
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
- [Papa Parse](https://github.com/mholt/PapaParse) — CSV streaming

---

*Version 1.0.1*
