# FTM Studio

FTM Studio is a privacy-first Manifest V3 browser extension that converts user-selected files to Markdown locally. The current release intentionally does **not** inject into websites, intercept page upload controls, replace files in third-party dialogs, request host permissions, or upload document contents.

## Product model

Use the popup to open the **manual conversion workspace**. Choose one or more files, wait for local conversion, then download the generated `.md` file or drag the result link into an application that accepts a normal file drop. This preserves the destination site’s native upload behavior and avoids site-specific automation signals.

The service worker is deliberately stateless. It bootstraps durable settings, synchronizes the action badge, and exits cleanly when idle. Conversion state lives in the explicit converter page, not in a background queue or service-worker global.

## Supported formats

The default allowlist is deliberately curated for predictable output and bounded memory use.

| Group | Extensions | Notes |
|---|---|---|
| Documents | `.pdf`, `.docx`, `.txt`, `.md`, `.rtf`, `.html` | PDF/DOCX use lazy local parsers; HTML is converted locally. |
| Data | `.csv`, `.xlsx`, `.xls` | Tables are bounded and formula-like cells are escaped. |
| Source | `.py`, `.js`, `.cpp`, `.css`, `.json`, `.xml` | Source files are emitted as fenced Markdown code. |

EPUB, PPTX, images, OCR-heavy workflows, and ambiguous container formats are intentionally excluded from the primary allowlist until they have separate quality tests and resource budgets. Unsupported formats are not exposed by the UI.

## Security and privacy design

The manifest requests only `storage`. It has no host permissions, content scripts, scripting permission, optional all-sites permission, offscreen permission, downloads permission, or web-accessible parser resources. All libraries are loaded from extension-local files. PDF.js runs with evaluation disabled, and library hashes are verified by the repository integrity check.

Input size, queue length, output size, parser work, and history size are bounded. Conversion history stores only redacted extension labels, sizes, timestamps, and output sizes; it does not store document names or Markdown content. The UI uses text-based DOM APIs rather than HTML injection, and no dynamic code execution is used by first-party source.

## Browser and mobile scope

Chrome and Chromium desktop MV3 are the primary target. The source uses a small `chrome`/`browser` API adapter so Firefox desktop packaging can be maintained without scattering namespace conditionals through the code. Firefox Android support requires a separate compatibility build because Android browser extension APIs and MV3 service-worker support do not have full desktop parity. Chrome Android does not provide the same general extension-installation model as desktop Chrome, so a universal Chrome Android extension guarantee is not technically valid.

No extension can guarantee zero latency or zero quality loss for every arbitrary document, device, browser, and destination application. The implementation instead uses lazy parser loading, one active conversion at a time, hard budgets, cancellation hooks, and explicit errors to avoid uncontrolled RAM growth and silent corruption.

## Development

```bash
npm install
npm test
npm run build
npm run verify:libs
```

`npm test` runs the unit and source-structure suite. `npm run build` verifies that the MV3 manifest references only existing files and that the extension has no forbidden legacy references. `npm run verify:libs` checks the SHA-256 lockfile for every vendored parser library.

Load `file-to-markdown-extension/` as an unpacked extension in a desktop Chromium-based browser. For Firefox, validate the same source against the target Firefox version and maintain a browser-specific manifest if a release requires event-page behavior on Firefox Android.

## Repository structure

| Path | Responsibility |
|---|---|
| `background.js` | Stateless event-driven worker for durable settings and badge state. |
| `convert.html`, `convert.js`, `convert.css` | Manual file picker, bounded queue, local conversion, download/drag output. |
| `popup.html`, `popup.js`, `popup.css` | Settings, format policy, and redacted local history. |
| `shared/` | Constants, text helpers, config validation, message schemas, and API adapter. |
| `content/` | Reusable local text/RTF converters, post-processing, and history persistence; no page injection. |
| `offscreen/` | Lazy local parser loaders and document/table conversion functions used by the converter page. |
| `lib/` | Vendored parser libraries validated by `lib/lockfile.json`. |
| `test/` | Production-source tests, parser tests, security-boundary tests, and packaging checks. |
