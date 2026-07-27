# User's v1.0.1 Modular Refactoring Notes

## Architecture Change
User split monolithic content.js into 9 modules.

**Note (2026-07-27):** The monolithic `content.js` (1,247 lines) has been deleted as dead code. The manifest already loaded only the modular `content/` files. All functionality from `content.js` exists in the 9 modules below.
1. constants.js — constants, defaults
2. utils.js — utility functions (formatBytes, sanitizeRegexPipeline, shouldInterceptFile, etc.)
3. config.js — configuration state + persistence + chrome.storage.onChanged listener
4. postprocess.js — YAML frontmatter, regex pipeline, CSV formula injection prevention
5. converters.js — text/code converters (readTextFile, readRtfFile, CSV stream with Papa Parse)
6. binary.js — offscreen bridge (processBinaryFile, handleBinaryResponse)
7. history.js — conversion history persistence with debounce
8. toast.js — Shadow DOM toast UI
9. intercept.js — event interception, reDispatchEvent, init

## New Features User Added
- autoConvert mode (skip toast, convert immediately)
- domainWhitelist support
- customAiHosts support
- smartMode toggle
- ReDoS detector (timing-based safety test)
- YAML frontmatter injection prevention (escape :, [], {})
- CSV/formula injection blocking (=, +, -, @ cells prefixed)
- Domain blacklist exact/suffix matching (not substring)
- EPUB parser detects parsererror after XHTML parse
- PPTX rels file parsed once into Map
- History persistence debounced (2s batch window)
- PDF.js worker path set once after library load

## Manifest Changes
- content_scripts now lists 9 modular JS files in dependency order
- web_accessible_resources updated for new module structure

## My Fixes to Merge On Top
- SRI hashes removed (incompatible with chrome-extension://)
- Turndown GFM plugin added
- Offscreen aggressive cleanup (6-step on port disconnect)
- Popup innerHTML XSS fixed (pure DOM methods)
- images category added to popup
- Version reads from manifest dynamically
