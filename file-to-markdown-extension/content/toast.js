// ===========================================================================
// content/toast.js — Shadow DOM prompt / progress / error UI
// ===========================================================================
// FIX Perf #9: toastStyles() CSS string computed once at module load and
//   cached. Previously regenerated a 4 KB template literal on every create().
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  const FILE_TYPE_META = {
    '.pdf': { label: 'PDF', color: '#d93025' }, '.docx': { label: 'DOCX', color: '#1a73e8' },
    '.xlsx': { label: 'XLSX', color: '#1e8e3e' }, '.xls': { label: 'XLS', color: '#1e8e3e' },
    '.csv': { label: 'CSV', color: '#1e8e3e' }, '.pptx': { label: 'PPTX', color: '#e8710a' },
    '.epub': { label: 'EPUB', color: '#9334e6' }, '.rtf': { label: 'RTF', color: '#1a73e8' },
    '.txt': { label: 'TXT', color: '#5f6368' }, '.md': { label: 'MD', color: '#5f6368' },
    '.py': { label: 'PY', color: '#3572A5' }, '.js': { label: 'JS', color: '#f7df1e' },
    '.json': { label: 'JSON', color: '#5f6368' }, '.html': { label: 'HTML', color: '#e34c26' },
    '.css': { label: 'CSS', color: '#563d7c' }, '.xml': { label: 'XML', color: '#5f6368' },
    '.cpp': { label: 'C++', color: '#f34b7d' }, '.png': { label: 'PNG', color: '#1a73e8' },
    '.jpg': { label: 'JPG', color: '#1a73e8' }, '.jpeg': { label: 'JPEG', color: '#1a73e8' },
    '.gif': { label: 'GIF', color: '#1a73e8' }, '.webp': { label: 'WEBP', color: '#1a73e8' },
    '.svg': { label: 'SVG', color: '#1a73e8' }
  };

  const ICON_PARTS = [
    ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
    ['polyline', { points: '14 2 14 8 20 8' }],
    ['line', { x1: '16', y1: '13', x2: '8', y2: '13' }],
    ['line', { x1: '16', y1: '17', x2: '8', y2: '17' }],
    ['polyline', { points: '10 9 9 9 8 9' }]
  ];

  // FIX Perf #9: Compute CSS once at module load.
  const CACHED_STYLES = `
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
    .ftm-toast-title { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
    .ftm-toast-body { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
    .ftm-file-info { display: flex; align-items: center; gap: 8px; }
    .ftm-file-badge {
      font-size: 9px; font-weight: 700; letter-spacing: 0.03em; padding: 2px 6px;
      border-radius: 4px; flex-shrink: 0; text-transform: uppercase;
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
    }
    .ftm-toast-filename {
      font-size: 11px; color: #6b6b76; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
      flex: 1; min-width: 0;
    }
    @media (prefers-color-scheme: dark) { .ftm-toast-filename { color: #8e8e9a; } }
    .ftm-size-indicator { font-size: 10px; font-weight: 500; color: #5f6368; flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .ftm-size-medium { color: #e8710a; }
    .ftm-size-large { color: #d93025; font-weight: 600; }
    @media (prefers-color-scheme: dark) {
      .ftm-size-indicator { color: #9aa0a6; }
      .ftm-size-medium { color: #fbbc04; }
      .ftm-size-large { color: #f28b82; }
    }
    .ftm-toast-hint { font-size: 10px; color: #9d9da8; display: flex; align-items: center; gap: 6px; }
    .ftm-spinner {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid #e8e8ec; border-top-color: #1a73e8;
      border-radius: 50%; animation: ftm-spin 0.6s linear infinite;
    }
    @media (prefers-color-scheme: dark) { .ftm-spinner { border-color: #2a2a2e; border-top-color: #8ab4f8; } }
    @keyframes ftm-spin { to { transform: rotate(360deg); } }
    .ftm-toast-progress { height: 2px; background: #e8e8ec; border-radius: 1px; overflow: hidden; position: relative; margin-bottom: 12px; }
    @media (prefers-color-scheme: dark) { .ftm-toast-progress { background: #2a2a2e; } }
    .ftm-toast-progress-bar { height: 100%; width: 100%; background: #1a73e8; border-radius: 1px; transform-origin: left; will-change: transform; }
    @media (prefers-color-scheme: dark) { .ftm-toast-progress-bar { background: #8ab4f8; } }
    @keyframes ftm-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    .ftm-toast-timer { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); font-size: 9px; color: #1a73e8; font-weight: 500; }
    @media (prefers-color-scheme: dark) { .ftm-toast-timer { color: #8ab4f8; } }
    .ftm-toast-actions { display: flex; gap: 6px; justify-content: flex-end; }
    .ftm-btn { font-family: inherit; font-size: 12px; font-weight: 500; padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; transition: all 0.15s; outline: none; }
    .ftm-btn-approve { background: #1a1a1e; color: #fff; }
    .ftm-btn-approve:hover { opacity: 0.85; }
    .ftm-btn-deny { background: transparent; color: #6b6b76; }
    .ftm-btn-deny:hover { color: #1a1a1e; }
    @media (prefers-color-scheme: dark) {
      .ftm-btn-approve { background: #ededf0; color: #111113; }
      .ftm-btn-deny { color: #8e8e9a; }
      .ftm-btn-deny:hover { color: #ededf0; }
    }
    .ftm-error-title { font-size: 12px; font-weight: 600; color: #d93025; margin-bottom: 4px; }
    .ftm-error-msg { font-size: 10px; color: #9d9da8; word-break: break-word; margin-bottom: 8px; }
  `;

  function meta(fileName) {
    const ext = FTM.text.getExtension(fileName).toLowerCase();
    return FILE_TYPE_META[ext] || { label: ext.replace('.', '').toUpperCase() || 'FILE', color: '#5f6368' };
  }

  function sizeClass(bytes) {
    const MB = FTM.CONSTANTS.MB;
    if (bytes < 100 * FTM.CONSTANTS.KB) return '';
    if (bytes < MB) return ' ftm-size-small';
    if (bytes < 10 * MB) return ' ftm-size-medium';
    return ' ftm-size-large';
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries({ class: 'ftm-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' })) svg.setAttribute(k, v);
    for (const [tag, attrs] of ICON_PARTS) {
      const part = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, v);
      svg.appendChild(part);
    }
    return svg;
  }

  class Toast {
    constructor(handlers) {
      this.handlers = handlers;
      this.host = null;
      this.root = null;
      this.expiry = null;
      this.nodes = {};
    }

    get visible() { return !!this.host; }

    create() {
      if (this.host) return;
      this.host = el('div');
      this.host.id = 'ftm-toast-host';
      this.host.setAttribute('role', 'alert');
      this.host.setAttribute('aria-live', 'polite');
      this.host.setAttribute('aria-label', 'FTM Studio file conversion');
      this.host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:auto;opacity:0;transform:translateX(120%);transition:opacity .35s cubic-bezier(.4,0,.2,1),transform .45s cubic-bezier(.4,0,.2,1);';
      document.documentElement.appendChild(this.host);
      // Open shadow DOM for screen reader accessibility.
      this.root = this.host.attachShadow({ mode: 'open' });
      this.root.appendChild(el('style')).textContent = CACHED_STYLES;
      this.root.appendChild(this.build());
    }

    build() {
      const n = this.nodes;
      const container = el('div', 'ftm-toast');
      const header = el('div', 'ftm-toast-header');
      header.append(icon(), el('span', 'ftm-toast-title', 'Convert to Markdown?'));
      n.badge = el('span', 'ftm-file-badge');
      n.name = el('span', 'ftm-toast-filename');
      n.size = el('span', 'ftm-size-indicator');
      const info = el('div', 'ftm-file-info');
      info.append(n.badge, n.name, n.size);
      n.hint = el('span', 'ftm-toast-hint');
      const body = el('div', 'ftm-toast-body');
      body.append(info, n.hint);
      container.append(header, body, this.buildProgress(), this.buildActions());
      return container;
    }

    buildProgress() {
      this.nodes.bar = el('div', 'ftm-toast-progress-bar');
      this.nodes.timer = el('span', 'ftm-toast-timer');
      const progress = el('div', 'ftm-toast-progress');
      progress.append(this.nodes.bar, this.nodes.timer);
      return progress;
    }

    buildActions() {
      const n = this.nodes;
      n.approve = el('button', 'ftm-btn ftm-btn-approve', 'Convert');
      n.deny = el('button', 'ftm-btn ftm-btn-deny', 'Skip');
      n.approve.addEventListener('click', () => this.handlers.approve());
      n.deny.addEventListener('click', () => this.handlers.deny());
      const actions = el('div', 'ftm-toast-actions');
      actions.append(n.approve, n.deny);
      return actions;
    }

    show(file, extraCount) {
      this.create();
      const n = this.nodes;
      // Use sniffed extension if available (for .md files with binary content).
      const displayExt = (FTM._sniffedExt && FTM._sniffedExt !== FTM.text.getExtension(file.name).toLowerCase())
        ? FTM._sniffedExt : null;
      const info = displayExt ? FILE_TYPE_META[displayExt] || meta(file.name) : meta(file.name);
      n.badge.textContent = displayExt ? info.label + ' in .md' : info.label;
      n.badge.style.cssText = 'background:' + info.color + ';color:#fff'; n.name.textContent = file.name;
      n.size.textContent = FTM.text.formatBytes(file.size); n.size.className = 'ftm-size-indicator' + sizeClass(file.size);
      const sizeHint = file.size > 500 * 1024 ? ' (' + FTM.text.formatBytes(file.size) + ')' : '';
      n.hint.textContent = extraCount > 0
        ? 'Enter = convert \u00B7 Esc = skip \u00B7 +' + extraCount + ' more file' + (extraCount > 1 ? 's' : '') + ' kept as-is' + sizeHint
        : 'Enter = convert \u00B7 Esc = skip' + sizeHint;
      n.approve.disabled = false; n.approve.textContent = 'Convert'; n.approve.style.opacity = '';
      n.deny.disabled = false; n.deny.style.opacity = '';
      this.resetBar();
      void this.host.offsetHeight;
      this.host.style.opacity = '1';
      this.host.style.transform = 'translateX(0)';
      // Auto-focus Convert button for keyboard accessibility.
      setTimeout(() => { try { n.approve.focus(); } catch (_) {} }, 500);
    }

    showAlreadyMarkdown(file) {
      this.create();
      const n = this.nodes;
      const info = meta(file.name);
      n.badge.textContent = info.label;
      n.badge.style.cssText = 'background:' + info.color + ';color:#fff';
      n.name.textContent = file.name;
      n.size.textContent = FTM.text.formatBytes(file.size);
      n.size.className = 'ftm-size-indicator' + sizeClass(file.size);
      n.hint.textContent = 'This file is already Markdown — no conversion needed';
      n.bar.style.display = 'none';
      n.timer.style.display = 'none';
      n.approve.style.display = 'none';
      n.deny.textContent = 'OK';
      n.deny.className = 'ftm-btn ftm-btn-approve';
      n.deny.disabled = false;
      n.deny.style.opacity = '';
      void this.host.offsetHeight;
      this.host.style.opacity = '1';
      this.host.style.transform = 'translateX(0)';
    }

    resetBar() {
      this.nodes.bar.style.animation = 'none';
      this.nodes.bar.style.transform = 'scaleX(1)';
      this.nodes.timer.textContent = '';
    }

    startCountdown(seconds, onExpire) {
      if (!this.root || !(seconds > 0)) { if (this.nodes.timer) this.nodes.timer.textContent = '\u221E'; return; }
      const bar = this.nodes.bar;
      bar.style.transform = '';
      bar.style.animation = 'ftm-drain ' + seconds + 's linear forwards';
      this.nodes.timer.textContent = 'Auto-skip in ' + seconds + 's';
      this.clearExpiry();
      this.expiry = setTimeout(onExpire, seconds * 1000);
    }

    clearExpiry() {
      if (this.expiry) { clearTimeout(this.expiry); this.expiry = null; }
    }

    processing() {
      if (!this.root) return;
      const n = this.nodes;
      this.clearExpiry();
      this.resetBar();
      n.hint.textContent = '';
      n.hint.append(el('span', 'ftm-spinner'), el('span', null, 'Converting\u2026'));
      n.approve.disabled = true;
      n.approve.textContent = 'Converting\u2026';
      n.approve.style.opacity = '0.6';
      n.deny.disabled = true;
      n.deny.style.opacity = '0.4';
    }

    hide() {
      this.clearExpiry();
      if (!this.host) return;
      const n = this.nodes;
      n.bar.style.display = '';
      n.timer.style.display = '';
      n.approve.style.display = '';
      n.deny.textContent = 'Skip';
      n.deny.className = 'ftm-btn ftm-btn-deny';
      this.host.style.opacity = '0';
      this.host.style.transform = 'translateX(120%)';
    }

    destroy() {
      this.hide();
      if (!this.host) return;
      const host = this.host;
      setTimeout(() => { if (host.parentNode) host.parentNode.removeChild(host); }, 500);
      this.host = null;
      this.root = null;
      this.nodes = {};
    }
  }

  class ErrorToast {
    constructor(fileName, message) {
      this.host = el('div');
      this.host.id = 'ftm-error-toast';
      this.host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:auto;opacity:0;transition:opacity .3s;';
      this.root = this.host.attachShadow({ mode: 'closed' });
      this.root.appendChild(el('style')).textContent = CACHED_STYLES;
      this.root.appendChild(this.build(fileName, message));
    }

    build(fileName, message) {
      const wrapper = el('div', 'ftm-toast');
      const dismiss = el('button', 'ftm-btn ftm-btn-deny', 'Dismiss');
      dismiss.addEventListener('click', () => this.close());
      wrapper.append(
        el('div', 'ftm-error-title', '\u26A0 Conversion Failed'),
        el('div', 'ftm-toast-filename', fileName),
        el('div', 'ftm-error-msg', message),
        dismiss
      );
      return wrapper;
    }

    open() {
      document.documentElement.appendChild(this.host);
      void this.host.offsetHeight;
      this.host.style.opacity = '1';
      this.timer = setTimeout(() => this.close(), 8000);
      return this;
    }

    close() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.host.style.opacity = '0';
      setTimeout(() => { if (this.host.parentNode) this.host.parentNode.removeChild(this.host); }, 400);
    }
  }

  FTM.Toast = Toast;
  FTM.showError = function showError(fileName, message) {
    try { return new ErrorToast(fileName, message).open(); } catch (_) { return null; }
  };

  // FIX Perf #9: Return the pre-computed cached string.
  FTM.toastStyles = function toastStyles() { return CACHED_STYLES; };
})();
