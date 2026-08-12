# FTM Studio — File to Markdown Converter

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![Privacy First](https://img.shields.io/badge/Privacy-100%25%20Local-green)]()
[![Version](https://img.shields.io/badge/version-4.0.0-orange)]()
[![Tests](https://img.shields.io/badge/tests-115%20passing-brightgreen)]()

A **privacy-first**, **local-first** browser extension that converts user-selected files into structured Markdown before you attach them anywhere. FTM Studio does not inject into websites, modify third-party upload controls, request access to arbitrary pages, or send document contents to a server.

The extension uses a deliberate workflow: choose a file in FTM Studio, convert it locally, then download or drag the generated `.md` file into your destination application yourself. This keeps the destination site’s native upload flow intact and avoids fragile site-specific automation behavior.

---

## Features

### Manual Conversion Workspace

The converter is opened explicitly from the extension popup. It provides a real file picker, drag-and-drop input, a bounded queue, one active conversion at a time, cancellation state, progress feedback, and a result link that supports both normal download and drag-out workflows.

- **Local file selection** — files are read inside the extension page.
- **Bounded queue** — duplicate files are ignored and queue size is capped.
- **RAM-conscious processing** — one conversion runs at a time by default, with hard input and output limits.
- **Download or drag** — the generated Markdown is exposed as a normal downloadable object URL.
- **Policy-neutral workflow** — FTM Studio does not rewrite AI-chat or website upload controls.
- **Mobile-aware layout** — narrow screens, keyboard navigation, reduced motion, and dark color schemes are supported.

### Supported Formats

The default format policy favors predictable conversion quality and bounded resource use over an unnecessarily large feature list.

| Category | Extensions | Output behavior |
|---|---|---|
| **Documents** | `.pdf`, `.docx`, `.txt`, `.md`, `.rtf`, `.html` | Converts document text and structure to Markdown. |
| **Spreadsheets** | `.csv`, `.xlsx`, `.xls` | Produces bounded Markdown tables with formula-like cell protection. |
| **Source Code** | `.py`, `.js`, `.cpp`, `.css`, `.json`, `.xml` | Emits fenced Markdown code with a language tag where known. |

EPUB, PPTX, images, OCR-heavy workflows, and ambiguous container formats are not exposed by the current default policy. They should only be reintroduced as separately tested optional modules with explicit page, object, pixel, archive, and memory budgets.

### Security Features

- **Least-privilege manifest** — only `storage` permission is requested; there are no host permissions, content scripts, dynamic script registration, offscreen permission, downloads permission, or web-accessible parser resources.
- **Binary disguise checks** — text conversion checks magic signatures and null-byte density before treating content as text.
- **Parser hardening** — PDF.js evaluation is disabled and parser libraries are loaded locally and lazily.
- **Input and output limits** — file, text, queue, history, and generated Markdown sizes are bounded.
- **Configuration validation** — persisted settings are normalized, prototype keys are rejected, and regex/domain values are bounded.
- **ReDoS protection** — custom post-processing rules are screened and constrained before execution.
- **CSV formula protection** — formula-like spreadsheet cells are escaped into Markdown-safe code spans.
- **DOM-safe rendering** — filenames, errors, settings, and history values are rendered with DOM text APIs rather than HTML injection.
- **Pinned libraries** — vendored parser files are checked against the SHA-256 lockfile.

### Conversion Quality

- **Layout-aware PDF extraction** — text items are clustered and aligned where the parser has sufficient layout information.
- **DOCX conversion** — document structure is converted through the local Mammoth-based parser.
- **RTF parsing** — local RTF conversion handles common formatting and nested groups.
- **HTML cleanup** — HTML is converted locally and post-processed into readable Markdown.
- **Heading normalization** — post-processing can normalize heading levels and remove common table-of-contents artifacts.
- **Table output** — CSV and spreadsheet data are converted into Markdown tables with cell escaping.
- **Frontmatter option** — optional YAML metadata can be added through settings, subject to safe serialization rules.
- **Explicit failure states** — unsupported, oversized, malformed, encrypted, or parser-failed files report an error instead of silently producing misleading output.

### Privacy-Preserving History

Conversion history is local and redacted. It stores only an extension-derived label such as `*.pdf`, file size, timestamp, a random entry identifier, and output size. It does not store the original filename or converted Markdown content. Entries are debounced, merged safely, capped, and expired after the configured retention period.

### Stateless Background Service Worker

The Manifest V3 worker is intentionally small and event-driven. It initializes durable settings, synchronizes the toolbar badge, and tolerates browser shutdowns and restarts without owning document data, conversion queues, ports, or parser state.

---

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/swapniljoydhar/FTMStudio.git
   cd FTMStudio
   ```

2. Open the extensions page in a desktop Chromium-based browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `file-to-markdown-extension` folder.
5. Open the FTM Studio popup and choose **Open converter**.

**Primary target:** Chrome and Chromium desktop with Manifest V3 support.

### Permissions

The extension requests only the `storage` permission. It does not request `<all_urls>`, host permissions, `scripting`, `offscreen`, `downloads`, or tab access. No page content is inspected or modified by the current build.

Firefox desktop can use the shared `chrome`/`browser` adapter, but should be validated against the target Firefox release. Firefox Android requires a separate compatibility build because Android extension APIs and Manifest V3 service-worker behavior do not have full desktop parity. Chrome Android does not provide the same general extension-installation model as desktop Chrome, so a universal Chrome Android guarantee is not technically valid.

---

## How It Works

### The User Workflow

1. Open FTM Studio from the browser toolbar.
2. Open the manual conversion workspace.
3. Choose files with the picker or drop them onto the converter.
4. FTM Studio validates the extension, size, and basic content signature.
5. The converter selects a local parser and runs one bounded job at a time.
6. Post-processing normalizes the Markdown, applies safe settings, and enforces the output limit.
7. Download the `.md` result or drag its result link into a destination application.

The destination application receives a normal user-managed file. FTM Studio does not cancel events, replace `input.files`, redispatch upload events, access arbitrary site DOMs, or use clipboard fallbacks to simulate an attachment.

### Architecture

```text
┌────────────────────────────────────────────────────────┐
│  Extension Popup                                       │
│  popup.html + popup.js + popup.css                     │
│  Settings, format policy, badge state, redacted history │
└────────────────────────┬───────────────────────────────┘
                         │ opens explicit converter page
                         ▼
┌────────────────────────────────────────────────────────┐
│  Manual Converter Page                                 │
│  convert.html + convert.js + convert.css                │
│  File picker, drop zone, bounded queue, output handle   │
└────────────────────────┬───────────────────────────────┘
                         │ local function calls
                         ▼
┌────────────────────────────────────────────────────────┐
│  Shared + Parser Modules                                │
│  browser adapter, config, text helpers, post-processing  │
│  lazy local document, spreadsheet, PDF, and RTF parsers  │
└────────────────────────┬───────────────────────────────┘
                         │ durable settings and badge only
                         ▼
┌────────────────────────────────────────────────────────┐
│  Stateless MV3 Service Worker                          │
│  background.js                                         │
│  lifecycle bootstrap, storage normalization, badge sync │
└────────────────────────────────────────────────────────┘
```

### RAM-Conscious Design

The converter avoids the old page-interception transport and its Base64 bridge. The primary workflow keeps conversion state in one explicit page, processes one active job at a time, lazy-loads parser libraries, limits queue length, releases generated object URLs, and rejects oversized input or output. Parser-specific budgets remain a release requirement for any future OCR, image, EPUB, or PPTX module.

No extension can honestly guarantee zero latency, zero RAM growth, or zero quality loss for every arbitrary document and device. FTM Studio instead fails explicitly and keeps work bounded when a file exceeds the safe operating envelope.

---

## Configuration

The popup exposes settings for the local conversion workflow, including the master state, Markdown output behavior, frontmatter preference, image/parser policy where applicable, supported-format policy, and privacy-preserving history controls.

| Control area | Purpose |
|---|---|
| **General** | Enable or disable the extension and manage core output behavior. |
| **Formats** | Keep only the supported conversion categories needed for the user’s workflow. |
| **Output** | Configure post-processing and optional frontmatter behavior. |
| **History** | Review redacted local conversion metadata or clear it. |

---

## Security and Privacy

### Privacy Model

- **Local document processing** — document bytes are handled by extension-local code.
- **No document upload service** — there is no server endpoint, cloud converter, or runtime API credential.
- **No page access** — the manifest does not grant arbitrary host access.
- **No telemetry claim** — the extension source contains no first-party analytics or tracking pipeline.
- **Redacted history** — history does not retain raw document names or Markdown content.
- **Strict extension CSP** — scripts and parser resources remain extension-local.

### Threat Mitigations

| Threat | Mitigation |
|---|---|
| Arbitrary-site code execution | No host permissions, content scripts, or dynamic registration. |
| Upload automation detection | Manual converter and normal user-managed download/drag workflow. |
| ReDoS | Bounded rule count/size and existing unsafe-pattern screening. |
| CSV formula injection | Risky cells are rendered as Markdown-safe code. |
| YAML/frontmatter injection | Values are normalized and serialized through safe helpers. |
| Binary disguise | Magic-byte and null-byte checks before text conversion. |
| Large-file denial of service | Input, queue, parser, and output budgets. |
| Service-worker restart loss | Conversion state is not owned by the service worker. |
| Unsafe UI rendering | `textContent` and DOM construction instead of HTML sinks. |
| Library tampering | SHA-256 verification for pinned vendored libraries. |
| History privacy leak | Extension-only labels, capped entries, expiry, and no content storage. |

---

## Development

### Testing

```bash
npm install
npm test              # 115 tests against the current sources
npm run build         # MV3 manifest and source-reference verification
npm run verify:libs   # SHA-256 verification of pinned parser libraries
```

The current validation baseline is **115 passing tests**, MV3 verification of **24 extension files**, and SHA-256 verification of **11 pinned libraries**. These checks do not replace browser-matrix testing, malformed-document fuzzing, or parser-specific memory testing.

### Project Structure

```text
FTMStudio/
├── file-to-markdown-extension/
│   ├── manifest.json              # Least-privilege MV3 manifest
│   ├── background.js              # Stateless service worker
│   ├── convert.html               # Manual conversion workspace
│   ├── convert.js                 # Bounded queue and local dispatch
│   ├── convert.css                # Responsive converter UI
│   ├── popup.html                 # Settings and converter entry point
│   ├── popup.js / popup.css       # Settings controller and compact UI
│   ├── shared/                    # Adapter, constants, config, text, schemas
│   ├── content/                   # Local converters, history, post-processing
│   ├── offscreen/                 # Lazy parser loaders and document parsers
│   └── lib/                       # Vendored libraries and SHA-256 lockfile
├── test/                          # Unit, security-boundary, and source tests
├── AUDIT_REPORT.md                # Detailed vulnerability and remediation report
└── package.json                   # Test and verification commands
```

### Future Work

The next safe improvements are a browser-matrix CI job, parser-specific page/archive/cell/pixel budgets, true parser cancellation, malformed-file fixtures, golden conversion snapshots, an SBOM/license report, and separate Firefox Android packaging. These improvements should be completed before reintroducing OCR-heavy formats, images, EPUB, PPTX, or any automatic page integration.

---

## References

[1]: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3 "Chrome Manifest V3 overview"
[2]: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle "Chrome extension service-worker lifecycle"
[3]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts "MDN WebExtensions content scripts"
[4]: https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/ "Mozilla Firefox for Android extension guidance"
