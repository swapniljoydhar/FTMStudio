// ===========================================================================
// content/intercept.js — Event interception, dispatch, and initialization
// ===========================================================================

window.FTM = window.FTM || {};

let isReDispatching = false;
let activeFiles = null;
let activeInputEl = null;
let activeDropEvent = null;
let activeDataTransfer = null;

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
function onKeydown(e) {
  if (!FTM.getToastHost()) return;
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); FTM.onApprove(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); FTM.onDeny(); }
}

// ---------------------------------------------------------------------------
// Approve — convert and re-dispatch
// ---------------------------------------------------------------------------
FTM.onApprove = async function () {
  if (!FTM.getToastHost() || !activeFiles) return;
  if (FTM.getCountdownTimer()) { clearInterval(FTM.getCountdownTimer()); FTM.setCountdownTimer(null); }
  FTM.destroyToast();

  const file = activeFiles[0];
  const ext = FTM.getExtension(file.name).toLowerCase();

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
    reDispatchEvent(mdFile);
  } catch (err) {
    console.error('[FTM] Conversion failed:', err);
    if (activeFiles.length > 0) reDispatchEvent(activeFiles[0]);
  }

  activeFiles = null;
  activeInputEl = null;
  activeDropEvent = null;
  activeDataTransfer = null;
};

// ---------------------------------------------------------------------------
// Deny — pass original file through
// ---------------------------------------------------------------------------
FTM.onDeny = function () {
  if (!FTM.getToastHost()) return;
  if (FTM.getCountdownTimer()) { clearInterval(FTM.getCountdownTimer()); FTM.setCountdownTimer(null); }
  FTM.destroyToast();
  if (activeFiles && activeFiles.length > 0) reDispatchEvent(activeFiles[0]);
  activeFiles = null;
  activeInputEl = null;
  activeDropEvent = null;
  activeDataTransfer = null;
};

// ---------------------------------------------------------------------------
// Re-dispatch
// ---------------------------------------------------------------------------
function reDispatchEvent(file) {
  isReDispatching = true;
  try {
    if (activeDropEvent) {
      const dt = new DataTransfer();
      dt.items.add(file);
      activeDropEvent.target.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, composed: true,
        clientX: activeDropEvent.clientX, clientY: activeDropEvent.clientY, dataTransfer: dt
      }));
      activeDropEvent.target.dispatchEvent(new DragEvent('dragend', {
        bubbles: true, cancelable: true, composed: true,
        clientX: activeDropEvent.clientX, clientY: activeDropEvent.clientY
      }));
      return;
    }
    if (activeInputEl) {
      const dt = new DataTransfer();
      dt.items.add(file);
      try {
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set;
        if (set) set.call(activeInputEl, dt.files);
        else activeInputEl.files = dt.files;
      } catch (_) { activeInputEl.files = dt.files; }
      try {
        const valSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (valSet) valSet.call(activeInputEl, 'C:\\fakepath\\' + file.name);
      } catch (_) {}
      activeInputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      activeInputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
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
  document.addEventListener('drop', handleDropCapture, true);
  document.addEventListener('change', handleFileInputChange, true);
  document.addEventListener('keydown', onKeydown, true);
  console.log('[FTM] Initialized (v1.0.1)');
})();
