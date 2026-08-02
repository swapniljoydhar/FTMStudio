# FTM Studio — Project Report v3.0

**Version:** 3.0.0  
**Architecture:** Manifest V3 Chrome Extension  
**Status:** Production-Ready, Security-Hardened, Accessible  
**Tests:** 87 passing, lint clean

---

## What This Project Is

FTM Studio is a privacy-first Chrome extension that intercepts file uploads on AI/chatbot websites and converts documents to structured Markdown before data leaves the browser. All processing happens client-side — no servers, no cloud, no tracking.

The extension solves a UX problem: when uploading files to AI chatbots (ChatGPT, Claude, Gemini, etc.), users often need Markdown-formatted input. FTM Studio intercepts the upload, converts the file, and substitutes the Markdown version — all in-place, without leaving the page.

---

## Architecture

### Three-Layer Design

| Layer | Role | Files |
|-------|------|-------|
| **Content Script** | Runs on web pages. Intercepts events, shows toast, handles text conversion. | `content/*.js`, `shared/*.js` |
| **Service Worker** | Bridges content ↔ offscreen. Manages config sync, keepalive. | `background.js`, `sw/*.js` |
| **Offscreen Document** | Parses binary files (DOCX, PDF, XLSX, EPUB, PPTX, CSV). Ephemeral. | `offscreen.js`, `offscreen/*.js` |

**Why three layers?**
- Content scripts can't load libraries (CSP restrictions)
- Service workers can't access DOM APIs
- Offscreen document can load libraries and parse files, then destroy itself

### Streaming Binary Transport

Files stream via `file.slice()` — only one 512KB chunk in memory at a time:

```
Sender (content):  file.slice(0, 512KB) → base64 → send → GC
Receiver (offscreen):  chunk → fromBase64 → bounded offset write
```

Peak RAM is bounded by the declared file size plus parser overhead; repeated full-buffer copies were removed.

---

## Supported Formats

| Category | Extensions | Parser |
|----------|-----------|--------|
| Documents | `.docx` | Mammoth.js + Turndown |
| PDF | `.pdf` | PDF.js + Tesseract.js OCR (lazy-loaded) |
| Spreadsheets | `.xlsx`, `.xls` | SheetJS |
| Presentations | `.pptx` | JSZip + text extraction |
| EPUB | `.epub` | JSZip + XHTML parsing |
| CSV | `.csv` | Papa Parse (streaming mode) |
| RTF | `.rtf` | State-machine parser |
| Text/Code | `.txt`, `.md`, `.py`, `.js`, `.json`, `.xml`, `.html`, `.css`, `.cpp`, `.svg` | Native FileReader |
| Images | `.png`, `.jpg`, `.gif`, `.webp` | Base64 data URI |

---

## Key Features

### Conversion Quality
- **Layout-aware PDF** — multi-column line clustering, table detection from column alignment
- **DOCX images** — preserved as base64 data URIs (2MB cap)
- **RTF parser** — state-machine parser handling nested groups, CP1252, bold/italic
- **EPUB chapter titles** — extracted from HTML headings, not filenames
- **Heading hierarchy** — no skipped levels (H1→H3 becomes H1→H2)
- **TOC removal** — dot-leader patterns stripped
- **Cover artifact stripping** — license notices, boilerplate removed
- **YAML frontmatter** — `token_estimate`, `content_hash`, `word_count`, `recommended_chunk_level`
- **Image mode** — `embedded`, `placeholder`, or `external`

### Security
- **ReDoS protection** — progressive scaling probe (3 sizes, 15ms budget)
- **CSV sanitization** — code spans instead of `'` prefix
- **YAML injection** — double sanitization (`plain()` + `yamlString()`)
- **Polyglot defense** — structural validation (PDF `%%EOF`, DOCX ZIP integrity)
- **SW keepalive** — heartbeat during long conversions
- **DataTransfer fallback** — multi-strategy injection with clipboard backup
- **History privacy** — extension-only filenames, 30-day auto-expiry
- **Fail-closed feedback** — visible error on config corruption

### UX
- **Splash animation** — GPU-only intro, `prefers-reduced-motion` support
- **Visual ON/OFF** — toolbar badge, header accent, logo dimming
- **Collapsible sections** — Output and File Formats collapse
- **Responsive** — adapts to 300px+ popup widths
- **Accessible** — open shadow DOM, `role="alert"`, auto-focus

---

## Test Coverage

87 tests across 8 files covering:
- Config defaults, merge, prototype pollution
- PDF line clustering, table detection, cell rendering
- History privacy, merging, expiry
- Binary transport, oversized files, routing
- Frontmatter, TOC, cover artifacts, heading hierarchy, ReDoS
- RTF parser (nested groups, fonttbl, CP1252, hex escapes)
- CSV sanitization, YAML escaping, HTML entities
- Offscreen lifecycle, bridge, registrar, session protocol

---

## Performance

| Metric | Old | New |
|--------|-----|-----|
| Peak RAM (45MB PDF) | ~150MB | Bounded by file size + parser overhead |
| Chunks in memory | All at once | 1 at a time (512KB) |
| Base64 overhead | 2.67× file size | 1.33× (incremental decode) |
| ReDoS probe time | Up to 200ms | Max 45ms |
| Bundle size | ~6MB | ~6MB (Tesseract lazy-loaded) |

---

## Dependencies

| Library | Size | Purpose |
|---------|------|---------|
| mammoth.js | 628KB | DOCX parsing |
| PDF.js | 389KB + 1.4MB worker | PDF text extraction |
| SheetJS | 273KB | XLSX/XLS parsing |
| JSZip | 96KB | ZIP handling (EPUB/PPTX) |
| Papa Parse | 20KB | CSV parsing |
| Turndown + GFM | 13.5KB | HTML → Markdown |
| Tesseract.js | ~3MB | OCR for scanned PDFs (lazy-loaded) |

---

*Version 3.0.0 — 87 tests passing — 2026-08-02*
