# Third-Party Notices

FTM Studio's original source code is licensed under the Apache License 2.0.
This file records the licenses of third-party libraries bundled in
`file-to-markdown-extension/lib/`. Those libraries remain under their own
licenses; this notice does not replace or alter them.

| Library | Version | License | Upstream |
| --- | ---: | --- | --- |
| Mammoth.js | 1.8.0 | BSD-2-Clause | [mammoth.js](https://github.com/mwilliamson/mammoth.js) |
| SheetJS | 0.20.3 | Apache-2.0 | [SheetJS](https://git.sheetjs.com/sheetjs/sheetjs) |
| JSZip | 3.10.1 | MIT | [JSZip](https://github.com/Stuk/jszip) |
| Turndown | 7.2.0 | MIT | [Turndown](https://github.com/mixmark-io/turndown) |
| Turndown GFM plugin | 1.0.2 | MIT | [turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm) |
| PDF.js | 4.10.38 | Apache-2.0 | [PDF.js](https://github.com/mozilla/pdf.js) |
| Papa Parse | 5.4.1 | MIT | [Papa Parse](https://github.com/mholt/PapaParse) |
| Tesseract.js | 5.1.1 | Apache-2.0 | [Tesseract.js](https://github.com/naptha/tesseract.js) |
| Tesseract English trained data | 4.0.0_best_int | Apache-2.0 | [tesseract.js-data](https://github.com/naptha/tessdata) |

The exact bundled files, source URLs, sizes, versions, and SHA-256 hashes are
tracked in [`lib/lockfile.json`](file-to-markdown-extension/lib/lockfile.json)
and verified by `npm run verify:libs`.

When redistributing FTM Studio, retain this notice and the upstream license
notices required by each dependency.
