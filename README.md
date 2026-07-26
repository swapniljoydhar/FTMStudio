# FTM Studio — File to Markdown Converter

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Privacy First](https://img.shields.io/badge/Privacy-100%25%20Local-green)]()
[![Version](https://img.shields.io/badge/version-1.0.1-orange)]()

A **privacy-first**, **100% local** Chrome extension that intercepts file uploads on any webpage and converts documents to structured Markdown **before data leaves your browser**. All processing happens client-side — no servers, no cloud, no tracking.

---

## Features

### Supported Formats

| Category | Extensions |
|----------|-----------|
| **Documents** | `.docx`, `.txt`, `.rtf`, `.md` |
| **PDF** | `.pdf` |
| **Spreadsheets** | `.csv`, `.xlsx`, `.xls` |
| **Presentations** | `.pptx` |
| **Markup & Ebooks** | `.html`, `.epub` |
| **Source Code** | `.py`, `.js`, `.cpp`, `.css`, `.json`, `.xml` |

### Key Capabilities

- **Zero-Copy Architecture** — Transferable Objects for instant ArrayBuffer transfer
- **Shadow DOM Toast UI** — Encapsulated, non-intrusive conversion prompt
- **Capture-Phase Interception** — Fires before React/Vue/Svelte event handlers
- **Magic Byte Content Sniffing** — Detects ZIP, PDF, OLE2, RTF, GZIP signatures
- **YAML Frontmatter** — Auto-injects metadata (filename, size, timestamp)
- **Regex Pipeline** — Custom sanitization rules with timing-based ReDoS protection
- **CSV Streaming** — Handles large files via Papa Parse streaming API
- **Formula Injection Protection** — Sanitizes `=`, `+`, `-`, `@` prefixed cells
- **Conversion History** — Persistent log with JSON export (debounced writes)
- **Domain Blacklist** — Exact/suffix hostname matching
- **Dark Mode** — Respects system preference

---

## Installation

### Manual Installation (Development)

1. Clone this repository:
   ```bash
   git clone https://github.com/swapniljoydhar/FTMStudio.git
   cd FTMStudio
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select the `file-to-markdown-extension` folder
5. The extension icon should appear in your toolbar

---

## Configuration

Click the extension icon to open the settings dashboard.

### Settings Tab

| Option | Description |
|--------|-------------|
| **Master Toggle** | Enable/disable all interception |
| **Toast Timer** | Auto-dismiss countdown (0–30 seconds) |
| **Categories** | Enable/disable specific file types |
| **Domain Blacklist** | Ignore uploads on specific hostnames (exact or suffix match) |

### Advanced Tab

| Option | Description |
|--------|-------------|
| **YAML Frontmatter** | Inject metadata header |
| **CSV Stream Threshold** | Size threshold for streaming (1–50 MB) |
| **Strip Trailing Whitespace** | Clean up extra spaces |
| **Enforce Heading Hierarchy** | Normalize heading levels |
| **RegEx Pipeline** | Custom find/replace rules (ReDoS-protected) |

### History Tab

- View past conversions
- Export history as JSON
- Clear conversion log

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   content.js    │────▶│  background.js   │────▶│  offscreen.js   │
│  (Capture Phase)│     │ (Service Worker) │     │  (DOM Parser)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                        │
        │   Port: 'ftm'          │   Port:                │
        │                        │   'ftm-offscreen-      │
        │                        │    internal'           │
        ▼                        ▼                        ▼
  Shadow DOM Toast         Offscreen Document       Parser Libraries:
  - User prompt            - No UI                  - mammoth.js (DOCX)
  - Countdown timer        - DOM parsing            - xlsx.mini (XLSX)
  - Keyboard shortcuts     - Binary processing      - JSZip (EPUB/PPTX)
                                                   - PDF.js (PDF)
                                                   - Turndown (HTML→MD)
```

### Data Flow

1. **Intercept** — `content.js` captures file drop/input at capture phase
2. **Prompt** — Shadow DOM toast asks user to convert or skip
3. **Transfer** — On approve, ArrayBuffer sent via Transferable Object (zero-copy)
4. **Route** — `background.js` bridges content script ↔ offscreen document via ports
5. **Parse** — `offscreen.js` lazy-loads parser libraries, extracts text
6. **Post-process** — Apply regex pipeline, inject YAML frontmatter, sanitize CSV
7. **Re-dispatch** — Replace original FileList with Markdown Blob

---

## Security & Privacy

### Privacy Guarantees

- **No network requests** — All processing is 100% local
- **No telemetry** — Zero analytics or tracking
- **No cloud storage** — Config stored in `chrome.storage.local`
- **Ephemeral offscreen** — Parser libraries unloaded after each conversion

### Security Measures

| Threat | Mitigation |
|--------|-----------|
| **ReDoS Attacks** | Timing-based regex validation (>50ms on 30-char test = rejected) |
| **CSV Formula Injection** | Cells starting with `=`, `+`, `-`, `@` prefixed with `'` |
| **YAML Injection** | Filename escaping for `:`, `"`, `\n`, `[]`, `{}` |
| **Binary Injection** | Magic byte signatures (PK, %PDF, OLE2, RTF, GZIP) + null-byte heuristic |
| **Domain Blacklist Bypass** | Exact hostname or suffix matching (not substring) |
| **Memory Leaks** | Aggressive cleanup with try-catch per global, port-based lifecycle |
| **Race Conditions** | Promise-based mutex for offscreen creation, guarded counter |
| **Large File DoS** | 50MB hard limit on binary files, 10MB on text files |
| **XSS** | All dynamic content via `textContent`, Shadow DOM encapsulation |

### Permissions

```json
"permissions": [
  "storage",      // Save config & history locally
  "offscreen",    // Parse binaries in isolated DOM
  "downloads"     // Export history as JSON
],
"host_permissions": [
  "<all_urls>"    // Intercept file uploads on any site
]
```

---

## Development

### Project Structure

```
file-to-markdown-extension/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker (port routing, lifecycle)
├── content.js             # Content script (interception, toast, converters)
├── offscreen.js           # Offscreen document (binary parsing)
├── offscreen.html         # Offscreen DOM container
├── popup.js               # Settings dashboard logic
├── popup.html             # Settings dashboard UI
├── popup.css              # Dashboard styles
├── lib/                   # Third-party parser libraries
│   ├── mammoth.browser.min.js
│   ├── xlsx.mini.min.js
│   ├── jszip.min.js
│   ├── pdf.min.js
│   ├── pdf.worker.min.js
│   ├── turndown.min.js
│   └── papaparse.min.js
└── icons/                 # Extension icons
```

### Build Commands

```bash
# Package for distribution
zip -r ftm-studio.zip file-to-markdown-extension/ -x "*.git*"
```

### Testing Checklist

- [ ] DOCX → Markdown (semantic extraction)
- [ ] XLSX → Markdown tables (formula injection sanitized)
- [ ] PDF → Markdown (text per page)
- [ ] PPTX → Markdown (slide text)
- [ ] EPUB → Markdown (chapter structure, malformed XHTML handled)
- [ ] CSV streaming (>5MB files)
- [ ] CSV formula injection (`=cmd|'/C calc'!A0` → prefixed)
- [ ] RTF → Plain text
- [ ] Code files → Syntax-highlighted blocks
- [ ] JSON → Pretty-printed code block
- [ ] YAML frontmatter injection (special chars in filename)
- [ ] RegEx pipeline (ReDoS patterns rejected)
- [ ] Domain blacklist (exact/suffix match)
- [ ] Dark mode rendering
- [ ] Concurrent file conversions

---

## Known Limitations

| Format | Limitation |
|--------|-----------|
| **DOCX** | Mammoth extracts semantics, not visual layout. Multi-column flattens to linear text. Images stripped. |
| **PDF** | Text-only extraction. Scanned PDFs (images) not supported. Complex layouts may lose formatting. |
| **PPTX** | Extracts text content only. Animations, transitions, embedded media ignored. |
| **EPUB** | DRM-protected ebooks cannot be processed. |
| **RTF** | Basic parser; embedded images/OLE objects not supported. |
| **XLS** | Legacy `.xls` (BIFF8) uses SheetJS read-only mode; some formulas may not evaluate. |

---

## Contributing

### Reporting Issues

1. Include **extension version** (found in popup footer)
2. Describe **expected vs actual behavior**
3. Attach sample file (if possible)
4. Note Chrome version (`chrome://version`)

### Pull Requests

- Follow existing code style (single quotes, semicolons)
- Test on Chrome 115+ (latest stable)
- Document new features in README
- No new external dependencies without discussion

---

## License

MIT License — see [LICENSE](LICENSE) file.

---

## Acknowledgments

Built with these open-source libraries:

- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — DOCX parsing
- [SheetJS](https://github.com/SheetJS/sheetjs) — XLSX/XLS parsing
- [PDF.js](https://github.com/mozilla/pdf.js) — PDF text extraction
- [JSZip](https://github.com/Stuk/jszip) — ZIP archive handling (EPUB/PPTX)
- [Turndown](https://github.com/mixmark-io/turndown) — HTML to Markdown
- [Papa Parse](https://github.com/mholt/PapaParse) — CSV streaming

---

*Version 1.0.1*
