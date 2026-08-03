// ===========================================================================
// content/intercept.js — Drop / file-input interception and re-dispatch
// ===========================================================================
// A pending interception is an immutable Session object, so a second drop can
// no longer clobber the in-flight one, and every original file is preserved
// (previously multi-file uploads silently lost everything but the first file).
//
// Content-type sniffing: files with .md/.txt extensions but binary content
// (DOCX, PDF, etc.) are detected via magic bytes and offered for conversion.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  let current = null;
  let reDispatching = 0;
  const handledEvents = new WeakSet();

  class Session {
    constructor(files, target) {
      this.files = files;
      this.target = target;
      this.busy = false;
    }

    get file() { return this.files[0]; }

    get extras() { return this.files.slice(1); }
  }

  function dataTransferOf(files) {
    const dt = new DataTransfer();
    for (const file of files) dt.items.add(file);
    return dt;
  }

  function dispatchDrop(event, files) {
    const dt = dataTransferOf(files);
    const init = { bubbles: true, cancelable: true, composed: true, clientX: event.clientX, clientY: event.clientY };
    event.target.dispatchEvent(new DragEvent('drop', { ...init, dataTransfer: dt }));
    event.target.dispatchEvent(new DragEvent('dragend', init));
  }

  function setInputFiles(input, files) {
    const dt = dataTransferOf(files);
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (desc && desc.set) desc.set.call(input, dt.files); else input.files = dt.files;
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (value && value.set) try { value.set.call(input, 'C:\\fakepath\\' + files[0].name); } catch (_) {}
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
  }

  // ── Multi-strategy file injection ───────────────────────────────────
  // Strategy 1: DataTransfer API (standard)
  // Strategy 2: Direct property override on input element
  // Strategy 3: Clipboard write + paste prompt (last resort)

  function injectViaDataTransfer(target, files) {
    if (target.kind === 'drop') {
      dispatchDrop(target.event, files);
    } else {
      setInputFiles(target.input, files);
    }
  }

  function injectViaProperty(target, files) {
    if (target.kind !== 'input') return false;
    const input = target.input;
    try {
      const dt = dataTransferOf(files);
      // Try direct property write (works on some sites).
      Object.defineProperty(input, 'files', { value: dt.files, writable: true, configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function injectViaClipboard(target, files) {
    try {
      if (typeof self.confirm !== 'function' || !self.confirm('FTM Studio could not attach the converted file. Copy the Markdown to your clipboard instead?')) return false;
      if (!self.navigator.clipboard || typeof self.navigator.clipboard.writeText !== 'function') return false;
      const text = await files[0].text();
      await self.navigator.clipboard.writeText(text);
      FTM.showNotice('Converted markdown copied to clipboard — paste it into the chat.');
      return true;
    } catch (_) {
      return false;
    }
  }

  async function reDispatch(target, files) {
    if (!files.length) return;
    reDispatching++;
    try {
      // Strategy 1: Standard DataTransfer injection.
      injectViaDataTransfer(target, files);
    } catch (_) {
      try {
        // Strategy 2: Direct property override.
        if (!injectViaProperty(target, files)) {
          // Strategy 3: Clipboard fallback.
          await injectViaClipboard(target, files);
        }
      } catch (_) {}
    } finally {
      setTimeout(() => { reDispatching = Math.max(0, reDispatching - 1); }, 0);
    }
  }

  // ── Content-type sniffing ────────────────────────────────────────────
  // Read the first few bytes and check for known magic signatures.
  // Returns the real format (e.g. '.docx', '.pdf') or null if text/unknown.
  async function sniffRealType(file) {
    try {
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const sig = FTM.text.magicSignature(head);
      if (!sig) return null;
      // Map signature name to extension.
      if (sig.includes('ZIP') || sig.includes('DOCX') || sig.includes('XLSX') || sig.includes('PPTX')) {
        // Could be DOCX, XLSX, PPTX, or EPUB — all are ZIP-based.
        // Try to determine from extension, default to .docx.
        const ext = FTM.text.getExtension(file.name).toLowerCase();
        if (['.xlsx', '.xls'].includes(ext)) return '.xlsx';
        if (ext === '.pptx') return '.pptx';
        if (ext === '.epub') return '.epub';
        return '.docx'; // default for ZIP-based
      }
      if (sig.includes('PDF')) return '.pdf';
      if (sig.includes('OLE2')) return '.docx'; // legacy DOC/XLS
      if (sig.includes('RTF')) return '.rtf';
      return null;
    } catch (_) {
      return null;
    }
  }

  // ── Polyglot defense: structural validation beyond magic bytes ─────
  // A polyglot file has valid magic bytes for one format but contains
  // malicious content for another. Validate file structure after magic
  // byte check to catch these.
  async function validateStructure(file, ext) {
    try {
      if (ext === '.pdf') {
        // PDF must end with %%EOF marker.
        const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 64)).arrayBuffer());
        const tailStr = String.fromCharCode.apply(null, tail);
        if (!tailStr.includes('%%EOF')) return false;
      }
      if (ext === '.docx' || ext === '.xlsx' || ext === '.pptx' || ext === '.epub') {
        // ZIP-based: read central directory to verify it's a valid ZIP.
        // Check for PK\x05\x06 (end of central directory) signature.
        const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 22)).arrayBuffer());
        let found = false;
        for (let i = 0; i <= tail.length - 4; i++) {
          if (tail[i] === 0x50 && tail[i+1] === 0x4B && tail[i+2] === 0x05 && tail[i+3] === 0x06) {
            found = true; break;
          }
        }
        if (!found) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Determine the effective extension for a file.
  // If the file has a text extension (.md, .txt, .html) but binary content,
  // return the real binary type instead.
  async function effectiveExtension(file) {
    const ext = FTM.text.getExtension(file.name).toLowerCase();
    const TEXT_EXTS = new Set(['.md', '.txt', '.html', '.htm', '.csv', '.json', '.xml']);
    if (TEXT_EXTS.has(ext)) {
      const real = await sniffRealType(file);
      if (real) return real;
    }
    return ext;
  }

  async function convertFile(file, effectiveExt) {
    const ext = effectiveExt || FTM.text.getExtension(file.name).toLowerCase();
    // Polyglot defense: validate file structure after magic byte detection.
    if (['.pdf', '.docx', '.xlsx', '.pptx', '.epub'].includes(ext)) {
      const valid = await validateStructure(file, ext);
      if (!valid) throw new Error('File structure validation failed — possible polyglot or corrupted file.');
    }
    let markdown = FTM.postprocess.apply(await FTM.router.convert(file, ext));
    if (FTM.config.yamlFrontmatter) markdown = FTM.postprocess.injectFrontmatter(markdown, file);
    FTM.history.record(file.name, file.size, ext, new Blob([markdown]).size);
    const mimeType = FTM.config.preserveOriginalMime && file.type ? file.type : 'text/markdown;charset=utf-8';
    return new File([markdown], FTM.text.stem(file.name) + '.md', { type: mimeType, lastModified: Date.now() });
  }

  async function convertAll(session) {
    const results = [];
    for (const file of session.files) {
      const ext = FTM.text.getExtension(file.name).toLowerCase();
      const realExt = await effectiveExtension(file);
      const conversionExt = realExt !== ext ? realExt : ext;
      const category = FTM.EXTENSION_MAP[conversionExt];
      const enabled = category && FTM.config.categories && FTM.config.categories[category];
      results.push(enabled ? await convertFile(file, conversionExt === ext ? undefined : conversionExt) : file);
    }
    return results;
  }

  async function approve() {
    const session = current;
    if (!session || session.busy) return;
    session.busy = true;
    const needsOffscreen = session.files.some((f) =>
      FTM.router.needsOffscreen(FTM.text.getExtension(f.name).toLowerCase()));
    if (needsOffscreen) toast.processing();
    try {
      const converted = await convertAll(session);
      toast.hide();
      reDispatch(session.target, converted);
    } catch (err) {
      toast.hide();
      FTM.showError(session.file.name, (err && err.message) || 'Unknown error');
      reDispatch(session.target, session.files);
    } finally {
      if (current === session) current = null;
    }
  }

  function deny(isAutoSkip) {
    const session = current;
    if (!session || session.busy) return;
    current = null;
    toast.hide();
    if (!isAutoSkip) reDispatch(session.target, session.files);
  }

  const toast = new FTM.Toast({ approve: () => approve(), deny: (isAutoSkip) => deny(isAutoSkip) });
  let isAlreadyMarkdown = false;

  function onKeydown(event) {
    if (!current || current.busy || !toast.visible) return;
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (isAlreadyMarkdown) { deny(); return; }
    if (event.key === 'Enter') approve(); else deny();
  }

  async function sniffSession(session) {
    session.busy = true;
    try { return await effectiveExtension(session.file); } catch (_) { return null; }
    finally { session.busy = false; }
  }

  function showSession(session, ext, realExt) {
    const isDisguisedBinary = realExt !== null && realExt !== ext;
    if (ext === '.md' && !isDisguisedBinary) {
      isAlreadyMarkdown = true;
      toast.showAlreadyMarkdown(session.file);
      return;
    }
    isAlreadyMarkdown = false;
    FTM._sniffedExt = isDisguisedBinary ? realExt : null;
    if (FTM.config.autoConvert) { approve(); return; }
    toast.show(session.file, session.extras.length);
    toast.startCountdown(FTM.config.autoDismissSeconds, () => deny(true));
  }

  async function begin(files, target) {
    const session = new Session(files, target);
    current = session;
    const ext = FTM.text.getExtension(session.file.name).toLowerCase();
    const realExt = await sniffSession(session);
    if (current !== session) return;
    showSession(session, ext, realExt);
  }

  function eligible(files) {
    if (!files || files.length === 0) return false;
    if (current && current.busy) return false;
    if (reDispatching > 0 || !FTM.config.enabled || !FTM.activation.shouldActivate()) return false;
    for (const file of files) {
      if (FTM.activation.shouldInterceptFile(file)) return true;
      // Also check if a text-extension file has binary content.
      const ext = FTM.text.getExtension(file.name).toLowerCase();
      if (['.md', '.txt', '.html'].includes(ext) && file.size > 100) return true;
    }
    return false;
  }

  function onDrop(event) {
    if (handledEvents.has(event)) return;
    const dt = event.dataTransfer;
    if (!dt || !eligible(dt.files)) return;
    handledEvents.add(event);
    event.preventDefault();
    event.stopPropagation();
    begin([...dt.files], { kind: 'drop', event });
  }

  function onChange(event) {
    if (handledEvents.has(event)) return;
    const input = event.target;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'file') return;
    if (!eligible(input.files)) return;
    handledEvents.add(event);
    event.preventDefault();
    event.stopPropagation();
    begin([...input.files], { kind: 'input', input });
  }

  function cleanup() {
    if (current && current.busy) return;
    current = null;
    FTM.history.flush();
    toast.destroy();
  }

  async function init() {
    try {
      await FTM.loadConfig();
    } catch (err) {
      // Config load failed — show visible error instead of silent disable.
      console.warn('[FTM Studio] Config load failed, using defaults:', err);
      try {
        FTM.config = FTM.configUtils.defaults({});
        FTM.showError('FTM Studio', 'Settings corrupted — using defaults. Open popup to reset.');
      } catch (_) {}
      return;
    }
    if (!FTM.config.enabled) return;
    // Listen at both capture and bubble phase to handle React 18
    // synthetic events that may swallow capture-phase interception.
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('drop', onDrop, false);
    document.addEventListener('change', onChange, true);
    document.addEventListener('change', onChange, false);
    document.addEventListener('keydown', onKeydown, true);
    self.addEventListener('pagehide', cleanup);
  }

  FTM.intercept = { approve, deny, init };
  init();
})();
