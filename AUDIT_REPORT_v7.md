# FTM Studio — Current Architecture Audit

**Updated:** 2026-08-03
**Manifest:** Chrome Manifest V3  
**Status:** Modular, locally processed, test-covered

## Current architecture

FTM Studio uses three layers:

- Content scripts intercept file drops and file-input changes, show the toast, perform lightweight conversions, and inject the resulting Markdown file.
- The background service worker manages dynamic content-script registration, configuration fan-out, port bridging, and offscreen-document lifecycle.
- The offscreen document loads vendored parser libraries lazily and handles DOCX, PDF, spreadsheet, EPUB, PPTX, and CSV conversion.

Content scripts are registered dynamically by `sw/registrar.js` in the isolated world. Smart Mode limits registration to configured AI hosts; disabling Smart Mode preserves the existing all-site behavior.

## Current hardening

- Manifest V3 service worker architecture is used consistently.
- Extension pages use `script-src 'self'; object-src 'self'`.
- First-party code contains no `innerHTML`, `document.write`, `eval`, or `new Function` sinks.
- Port senders are checked against `chrome.runtime.id`.
- Conversion messages use bounded schemas and ordered, size-checked chunks.
- Binary reassembly writes into one preallocated bounded buffer.
- Offscreen parser libraries remain loaded until active parses and ports finish.
- Content event listeners deduplicate capture/bubble delivery.
- History, bridge queues, caches, and file sizes are bounded.
- Parser libraries are vendored locally; no runtime network requests are used.

## Verification

- `npm test`: 144 passing
- `npm run lint`: passing
- `npm run build`: passing
- `npm run verify:libs`: 11 pinned libraries verified
- Dynamic script and manifest file references: verified

Licensing is documented in `LICENSE`, `NOTICE.md`, and the `package.json`
SPDX field. Bundled libraries retain their upstream licenses.

The broad `<all_urls>` host permission remains because Classic Mode must support interception on arbitrary sites. Smart Mode limits actual registration and activation to configured hosts.
