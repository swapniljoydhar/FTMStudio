// ===========================================================================
// content/toast.js — Shadow DOM toast UI (v4.0)
// ===========================================================================
// Changes from v3.0:
//   - Unified accent color (#1a73e8) matching popup
//   - File type badge + size category indicator
//   - Processing spinner for binary file conversion
//   - Auto-dismiss label clarified ("Auto-skip in Xs")
// ===========================================================================

window.FTM = window.FTM || {};

let toastRoot = null;
let toastHost = null;
let countdownTimer = null;

FTM.getToastRoot = () => toastRoot;
FTM.getToastHost = () => toastHost;
FTM.setCountdownTimer = (t) => { countdownTimer = t; };
FTM.getCountdownTimer = () => countdownTimer;

// File type metadata for badges
const FILE_TYPE_META = {
  '.pdf':  { label: 'PDF',  color: '#d93025', icon: '📄' },
  '.docx': { label: 'DOCX', color: '#1a73e8', icon: '📝' },
  '.xlsx': { label: 'XLSX', color: '#1e8e3e', icon: '📊' },
  '.xls':  { label: 'XLS',  color: '#1e8e3e', icon: '📊' },
  '.csv':  { label: 'CSV',  color: '#1e8e3e', icon: '📊' },
  '.pptx': { label: 'PPTX', color: '#e8710a', icon: '📽' },
  '.epub': { label: 'EPUB', color: '#9334e6', icon: '📚' },
  '.rtf':  { label: 'RTF',  color: '#1a73e8', icon: '📝' },
  '.txt':  { label: 'TXT',  color: '#5f6368', icon: '📃' },
  '.md':   { label: 'MD',   color: '#5f6368', icon: '📃' },
  '.py':   { label: 'PY',   color: '#3572A5', icon: '🐍' },
  '.js':   { label: 'JS',   color: '#f7df1e', icon: '⚡' },
  '.json': { label: 'JSON', color: '#5f6368', icon: '{ }' },
  '.html': { label: 'HTML', color: '#e34c26', icon: '🌐' },
  '.css':  { label: 'CSS',  color: '#563d7c', icon: '🎨' },
  '.xml':  { label: 'XML',  color: '#5f6368', icon: '< >' },
  '.cpp':  { label: 'C++',  color: '#f34b7d', icon: '⚙' },
  '.png':  { label: 'PNG',  color: '#1a73e8', icon: '🖼' },
  '.jpg':  { label: 'JPG',  color: '#1a73e8', icon: '🖼' },
  '.jpeg': { label: 'JPEG', color: '#1a73e8', icon: '🖼' },
  '.gif':  { label: 'GIF',  color: '#1a73e8', icon: '🖼' },
  '.webp': { label: 'WEBP', color: '#1a73e8', icon: '🖼' },
  '.svg':  { label: 'SVG',  color: '#1a73e8', icon: '🖼' },
};

function getFileTypeMeta(filename) {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return FILE_TYPE_META[ext] || { label: ext.replace('.', '').toUpperCase(), color: '#5f6368', icon: '📎' };
}

function getSizeCategory(bytes) {
  if (bytes < 1024) return null;
  if (bytes < 100 * 1024) return null; // < 100KB, not worth showing
  if (bytes < 1024 * 1024) return 'small';
  if (bytes < 10 * 1024 * 1024) return 'medium';
  if (bytes < 50 * 1024 * 1024) return 'large';
  return 'huge';
}

FTM.createToast = function () {
  if (toastHost) return;

  toastHost = document.createElement('div');
  toastHost.id = 'ftm-toast-host';
  toastHost.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:auto;opacity:0;transform:translateX(120%);transition:opacity 0.35s cubic-bezier(0.4,0,0.2,1),transform 0.45s cubic-bezier(0.4,0,0.2,1);';
  document.documentElement.appendChild(toastHost);
  toastRoot = toastHost.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = FTM.getToastStyles();
  toastRoot.appendChild(style);

  const container = document.createElement('div');
  container.className = 'ftm-toast';

  // Header
  const header = document.createElement('div');
  header.className = 'ftm-toast-header';
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('class', 'ftm-icon');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', 'currentColor');
  iconSvg.setAttribute('stroke-width', '2');
  [['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
   ['polyline', { points: '14 2 14 8 20 8' }],
   ['line', { x1: '16', y1: '13', x2: '8', y2: '13' }],
   ['line', { x1: '16', y1: '17', x2: '8', y2: '17' }],
   ['polyline', { points: '10 9 9 9 8 9' }]
  ].forEach(([tag, attrs]) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); iconSvg.appendChild(el); });
  const title = document.createElement('span');
  title.className = 'ftm-toast-title';
  title.textContent = 'Convert to Markdown?';
  header.appendChild(iconSvg);
  header.appendChild(title);

  // File info row (badge + name + size)
  const fileInfo = document.createElement('div');
  fileInfo.className = 'ftm-file-info';

  const badge = document.createElement('span');
  badge.className = 'ftm-file-badge';
  badge.id = 'ftm-badge';

  const filename = document.createElement('span');
  filename.className = 'ftm-toast-filename';
  filename.id = 'ftm-filename';

  const sizeIndicator = document.createElement('span');
  sizeIndicator.className = 'ftm-size-indicator';
  sizeIndicator.id = 'ftm-size-indicator';

  fileInfo.appendChild(badge);
  fileInfo.appendChild(filename);
  fileInfo.appendChild(sizeIndicator);

  // Body
  const body = document.createElement('div');
  body.className = 'ftm-toast-body';
  const hint = document.createElement('span');
  hint.className = 'ftm-toast-hint';
  hint.id = 'ftm-hint';
  hint.textContent = 'Enter = convert \u00B7 Esc = skip';
  body.appendChild(fileInfo);
  body.appendChild(hint);

  // Progress bar
  const progress = document.createElement('div');
  progress.className = 'ftm-toast-progress';
  const progressBar = document.createElement('div');
  progressBar.className = 'ftm-toast-progress-bar';
  progressBar.id = 'ftm-progress-bar';
  const timerEl = document.createElement('span');
  timerEl.className = 'ftm-toast-timer';
  timerEl.id = 'ftm-timer';
  progress.appendChild(progressBar);
  progress.appendChild(timerEl);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'ftm-toast-actions';
  const approveBtn = document.createElement('button');
  approveBtn.className = 'ftm-btn ftm-btn-approve';
  approveBtn.id = 'ftm-approve';
  approveBtn.textContent = 'Convert';
  const denyBtn = document.createElement('button');
  denyBtn.className = 'ftm-btn ftm-btn-deny';
  denyBtn.id = 'ftm-deny';
  denyBtn.textContent = 'Skip';
  actions.appendChild(approveBtn);
  actions.appendChild(denyBtn);

  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(progress);
  container.appendChild(actions);
  toastRoot.appendChild(container);

  approveBtn.addEventListener('click', () => FTM.onApprove());
  denyBtn.addEventListener('click', () => FTM.onDeny());
};

FTM.showToast = function (file) {
  FTM.createToast();

  // File type badge
  const meta = getFileTypeMeta(file.name);
  const badgeEl = toastRoot.getElementById('ftm-badge');
  if (badgeEl) {
    badgeEl.textContent = meta.label;
    badgeEl.style.background = meta.color;
    badgeEl.style.color = '#fff';
  }

  // Filename
  const nameEl = toastRoot.getElementById('ftm-filename');
  if (nameEl) nameEl.textContent = file.name;

  // Size category
  const sizeEl = toastRoot.getElementById('ftm-size-indicator');
  if (sizeEl) {
    const cat = getSizeCategory(file.size);
    if (cat) {
      sizeEl.textContent = FTM.formatBytes(file.size);
      sizeEl.className = 'ftm-size-indicator ftm-size-' + cat;
      sizeEl.style.display = '';
    } else {
      sizeEl.textContent = FTM.formatBytes(file.size);
      sizeEl.className = 'ftm-size-indicator';
      sizeEl.style.display = '';
    }
  }

  // Progress bar
  const bar = toastRoot.getElementById('ftm-progress-bar');
  if (bar) bar.style.width = '100%';
  const timerEl = toastRoot.getElementById('ftm-timer');
  if (timerEl) timerEl.textContent = '';

  // Reset hint
  const hintEl = toastRoot.getElementById('ftm-hint');
  if (hintEl) hintEl.textContent = 'Enter = convert \u00B7 Esc = skip';

  void toastHost.offsetHeight;
  toastHost.style.opacity = '1';
  toastHost.style.transform = 'translateX(0)';
};

FTM.showProcessing = function (filename) {
  if (!toastRoot) return;
  const hintEl = toastRoot.getElementById('ftm-hint');
  if (hintEl) {
    hintEl.innerHTML = '';
    const spinner = document.createElement('span');
    spinner.className = 'ftm-spinner';
    const label = document.createElement('span');
    label.textContent = 'Converting\u2026';
    hintEl.appendChild(spinner);
    hintEl.appendChild(label);
  }
  const approveBtn = toastRoot.getElementById('ftm-approve');
  if (approveBtn) { approveBtn.disabled = true; approveBtn.textContent = 'Converting\u2026'; approveBtn.style.opacity = '0.6'; }
  const denyBtn = toastRoot.getElementById('ftm-deny');
  if (denyBtn) { denyBtn.disabled = true; denyBtn.style.opacity = '0.4'; }
};

FTM.hideToast = function () {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (toastHost) {
    toastHost.style.opacity = '0';
    toastHost.style.transform = 'translateX(120%)';
  }
};

FTM.destroyToast = function () {
  FTM.hideToast();
  if (toastHost) {
    const el = toastHost;
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
    toastHost = null;
    toastRoot = null;
  }
};

FTM.getToastStyles = function () {
  return `
    :host { all: initial; display: block; }
    *, *::before, *::after { box-sizing: border-box; }
    .ftm-toast {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
      width: 340px; background: #fff; border: 1px solid #e8e8ec; border-radius: 10px;
      padding: 14px; color: #1a1a1e; box-shadow: 0 8px 32px rgba(0,0,0,0.12); user-select: none;
    }
    @media (prefers-color-scheme: dark) {
      .ftm-toast { background: #1a1a1e; border-color: #2a2a2e; color: #ededf0; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    }

    .ftm-toast-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .ftm-icon { width: 16px; height: 16px; color: #1a73e8; flex-shrink: 0; }
    .ftm-toast-title { font-size: 13px; font-weight: 600; color: #1a1a1e; letter-spacing: -0.01em; }
    @media (prefers-color-scheme: dark) { .ftm-toast-title { color: #ededf0; } }

    .ftm-toast-body { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }

    /* File info row */
    .ftm-file-info { display: flex; align-items: center; gap: 8px; }
    .ftm-file-badge {
      font-size: 9px; font-weight: 700; letter-spacing: 0.03em; padding: 2px 6px;
      border-radius: 4px; flex-shrink: 0; text-transform: uppercase;
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
    }
    .ftm-toast-filename {
      font-size: 11px; font-weight: 450; color: #6b6b76;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace; flex: 1; min-width: 0;
    }
    @media (prefers-color-scheme: dark) { .ftm-toast-filename { color: #8e8e9a; } }

    .ftm-size-indicator {
      font-size: 10px; font-weight: 500; color: #5f6368; flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .ftm-size-medium { color: #e8710a; }
    .ftm-size-large { color: #d93025; font-weight: 600; }
    .ftm-size-huge { color: #d93025; font-weight: 700; }
    @media (prefers-color-scheme: dark) {
      .ftm-size-indicator { color: #9aa0a6; }
      .ftm-size-medium { color: #fbbc04; }
      .ftm-size-large { color: #f28b82; }
      .ftm-size-huge { color: #f28b82; }
    }

    .ftm-toast-hint { font-size: 10px; color: #9d9da8; display: flex; align-items: center; gap: 6px; }

    /* Spinner */
    .ftm-spinner {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid #e8e8ec; border-top-color: #1a73e8;
      border-radius: 50%; animation: ftm-spin 0.6s linear infinite;
    }
    @media (prefers-color-scheme: dark) {
      .ftm-spinner { border-color: #2a2a2e; border-top-color: #8ab4f8; }
    }
    @keyframes ftm-spin { to { transform: rotate(360deg); } }

    .ftm-toast-progress {
      height: 2px; background: #e8e8ec; border-radius: 1px; overflow: hidden;
      position: relative; margin-bottom: 12px;
    }
    @media (prefers-color-scheme: dark) { .ftm-toast-progress { background: #2a2a2e; } }
    .ftm-toast-progress-bar {
      height: 100%; width: 100%; background: #1a73e8; border-radius: 1px;
      transition: width 0.1s linear; transform-origin: left;
    }
    @media (prefers-color-scheme: dark) { .ftm-toast-progress-bar { background: #8ab4f8; } }
    .ftm-toast-timer {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      font-size: 9px; color: #1a73e8; font-weight: 500;
    }
    @media (prefers-color-scheme: dark) { .ftm-toast-timer { color: #8ab4f8; } }

    .ftm-toast-actions { display: flex; gap: 6px; justify-content: flex-end; }
    .ftm-btn {
      font-family: inherit; font-size: 12px; font-weight: 500;
      padding: 6px 12px; border-radius: 6px; border: none;
      cursor: pointer; transition: all 0.15s; outline: none;
    }
    .ftm-btn-approve { background: #1a1a1e; color: #fff; }
    .ftm-btn-approve:hover { opacity: 0.85; }
    .ftm-btn-deny { background: transparent; color: #6b6b76; }
    .ftm-btn-deny:hover { color: #1a1a1e; }
    @media (prefers-color-scheme: dark) {
      .ftm-btn-approve { background: #ededf0; color: #111113; }
      .ftm-btn-deny { color: #8e8e9a; }
      .ftm-btn-deny:hover { color: #ededf0; }
    }
  `;
};

FTM.startCountdown = function (durationSec) {
  const bar = toastRoot ? toastRoot.getElementById('ftm-progress-bar') : null;
  const timerEl = toastRoot ? toastRoot.getElementById('ftm-timer') : null;
  if (!bar) return;
  const totalMs = durationSec * 1000;
  let elapsed = 0;
  countdownTimer = setInterval(() => {
    elapsed += 50;
    const remaining = Math.max(0, totalMs - elapsed);
    bar.style.width = (remaining / totalMs * 100) + '%';
    if (timerEl) {
      const s = Math.ceil(remaining / 1000);
      timerEl.textContent = s > 0 ? 'Auto-skip in ' + s + 's' : '';
    }
    if (remaining <= 0) { clearInterval(countdownTimer); countdownTimer = null; FTM.onDeny(); }
  }, 50);
};
