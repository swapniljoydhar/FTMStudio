// ===========================================================================
// content.js — File-to-Markdown Interceptor (Content Script, v6)
// ===========================================================================
//
// CAPTURE-PHASE EVENT INTERCEPTION — fires BEFORE React/Vue/Svelte.
// Shadow DOM toast with closed encapsulation. DataTransfer API for FileList.
// Transferable Objects for zero-copy ArrayBuffer to offscreen document.
//
// V6 FEATURES:
//   - PDF support via PDF.js (lazy-loaded in offscreen)
//   - PPTX support via JSZip (lazy-loaded in offscreen)
//   - Fixed port name: content uses 'ftm', background bridges to 'ftm-offscreen-internal'
//   - Fixed web_accessible_resources in manifest (was missing — caused lib load failures)
//   - Content sniffing for binary-disguised-as-text files
//   - YAML frontmatter injection
//   - Stream API for large CSVs via Papa Parse
//   - RegEx pipeline sanitization
//   - Conversion history persistence
// ===========================================================================

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. CONFIGURATION — loaded from chrome.storage.local
  // ---------------------------------------------------------------------------
  let config = {
    enabled: true,
    autoDismissSeconds: 10,
    domainBlacklist: [],
    categories: {
      documents: true,
      pdf: true,
      spreadsheets: true,
      code: true,
      markup: true,
      presentations: true
    },
    yamlFrontmatter: true,
    csvStreamThreshold: 5,
    stripTrailingWhitespace: true,
    enforceHeadingHierarchy: false,
    regexPipeline: [],
    conversionHistory: [],
    maxConversions: 50
  };

  const EXTENSION_MAP = {
    '.docx': 'documents',
    '.txt':  'documents',
    '.rtf':  'documents',
    '.md':   'documents',
    '.pdf':  'pdf',
    '.csv':  'spreadsheets',
    '.xlsx': 'spreadsheets',
    '.xls':  'spreadsheets',
    '.py':   'code',
    '.js':   'code',
    '.cpp':  'code',
    '.css':  'code',
    '.json': 'code',
    '.xml':  'code',
    '.html': 'markup',
    '.epub': 'markup',
    '.pptx': 'presentations'
  };

  const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.py', '.js', '.cpp', '.css', '.json', '.xml', '.html', '.csv'
  ]);

  // Binary files processed in offscreen document
  const BINARY_EXTENSIONS = new Set(['.docx', '.xlsx', '.xls', '.epub', '.pptx']);

  // Files processed in offscreen but as text (not binary)
  const OFFSCREEN_TEXT_EXTENSIONS = new Set(['.pdf']);

  const RTF_EXTENSION = new Set(['.rtf']);

  // Conversion history (in-memory mirror + persisted to storage)
  const conversionHistory = [];

  // ---------------------------------------------------------------------------
  // 2. RECURSION GUARD
  // ---------------------------------------------------------------------------
  let isReDispatching = false;

  // ---------------------------------------------------------------------------
  // 3. LOAD CONFIG FROM chrome.storage.local
  // ---------------------------------------------------------------------------
  function loadConfig() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(null, (items) => {
          if (items) {
            config = { ...config, ...items };
            if (items.categories) {
              config.categories = { ...config.categories, ...items.categories };
            }
            config.regexPipeline = sanitizeRegexPipeline(config.regexPipeline || []);
          }
          resolve(config);
        });
      } else {
        resolve(config);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 4. BLACKLIST CHECK
  // ---------------------------------------------------------------------------
  function isBlacklisted() {
    try {
      const hostname = window.location.hostname;
      if (config.domainBlacklist && config.domainBlacklist.length > 0) {
        for (const domain of config.domainBlacklist) {
          const trimmed = domain.trim();
          if (trimmed && hostname.includes(trimmed)) return true;
        }
      }
    } catch (e) { /* cross-origin — ignore */ }
    return false;
  }

  function shouldInterceptFile(file) {
    const ext = getExtension(file.name).toLowerCase();
    const category = EXTENSION_MAP[ext];
    if (!category) return false;
    if (!config.categories || !config.categories[category]) return false;
    return true;
  }

  function getExtension(filename) {
    const idx = filename.lastIndexOf('.');
    return idx !== -1 ? filename.substring(idx) : '';
  }

  // ---------------------------------------------------------------------------
  // 5. SHADOW DOM TOAST — encapsulated floating UI
  // ---------------------------------------------------------------------------
  let toastRoot = null;
  let toastHost = null;
  let countdownTimer = null;
  let fadeTimer = null;
  let activeFiles = null;
  let activeInputEl = null;
  let activeDropEvent = null;
  let activeDataTransfer = null;

  function createToast() {
    destroyToast();

    toastHost = document.createElement('div');
    toastHost.id = 'ftm-toast-host';
    toastHost.style.cssText = `
      position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:auto;
      opacity:0;transform:translateX(120%);
      transition:opacity 0.35s cubic-bezier(0.4,0,0.2,1),transform 0.45s cubic-bezier(0.4,0,0.2,1);
    `;
    document.documentElement.appendChild(toastHost);
    toastRoot = toastHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = getToastStyles();
    toastRoot.appendChild(style);

    const container = document.createElement('div');
    container.className = 'ftm-toast';
    container.innerHTML = `
      <div class="ftm-toast-inner">
        <div class="ftm-toast-header">
          <svg class="ftm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <span class="ftm-toast-title">Convert to Markdown?</span>
        </div>
        <div class="ftm-toast-body">
          <span class="ftm-toast-filename" id="ftm-filename"></span>
          <span class="ftm-toast-hint">Enter = convert · Esc = skip</span>
        </div>
        <div class="ftm-toast-progress">
          <div class="ftm-toast-progress-bar" id="ftm-progress-bar"></div>
          <span class="ftm-toast-timer" id="ftm-timer"></span>
        </div>
        <div class="ftm-toast-actions">
          <button class="ftm-btn ftm-btn-approve" id="ftm-approve">Convert</button>
          <button class="ftm-btn ftm-btn-deny" id="ftm-deny">Skip</button>
        </div>
      </div>
    `;
    toastRoot.appendChild(container);

    void toastHost.offsetHeight;
    toastHost.style.opacity = '1';
    toastHost.style.transform = 'translateX(0)';

    const approveBtn = toastRoot.getElementById('ftm-approve');
    const denyBtn = toastRoot.getElementById('ftm-deny');
    if (approveBtn) approveBtn.addEventListener('click', () => onApprove());
    if (denyBtn) denyBtn.addEventListener('click', () => onDeny());
  }

  function getToastStyles() {
    return `
      :host { all: initial; display: block; }
      *, *::before, *::after { box-sizing: border-box; }
      .ftm-toast {
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
        width: 360px;
        background: rgba(10, 11, 16, 0.88);
        backdrop-filter: blur(24px) saturate(1.8);
        -webkit-backdrop-filter: blur(24px) saturate(1.8);
        border: 1px solid rgba(0, 210, 255, 0.22);
        border-radius: 16px;
        padding: 20px;
        color: #f0f2f8;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05) inset, 0 0 24px rgba(0, 210, 255, 0.12);
        user-select: none;
      }
      .ftm-toast-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .ftm-icon { width: 22px; height: 22px; color: #00d2ff; flex-shrink: 0; filter: drop-shadow(0 0 6px rgba(0,210,255,0.4)); }
      .ftm-toast-title { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; color: #ffffff; }
      .ftm-toast-body { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
      .ftm-toast-filename { font-size: 13px; font-weight: 500; color: #a0a5ba; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: rgba(255,255,255,0.04); padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); }
      .ftm-toast-hint { font-size: 11px; color: #646a82; display: flex; align-items: center; gap: 6px; }
      .ftm-toast-progress { height: 4px; background: rgba(255, 255, 255, 0.08); border-radius: 2px; overflow: hidden; position: relative; margin-bottom: 16px; }
      .ftm-toast-progress-bar { height: 100%; width: 100%; background: linear-gradient(90deg, #00d2ff, #3b82f6); border-radius: 2px; transition: width 0.1s linear; transform-origin: left; }
      .ftm-toast-timer { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); font-size: 10px; color: #00d2ff; font-weight: 700; }
      .ftm-toast-actions { display: flex; gap: 10px; justify-content: flex-end; }
      .ftm-btn { font-family: inherit; font-size: 13px; font-weight: 600; padding: 8px 18px; border-radius: 10px; border: none; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); outline: none; }
      .ftm-btn-approve { background: linear-gradient(135deg, #00d2ff 0%, #0077b6 100%); color: #ffffff; box-shadow: 0 4px 14px rgba(0, 210, 255, 0.35); }
      .ftm-btn-approve:hover { box-shadow: 0 6px 20px rgba(0, 210, 255, 0.5); transform: translateY(-1px); }
      .ftm-btn-deny { background: rgba(255, 255, 255, 0.06); color: #a0a5ba; border: 1px solid rgba(255, 255, 255, 0.09); }
      .ftm-btn-deny:hover { background: rgba(255, 255, 255, 0.12); color: #ffffff; }
    `;
  }

  function destroyToast() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    if (toastHost) {
      toastHost.style.opacity = '0';
      toastHost.style.transform = 'translateX(120%)';
      const el = toastHost;
      toastHost = null;
      toastRoot = null;
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
    }
  }

  function startCountdown(durationSec) {
    const bar = toastRoot ? toastRoot.getElementById('ftm-progress-bar') : null;
    const timerEl = toastRoot ? toastRoot.getElementById('ftm-timer') : null;
    if (!bar) return;

    const totalMs = durationSec * 1000;
    let elapsed = 0;
    const step = 50;

    countdownTimer = setInterval(() => {
      elapsed += step;
      const remaining = Math.max(0, totalMs - elapsed);
      const pct = (remaining / totalMs) * 100;
      bar.style.width = pct + '%';
      if (timerEl) {
        const secs = Math.ceil(remaining / 1000);
        timerEl.textContent = secs > 0 ? secs + 's' : '';
      }
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        onDeny();
      }
    }, step);
  }

  // ---------------------------------------------------------------------------
  // 6. KEYBOARD LISTENER
  // ---------------------------------------------------------------------------
  function onKeydown(e) {
    if (!toastHost) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onApprove(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDeny(); }
  }

  // ---------------------------------------------------------------------------
  // 7. APPROVE — convert file and re-dispatch with Markdown payload
  // ---------------------------------------------------------------------------
  async function onApprove() {
    if (!toastHost || !activeFiles) return;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    destroyToast();

    const file = activeFiles[0];
    const ext = getExtension(file.name).toLowerCase();

    try {
      let markdownText;

      if (BINARY_EXTENSIONS.has(ext)) {
        markdownText = await processBinaryFile(file);
      } else if (OFFSCREEN_TEXT_EXTENSIONS.has(ext)) {
        markdownText = await processPdfFile(file);
      } else if (ext === '.csv') {
        markdownText = await processCsvFile(file);
      } else if (RTF_EXTENSION.has(ext)) {
        markdownText = await readRtfFile(file);
      } else if (TEXT_EXTENSIONS.has(ext)) {
        markdownText = await processTextFile(file, ext);
      } else {
        markdownText = await processTextFile(file, ext);
      }

      // Apply RegEx Pipeline Sanitization
      markdownText = applyRegexPipeline(markdownText);

      // Inject YAML Frontmatter
      if (config.yamlFrontmatter) {
        markdownText = injectYamlFrontmatter(markdownText, file);
      }

      // Record in conversion history
      recordConversion(file.name, file.size, ext);

      const mdBlob = new Blob([markdownText], { type: 'text/markdown;charset=utf-8' });
      const mdFileName = file.name.replace(/\.[^.]+$/, '') + '.md';
      const mdFile = new File([mdBlob], mdFileName, { type: 'text/markdown', lastModified: Date.now() });

      reDispatchEvent(mdFile);

    } catch (err) {
      console.error('[FTM] Conversion failed:', err);
      if (activeFiles && activeFiles.length > 0) {
        reDispatchEvent(activeFiles[0]);
      }
    }

    activeFiles = null;
    activeInputEl = null;
    activeDropEvent = null;
    activeDataTransfer = null;
  }

  // ---------------------------------------------------------------------------
  // 8. DENY — pass original file through unchanged
  // ---------------------------------------------------------------------------
  function onDeny() {
    if (!toastHost) return;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    destroyToast();

    if (activeFiles && activeFiles.length > 0) {
      reDispatchEvent(activeFiles[0]);
    }

    activeFiles = null;
    activeInputEl = null;
    activeDropEvent = null;
    activeDataTransfer = null;
  }

  // ---------------------------------------------------------------------------
  // 9. RE-DISPATCH — DataTransfer API on exact EventTarget (v6)
  // ---------------------------------------------------------------------------
  function reDispatchEvent(file) {
    isReDispatching = true;

    try {
      // CASE A: Drop event — reconstruct DragEvent on the exact target
      if (activeDropEvent) {
        const dropTarget = activeDropEvent.target;
        const dt = new DataTransfer();
        dt.items.add(file);

        const newDrop = new DragEvent('drop', {
          bubbles: true, cancelable: true, composed: true,
          clientX: activeDropEvent.clientX,
          clientY: activeDropEvent.clientY,
          dataTransfer: dt
        });
        dropTarget.dispatchEvent(newDrop);

        const dragEnd = new DragEvent('dragend', {
          bubbles: true, cancelable: true, composed: true,
          clientX: activeDropEvent.clientX,
          clientY: activeDropEvent.clientY
        });
        dropTarget.dispatchEvent(dragEnd);
        return;
      }

      // CASE B: File input change — DataTransfer replaces read-only FileList
      if (activeInputEl) {
        const inputEl = activeInputEl;
        const dt = new DataTransfer();
        dt.items.add(file);

        // Native files property setter for HTMLInputElement
        try {
          const filesSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'files'
          )?.set;
          if (filesSetter) {
            filesSetter.call(inputEl, dt.files);
          } else {
            inputEl.files = dt.files;
          }
        } catch (_) {
          inputEl.files = dt.files;
        }

        // Native value property setter for React synthetic event trackers
        try {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(inputEl, 'C:\\fakepath\\' + file.name);
          }
        } catch (_) {}

        const changeEvent = new Event('change', { bubbles: true, cancelable: true, composed: true });
        inputEl.dispatchEvent(changeEvent);

        const inputEvent = new Event('input', { bubbles: true, cancelable: true, composed: true });
        inputEl.dispatchEvent(inputEvent);
      }
    } finally {
      setTimeout(() => { isReDispatching = false; }, 0);
    }
  }

  // ===========================================================================
  // INTELLIGENT FEATURES
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 10. HEURISTIC CONTENT SNIFFING — "Trust, But Verify"
  // ---------------------------------------------------------------------------
  function sniffFileContent(file) {
    return new Promise((resolve, reject) => {
      const slice = file.slice(0, 100);
      const reader = new FileReader();

      reader.onload = () => {
        const bytes = new Uint8Array(reader.result);
        const nullBytes = Array.from(bytes).filter(b => b === 0x00).length;
        const isBinary = nullBytes > 3;

        if (isBinary) {
          reject(new Error(
            `Content sniffing detected binary data in "${file.name}" ` +
            `(${nullBytes} null bytes in first 100 bytes). Aborted.`
          ));
        } else {
          resolve(bytes);
        }
      };

      reader.onerror = () => reject(new Error(`Failed to sniff file: ${file.name}`));
      reader.readAsArrayBuffer(slice);
    });
  }

  async function processTextFile(file, ext) {
    const fileName = file.name;

    // Skip content sniffing for tiny files (< 1KB) — overhead not worth it
    if (file.size > 1024) {
      try {
        await sniffFileContent(file);
      } catch (err) {
        console.warn('[FTM]', err.message);
        const MAX_TEXT_READ_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_TEXT_READ_SIZE) {
          throw new Error(
            `File "${fileName}" appears binary and is too large (${formatBytes(file.size)}) to safely read as text.`
          );
        }
      }
    }

    const text = await readFileAsText(file);
    const lang = getLanguageTag(ext);
    if (ext === '.json') {
      return formatJsonAsMarkdown(text, fileName);
    }

    return `# ${fileName}\n\n\`\`\`${lang}\n${text}\n\`\`\``;
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Failed to read: ${file.name}`));
      reader.readAsText(file, 'UTF-8');
    });
  }

  function formatJsonAsMarkdown(text, fileName) {
    try {
      const parsed = JSON.parse(text);
      const pretty = JSON.stringify(parsed, null, 2);
      return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n```json\n' + pretty + '\n```';
    } catch {
      return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n```json\n' + text + '\n```';
    }
  }

  // ---------------------------------------------------------------------------
  // 11. PDF PROCESSING (PDF.js — lazy-loaded in offscreen)
  // ---------------------------------------------------------------------------
  // PDF files are routed to the offscreen document for processing.
  // The offscreen dynamically loads PDF.js, extracts text from each page,
  // and formats it as structured Markdown.
  // ---------------------------------------------------------------------------

  function processPdfFile(file) {
    return processBinaryFile(file);
  }

  // ---------------------------------------------------------------------------
  // 12. TRUE CSV STREAMING (Papa Parse streaming API)
  // ---------------------------------------------------------------------------

  async function processCsvFile(file) {
    const threshold = (config.csvStreamThreshold || 5) * 1024 * 1024;

    if (file.size < threshold) {
      const text = await readFileAsText(file);
      return csvTextToMarkdown(text);
    }

    console.log('[FTM] Large CSV detected (' + formatBytes(file.size) + '). Using Stream API.');
    return streamCsvToMarkdown(file);
  }

  async function streamCsvToMarkdown(file) {
    await loadPapaParse();

    const chunks = [];
    let rowCount = 0;
    let isFirstRow = true;
    let maxCols = 0;

    return new Promise((resolve, reject) => {
      Papa.parse(file.stream(), {
        worker: false,
        streaming: true,
        chunk: function(results) {
          const data = results.data;
          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (!row || (row.length === 1 && row[0] === '')) continue;
            if (rowCount >= 100000) return;

            const cells = row.map(c => {
              const val = String(c !== null && c !== undefined ? c : '').replace(/\|/g, '\\|');
              return val.replace(/\n/g, ' ');
            });

            if (cells.length > maxCols) maxCols = cells.length;

            if (isFirstRow) {
              const headerLine = '| ' + cells.join(' | ') + ' |';
              const separator = '| ' + cells.map(() => '---').join(' | ') + ' |';
              chunks.push(headerLine + '\n' + separator + '\n');
              isFirstRow = false;
            } else {
              while (cells.length < maxCols) cells.push('');
              chunks.push('| ' + cells.join(' | ') + ' |\n');
            }

            rowCount++;
          }

          if (rowCount >= 100000) {
            results.abort();
          }
        },
        complete: function() {
          let markdown = '# CSV Data (Streamed)\n\n';
          markdown += chunks.join('');
          resolve(markdown);
        },
        error: function(err) {
          reject(new Error(`Stream CSV processing failed: ${err.message}`));
        }
      });
    });
  }

  async function loadPapaParse() {
    if (typeof Papa !== 'undefined') return;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('lib/papaparse.min.js');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Papa Parse'));
      document.head.appendChild(script);
    });
  }

  function csvTextToMarkdown(text) {
    if (typeof Papa !== 'undefined') {
      const result = Papa.parse(text, { skipEmptyLines: true });
      const rows = result.data;
      if (rows.length === 0) return '# CSV Data\n\n```\n' + text + '\n```';
      return buildMarkdownTable(rows, '# CSV Data');
    }

    // Fallback
    const lines = text.trim().split(/\r?\n/);
    if (lines.length === 0) return '# CSV Data\n\n```\n' + text + '\n```';
    const rows = lines.filter(l => l.trim()).map(line => parseCsvLine(line));
    return buildMarkdownTable(rows, '# CSV Data');
  }

  function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function buildMarkdownTable(rows, title) {
    if (rows.length === 0) return title + '\n\n*No data*';
    const maxCols = Math.max(...rows.map(r => r.length));
    const normalized = rows.map(r => {
      while (r.length < maxCols) r.push('');
      return r.map(c => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' '));
    });
    const header = '| ' + normalized[0].join(' | ') + ' |';
    const separator = '| ' + normalized[0].map(() => '---').join(' | ') + ' |';
    const body = normalized.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n');
    return title + '\n\n' + header + '\n' + separator + '\n' + body;
  }

  // ---------------------------------------------------------------------------
  // 13. RTF PROCESSING
  // ---------------------------------------------------------------------------
  async function readRtfFile(file) {
    const text = await readFileAsText(file);
    let cleaned = text
      .replace(/\{\\[a-z]+\s?\d+;?/g, '')
      .replace(/\\[a-z]+\d+/g, '')
      .replace(/[{}]/g, '')
      .replace(/\\\*/g, '')
      .replace(/\\'/g, '')
      .replace(/\\par\s*/g, '\n')
      .replace(/\\line\s*/g, '\n')
      .replace(/\\t\s*/g, '  ')
      .replace(/\s+/g, ' ')
      .trim();
    return '# ' + file.name.replace(/\.[^.]+$/, '') + '\n\n' + cleaned;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getLanguageTag(ext) {
    const map = {
      '.txt': 'text', '.md': 'markdown', '.py': 'python', '.js': 'javascript',
      '.cpp': 'cpp', '.css': 'css', '.json': 'json', '.xml': 'xml',
      '.html': 'html', '.csv': 'csv'
    };
    return map[ext] || '';
  }

  // ---------------------------------------------------------------------------
  // 14. BINARY FILE PROCESSING — Transferable Objects (Zero-Copy)
  // ---------------------------------------------------------------------------
  // V6 FIX: Port name is 'ftm' (not 'ftm-offscreen'). Background bridges
  // to 'ftm-offscreen-internal' on the offscreen document.
  // ---------------------------------------------------------------------------

  function processBinaryFile(file) {
    return new Promise(async (resolve, reject) => {
      let port = null;
      let resolved = false;

      try {
        const ext = getExtension(file.name).toLowerCase();

        // Step 1: Ensure offscreen document exists
        await new Promise((res, rej) => {
          chrome.runtime.sendMessage({ type: 'CREATE_OFFSCREEN' }, (response) => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res(response);
          });
        });

        // Step 2: Read file as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // Step 3: V6 FIX — Connect with port name 'ftm'
        port = chrome.runtime.connect({ name: 'ftm' });

        // Step 4: Multi-message listener (persists until response or error)
        port.onMessage.addListener(function onPortMessage(msg) {
          if (msg.type === 'PROCESS_RESULT') {
            resolved = true;
            try { port.disconnect(); } catch (_) {}
            port = null;
            chrome.runtime.sendMessage({ type: 'CLOSE_OFFSCREEN' });
            if (msg.data && msg.data.error) reject(new Error(msg.data.error));
            else resolve(msg.data.markdown || '');
          } else if (msg.type === 'ERROR') {
            resolved = true;
            try { port.disconnect(); } catch (_) {}
            port = null;
            chrome.runtime.sendMessage({ type: 'CLOSE_OFFSCREEN' });
            reject(new Error(msg.data ? msg.data.error : 'Unknown offscreen error'));
          }
        });

        // Step 5: TRANSFERABLE — zero-copy, ownership moves instantly
        port.postMessage(
          { type: 'PROCESS_BINARY_FILE', data: { fileName: file.name, extension: ext, arrayBuffer } },
          [arrayBuffer]
        );

        // Safety timeout
        setTimeout(() => {
          if (port && !resolved) {
            resolved = true;
            try { port.disconnect(); } catch (_) {}
            port = null;
            chrome.runtime.sendMessage({ type: 'CLOSE_OFFSCREEN' });
            reject(new Error('Offscreen processing timed out (60s)'));
          }
        }, 60000);

      } catch (err) {
        if (port) { try { port.disconnect(); } catch (_) {} port = null; }
        try { chrome.runtime.sendMessage({ type: 'CLOSE_OFFSCREEN' }); } catch (_) {}
        reject(err);
      }
    });
  }

  // ===========================================================================
  // INTELLIGENT POST-PROCESSING
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // 15. YAML FRONTMATTER INJECTION
  // ---------------------------------------------------------------------------
  function injectYamlFrontmatter(markdown, file) {
    const now = new Date();
    const yamlBlock = [
      '---',
      'original_file: "' + escapeYamlString(file.name) + '"',
      'original_size: "' + file.size + '"',
      'original_size_human: "' + formatBytes(file.size) + '"',
      'converted: "' + now.toISOString() + '"',
      'converted_date: "' + now.toISOString().split('T')[0] + '"',
      'format: "markdown"',
      '---',
      ''
    ].join('\n');

    // Remove existing frontmatter if present
    let clean = markdown;
    const fmMatch = clean.match(/^---\n[\s\S]*?\n---\n?/);
    if (fmMatch) clean = clean.substring(fmMatch[0].length);

    return yamlBlock + clean;
  }

  function escapeYamlString(str) {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  // ---------------------------------------------------------------------------
  // 16. REGEX PIPELINE SANITIZATION
  // ---------------------------------------------------------------------------
  function applyRegexPipeline(text) {
    // Built-in sanitization
    if (config.stripTrailingWhitespace !== false) {
      text = text.replace(/[ \t]+$/gm, '');
    }
    text = text.replace(/\n{4,}/g, '\n\n\n');

    if (config.enforceHeadingHierarchy) {
      text = enforceHeadingHierarchy(text);
    }

    if (config.regexPipeline && config.regexPipeline.length > 0) {
      for (const rule of config.regexPipeline) {
        if (!rule || !rule.enabled) continue;
        if (!rule.pattern) continue;
        try {
          const regex = new RegExp(rule.pattern, rule.flags || 'g');
          text = text.replace(regex, rule.replacement || '');
        } catch (err) {
          console.warn('[FTM] Regex pipeline rule failed:', rule.pattern, err.message);
        }
      }
    }

    return text;
  }

  function enforceHeadingHierarchy(text) {
    const headingLines = text.match(/^#{1,6}\s/m);
    if (!headingLines) return text;
    const minLevel = headingLines[0].match(/^#+/)[0].length;
    if (minLevel === 1) return text;
    const shift = minLevel - 1;
    return text.replace(/^(#{1,6})\s/gm, (match, hashes) => {
      const newLevel = hashes.length - shift;
      if (newLevel < 1) return '# ';
      return '#'.repeat(newLevel) + ' ';
    });
  }

  function sanitizeRegexPipeline(rules) {
    if (!Array.isArray(rules)) return [];
    return rules
      .filter(r => r && r.pattern && typeof r.pattern === 'string')
      .map(r => ({
        pattern: r.pattern,
        replacement: typeof r.replacement === 'string' ? r.replacement : '',
        flags: (r.flags || '').replace(/[^gimsuy]/g, ''),
        enabled: r.enabled !== false,
        name: typeof r.name === 'string' ? r.name : ''
      }));
  }

  // ---------------------------------------------------------------------------
  // 17. CONVERSION HISTORY (persisted to chrome.storage.local)
  // ---------------------------------------------------------------------------
  function recordConversion(fileName, fileSize, extension) {
    conversionHistory.push({
      file: fileName,
      size: fileSize,
      extension: extension,
      timestamp: new Date().toISOString()
    });

    const maxHistory = config.maxConversions || 50;
    while (conversionHistory.length > maxHistory) {
      conversionHistory.shift();
    }

    chrome.storage.local.set({
      conversionHistory: [...conversionHistory]
    });
  }

  // ---------------------------------------------------------------------------
  // 18. EVENT INTERCEPTION — CAPTURE phase listeners
  // ---------------------------------------------------------------------------
  function handleDropCapture(event) {
    if (!config.enabled) return;
    if (isBlacklisted()) return;
    if (isReDispatching) return;

    const dt = event.dataTransfer;
    if (!dt || !dt.files || dt.files.length === 0) return;

    const file = dt.files[0];
    if (!shouldInterceptFile(file)) return;

    event.preventDefault();
    event.stopPropagation();

    activeFiles = Array.from(dt.files);
    activeDropEvent = event;
    activeDataTransfer = dt;
    activeInputEl = null;

    createToast();
    const filenameEl = toastRoot.getElementById('ftm-filename');
    if (filenameEl) filenameEl.textContent = file.name + ' (' + formatBytes(file.size) + ')';

    if (config.autoDismissSeconds > 0) {
      startCountdown(config.autoDismissSeconds);
    } else {
      const timerEl = toastRoot.getElementById('ftm-timer');
      if (timerEl) timerEl.textContent = '\u221E';
    }
  }

  function handleFileInputChange(event) {
    if (!config.enabled) return;
    if (isBlacklisted()) return;
    if (isReDispatching) return;

    const input = event.target;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'file') return;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    if (!shouldInterceptFile(file)) return;

    event.preventDefault();
    event.stopPropagation();

    activeFiles = Array.from(input.files);
    activeInputEl = input;
    activeDropEvent = null;
    activeDataTransfer = null;

    createToast();
    const filenameEl = toastRoot.getElementById('ftm-filename');
    if (filenameEl) filenameEl.textContent = file.name + ' (' + formatBytes(file.size) + ')';

    if (config.autoDismissSeconds > 0) {
      startCountdown(config.autoDismissSeconds);
    } else {
      const timerEl = toastRoot.getElementById('ftm-timer');
      if (timerEl) timerEl.textContent = '\u221E';
    }
  }

  function registerListeners() {
    document.addEventListener('drop', handleDropCapture, true);
    document.addEventListener('dragover', () => { /* no preventDefault */ }, true);
    document.addEventListener('change', handleFileInputChange, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  // ---------------------------------------------------------------------------
  // 19. LIFECYCLE HYGIENE
  // ---------------------------------------------------------------------------
  function cleanup() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    if (toastHost && toastHost.parentNode) {
      toastHost.parentNode.removeChild(toastHost);
    }
    toastHost = null;
    toastRoot = null;
    activeFiles = null;
    activeInputEl = null;
    activeDropEvent = null;
    activeDataTransfer = null;
    isReDispatching = false;
  }

  window.addEventListener('pagehide', cleanup);
  window.addEventListener('beforeunload', cleanup);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cleanup();
  });

  // ---------------------------------------------------------------------------
  // 20. CONFIG UPDATES
  // ---------------------------------------------------------------------------
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'CONFIG_UPDATE') {
        config = { ...config, ...message.config };
        if (message.config && message.config.categories) {
          config.categories = {
            ...config.categories,
            ...message.config.categories
          };
        }
        config.regexPipeline = sanitizeRegexPipeline(config.regexPipeline || []);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 21. INITIALIZATION
  // ---------------------------------------------------------------------------
  async function init() {
    await loadConfig();
    if (!config.enabled) return;
    registerListeners();
    console.log('[FTM] File-to-Markdown converter initialized (v6)');
  }

  init();

})();
