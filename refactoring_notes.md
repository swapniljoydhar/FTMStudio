# FTM Studio Refactoring Notes

## Current architecture

The former monolithic `content.js` was removed. The manifest and dynamic registrar now load the modular content pipeline:

1. `shared/constants.js` — limits, formats, hosts, and protocol names
2. `shared/text.js` — escaping, tables, RTF, and base64 helpers
3. `shared/config.js` — defaults and prototype-safe configuration merging
4. `content/config.js` — isolated-world configuration state
5. `content/activation.js` — host and file eligibility
6. `content/postprocess.js` — Markdown cleanup, frontmatter, and ReDoS-safe rules
7. `content/converters.js` — text, RTF, and image conversion
8. `content/transport.js` — bounded binary port transport
9. `content/router.js` — converter dispatch
10. `content/history.js` — privacy-safe debounced history
11. `content/toast.js` — accessible Shadow DOM UI
12. `content/intercept.js` — file interception and reinjection

## Current hardening

- Chunk indexes are ordered and decoded bytes cannot exceed the declared file size.
- Offscreen parsing uses a preallocated bounded buffer and active-parse lifecycle tracking.
- Event handling deduplicates capture/bubble delivery.
- Popup rendering uses DOM APIs and no unsafe HTML sinks.
- Parser libraries are local, lazy-loaded, and retry-safe.
- The project remains Manifest V3 with a service worker.
