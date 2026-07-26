// ===========================================================================
// content/intercept.js — Event interception, dispatch, and initialization
// ===========================================================================

window.FTM = window.FTM || {};

let isReDispatching = false;
let isConverting = false; // Guard against concurrent conversions
let activeFiles = null;
let activeInputEl = null;
let activeDropEvent = null;
let activeDataTransfer = null;
let autoConvertMode = false; // New: automatic conversion without prompt

// ---------------------------------------------------------------------------
// Keyboard shortcuts (for manual override if needed)
// ---------------------------------------------------------------------------
function onKeydown(e) {
  if (!FTM.getToastHost()) return;
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); FTM.onApprove(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); FTM.onDeny(); }
}

// ---------------------------------------------------------------------------
// Show conversion error feedback
// ---------------------------------------------------------------------------
function showConversionError(fileName, errorMsg) {
  try {
    const host = document.createElement('div');
    host.id = 'ftm-error-toast';
    host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:auto;opacity:0;transition:opacity 0.3s;';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'closed' });
    const safeFileName = fileName.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const safeErrorMsg = errorMsg.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    root.innerHTML = `
      <style>
        .err { font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif; width: 300px; background: #fff; border: 1px solid #e8e8ec; border-radius: 10px; padding: 12px 14px; color: #1a1a1e; box-shadow: 0 8px 32px rgba(0,0,0,0.12); }
        @media (prefers-color-scheme: dark) { .err { background: #1a1a1e; border-color: #2a2a2e; color: #ededf0; box-shadow: 0 8px 32px rgba(0,0,0,0.4); } }
        .err-title { font-size: 12px; font-weight: 600; color: #ff3b30; margin-bottom: 4px; }
        .err-file { font-size: 11px; color: #6b6b76; font-family: 'SF Mono', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
        .err-msg { font-size: 10px; color: #9d9da8; word-break: break-word; }
        @media (prefers-color-scheme: dark) { .err-title { color: #ff453a; } .err-file { color: #8e8e9a; } .err-msg { color: #5c5c68; } }
      </style>
      <div class="err">
        <div class="err-title">⚠ Conversion Failed</div>
        <div class="err-file">${safeFileName}</div>
        <div class="err-msg">${safeErrorMsg}</div>
      </div>
    `;
    void host.offsetHeight;
    host.style.opacity = '1';
    setTimeout(() => {
      host.style.opacity = '0';
      setTimeout(() => { if (host.parentNode) host.parentNode.removeChild(host); }, 400);
    }, 4000);
  } catch (_) { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Approve — convert and re-dispatch (or auto-convert if enabled)
// ---------------------------------------------------------------------------
FTM.onApprove = async function () {
  if (!activeFiles || isConverting) return;
  isConverting = true;
  if (FTM.getCountdownTimer()) { clearInterval(FTM.getCountdownTimer()); FTM.setCountdownTimer(null); }
  FTM.destroyToast();

  const file = activeFiles[0];
  const ext = FTM.getExtension(file.name).toLowerCase();

  // Capture all re-dispatch state BEFORE any async work
  const dropEvent = activeDropEvent;
  const inputEl = activeInputEl;
  const files = activeFiles;

  try {
    let md;
    if (FTM.BINARY_EXTENSIONS.has(ext)) {
      md = await FTM.processBinaryFile(file);
    } else if (ext === '.csv') {
      md = await FTM.processCsvFile(file);
    } else if (FTM.RTF_EXTENSION.has(ext)) {
      md = await FTM.readRtfFile(file);
    } else {
      md = await FTM.processTextFile(file, ext);
    }

    md = FTM.applyRegexPipeline(md);
    if (FTM.config.yamlFrontmatter) md = FTM.injectYamlFrontmatter(md, file);
    FTM.recordConversion(file.name, file.size, ext);

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const mdFile = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.md', { type: 'text/markdown', lastModified: Date.now() });
    reDispatchEvent(mdFile, dropEvent, inputEl);
  } catch (err) {
    console.error('[FTM] Conversion failed:', err);
    showConversionError(file.name, err.message || 'Unknown error');
    if (files.length > 0) reDispatchEvent(files[0], dropEvent, inputEl);
  } finally {
    activeFiles = null;
    activeInputEl = null;
    activeDropEvent = null;
    activeDataTransfer = null;
    isConverting = false;
  }
};

// ---------------------------------------------------------------------------
// Deny — pass original file through
// ---------------------------------------------------------------------------
FTM.onDeny = function () {
  if (!FTM.getToastHost() || isConverting) return;
  if (FTM.getCountdownTimer()) { clearInterval(FTM.getCountdownTimer()); FTM.setCountdownTimer(null); }
  FTM.destroyToast();
  const dropEvent = activeDropEvent;
  const inputEl = activeInputEl;
  if (activeFiles && activeFiles.length > 0) reDispatchEvent(activeFiles[0], dropEvent, inputEl);
  activeFiles = null;
  activeInputEl = null;
  activeDropEvent = null;
  activeDataTransfer = null;
};

// ---------------------------------------------------------------------------
// Re-dispatch
// ---------------------------------------------------------------------------
function reDispatchEvent(file, dropEvent, inputEl) {
  if (!file) { console.warn('[FTM] reDispatchEvent: no file provided'); return; }
  isReDispatching = true;
  try {
    if (dropEvent && dropEvent.target) {
      const dt = new DataTransfer();
      dt.items.add(file);
      dropEvent.target.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, composed: true,
        clientX: dropEvent.clientX, clientY: dropEvent.clientY, dataTransfer: dt
      }));
      dropEvent.target.dispatchEvent(new DragEvent('dragend', {
        bubbles: true, cancelable: true, composed: true,
        clientX: dropEvent.clientX, clientY: dropEvent.clientY
      }));
      return;
    }
    if (inputEl) {
      const dt = new DataTransfer();
      dt.items.add(file);
      try {
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set;
        if (set) set.call(inputEl, dt.files);
        else inputEl.files = dt.files;
      } catch (_) { inputEl.files = dt.files; }
      try {
        const valSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (valSet) valSet.call(inputEl, 'C:\\fakepath\\' + file.name);
      } catch (_) {}
      inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    } else {
      console.warn('[FTM] reDispatchEvent: no drop event or input element available');
    }
  } finally {
    setTimeout(() => { isReDispatching = false; }, 0);
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
function handleDropCapture(event) {
  if (!FTM.config.enabled || !FTM.shouldActivate() || isReDispatching) return;
  const dt = event.dataTransfer;
  if (!dt || !dt.files || dt.files.length === 0) return;
  const file = dt.files[0];
  if (!FTM.shouldInterceptFile(file)) return;
  event.preventDefault();
  event.stopPropagation();
  activeFiles = Array.from(dt.files);
  activeDropEvent = event;
  activeDataTransfer = dt;
  activeInputEl = null;
  showPrompt(file);
}

function handleFileInputChange(event) {
  if (!FTM.config.enabled || !FTM.shouldActivate() || isReDispatching) return;
  const input = event.target;
  if (!input || input.tagName !== 'INPUT' || input.type !== 'file') return;
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];
  if (!FTM.shouldInterceptFile(file)) return;
  event.preventDefault();
  event.stopPropagation();
  activeFiles = Array.from(input.files);
  activeInputEl = input;
  activeDropEvent = null;
  activeDataTransfer = null;
  showPrompt(file);
}

function showPrompt(file) {
  // If auto-convert mode is enabled, skip the toast and convert immediately
  if (autoConvertMode) {
    FTM.onApprove();
    return;
  }

  FTM.createToast();
  const el = FTM.getToastRoot()?.getElementById('ftm-filename');
  if (el) el.textContent = file.name + ' (' + FTM.formatBytes(file.size) + ')';
  if (FTM.config.autoDismissSeconds > 0) {
    FTM.startCountdown(FTM.config.autoDismissSeconds);
  } else {
    const t = FTM.getToastRoot()?.getElementById('ftm-timer');
    if (t) t.textContent = '\u221E';
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
function cleanup() {
  // Don't cleanup while conversion is in progress — state is captured locally
  if (isConverting) return;
  if (FTM.getCountdownTimer()) { clearInterval(FTM.getCountdownTimer()); FTM.setCountdownTimer(null); }
  FTM.destroyToast();
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
// Init
// ---------------------------------------------------------------------------
(async function init() {
  await FTM.loadConfig();
  if (!FTM.config.enabled) return;
  
  // Set auto-convert mode based on config
  autoConvertMode = !!FTM.config.autoConvert;
  
  document.addEventListener('drop', handleDropCapture, true);
  document.addEventListener('change', handleFileInputChange, true);
  document.addEventListener('keydown', onKeydown, true);
  console.log('[FTM] Initialized (v1.0.1)', autoConvertMode ? '(Auto-convert enabled)' : '');
})();
