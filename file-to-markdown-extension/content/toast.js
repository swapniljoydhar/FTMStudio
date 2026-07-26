// ===========================================================================
// content/toast.js — Shadow DOM toast UI
// ===========================================================================

window.FTM = window.FTM || {};

let toastRoot = null;
let toastHost = null;
let countdownTimer = null;
let fadeTimer = null;

FTM.getToastRoot = () => toastRoot;
FTM.getToastHost = () => toastHost;
FTM.setCountdownTimer = (t) => { countdownTimer = t; };
FTM.getCountdownTimer = () => countdownTimer;

FTM.createToast = function () {
  FTM.destroyToast();

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
  ].forEach(([tag, attrs]) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    iconSvg.appendChild(el);
  });
  const title = document.createElement('span');
  title.className = 'ftm-toast-title';
  title.textContent = 'Convert to Markdown?';
  header.appendChild(iconSvg);
  header.appendChild(title);

  // Body
  const body = document.createElement('div');
  body.className = 'ftm-toast-body';
  const filename = document.createElement('span');
  filename.className = 'ftm-toast-filename';
  filename.id = 'ftm-filename';
  const hint = document.createElement('span');
  hint.className = 'ftm-toast-hint';
  hint.textContent = 'Enter = convert · Esc = skip';
  body.appendChild(filename);
  body.appendChild(hint);

  // Progress
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

  void toastHost.offsetHeight;
  toastHost.style.opacity = '1';
  toastHost.style.transform = 'translateX(0)';

  approveBtn.addEventListener('click', () => FTM.onApprove());
  denyBtn.addEventListener('click', () => FTM.onDeny());
};

FTM.getToastStyles = function () {
  return `
    :host { all: initial; display: block; }
    *, *::before, *::after { box-sizing: border-box; }
    .ftm-toast { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif; width: 320px; background: #fff; border: 1px solid #e8e8ec; border-radius: 10px; padding: 14px; color: #1a1a1e; box-shadow: 0 8px 32px rgba(0,0,0,0.12); user-select: none; }
    @media (prefers-color-scheme: dark) { .ftm-toast { background: #1a1a1e; border-color: #2a2a2e; color: #ededf0; box-shadow: 0 8px 32px rgba(0,0,0,0.4); } }
    .ftm-toast-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .ftm-icon { width: 16px; height: 16px; color: #4f6ef7; flex-shrink: 0; }
    .ftm-toast-title { font-size: 13px; font-weight: 600; color: #1a1a1e; letter-spacing: -0.01em; }
    @media (prefers-color-scheme: dark) { .ftm-toast-title { color: #ededf0; } }
    .ftm-toast-body { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
    .ftm-toast-filename { font-size: 11px; font-weight: 450; color: #6b6b76; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: #f7f7f8; padding: 5px 8px; border-radius: 6px; border: 1px solid #e8e8ec; font-family: 'SF Mono', monospace; }
    @media (prefers-color-scheme: dark) { .ftm-toast-filename { background: #111113; border-color: #2a2a2e; color: #8e8e9a; } }
    .ftm-toast-hint { font-size: 10px; color: #9d9da8; }
    .ftm-toast-progress { height: 2px; background: #e8e8ec; border-radius: 1px; overflow: hidden; position: relative; margin-bottom: 12px; }
    @media (prefers-color-scheme: dark) { .ftm-toast-progress { background: #2a2a2e; } }
    .ftm-toast-progress-bar { height: 100%; width: 100%; background: #4f6ef7; border-radius: 1px; transition: width 0.1s linear; transform-origin: left; }
    .ftm-toast-timer { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); font-size: 9px; color: #4f6ef7; font-weight: 500; }
    .ftm-toast-actions { display: flex; gap: 6px; justify-content: flex-end; }
    .ftm-btn { font-family: inherit; font-size: 12px; font-weight: 500; padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; transition: all 0.15s; outline: none; }
    .ftm-btn-approve { background: #1a1a1e; color: #fff; }
    .ftm-btn-approve:hover { opacity: 0.85; }
    .ftm-btn-deny { background: transparent; color: #6b6b76; }
    .ftm-btn-deny:hover { color: #1a1a1e; }
    @media (prefers-color-scheme: dark) { .ftm-btn-approve { background: #ededf0; color: #111113; } .ftm-btn-deny { color: #8e8e9a; } .ftm-btn-deny:hover { color: #ededf0; } }
  `;
};

FTM.destroyToast = function () {
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
      timerEl.textContent = s > 0 ? s + 's' : '';
    }
    if (remaining <= 0) { clearInterval(countdownTimer); countdownTimer = null; FTM.onDeny(); }
  }, 50);
};
