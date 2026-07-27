// ===========================================================================
// content/intercept.js — Drop / file-input interception and re-dispatch
// ===========================================================================
// A pending interception is an immutable Session object, so a second drop can
// no longer clobber the in-flight one, and every original file is preserved
// (previously multi-file uploads silently lost everything but the first file).
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  let current = null;
  let reDispatching = 0;

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

  // The guard is a counter, not a boolean, and is cleared on a macrotask so
  // synchronously re-entrant page handlers cannot re-trigger interception.
  function reDispatch(target, files) {
    if (!files.length) return;
    reDispatching++;
    try {
      if (target.kind === 'drop') dispatchDrop(target.event, files);
      else setInputFiles(target.input, files);
    } catch (_) {
    } finally {
      setTimeout(() => { reDispatching = Math.max(0, reDispatching - 1); }, 0);
    }
  }

  async function convert(session) {
    const file = session.file;
    const ext = FTM.text.getExtension(file.name).toLowerCase();
    if (FTM.router.needsOffscreen(ext)) toast.processing();
    let markdown = FTM.postprocess.apply(await FTM.router.convert(file, ext));
    if (FTM.config.yamlFrontmatter) markdown = FTM.postprocess.injectFrontmatter(markdown, file);
    FTM.history.record(file.name, file.size, ext, new Blob([markdown]).size);
    return new File([markdown], FTM.text.stem(file.name) + '.md', { type: 'text/markdown;charset=utf-8', lastModified: Date.now() });
  }

  async function approve() {
    const session = current;
    if (!session || session.busy) return;
    session.busy = true;
    try {
      const converted = await convert(session);
      toast.hide();
      reDispatch(session.target, [converted, ...session.extras]);
    } catch (err) {
      toast.hide();
      FTM.showError(session.file.name, (err && err.message) || 'Unknown error');
      reDispatch(session.target, session.files);
    } finally {
      if (current === session) current = null;
    }
  }

  function deny() {
    const session = current;
    if (!session || session.busy) return;
    current = null;
    toast.hide();
    reDispatch(session.target, session.files);
  }

  const toast = new FTM.Toast({ approve: () => approve(), deny: () => deny() });

  function onKeydown(event) {
    if (!current || current.busy || !toast.visible) return;
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter') approve(); else deny();
  }

  function begin(files, target) {
    current = new Session(files, target);
    if (FTM.config.autoConvert) { approve(); return; }
    toast.show(current.file, current.extras.length);
    toast.startCountdown(FTM.config.autoDismissSeconds, () => deny());
  }

  function eligible(files) {
    if (!files || files.length === 0) return false;
    if (current && current.busy) return false;
    if (reDispatching > 0 || !FTM.config.enabled || !FTM.activation.shouldActivate()) return false;
    return FTM.activation.shouldInterceptFile(files[0]);
  }

  function onDrop(event) {
    const dt = event.dataTransfer;
    if (!dt || !eligible(dt.files)) return;
    event.preventDefault();
    event.stopPropagation();
    begin([...dt.files], { kind: 'drop', event });
  }

  function onChange(event) {
    const input = event.target;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'file') return;
    if (!eligible(input.files)) return;
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
    await FTM.loadConfig();
    if (!FTM.config.enabled) return;
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('keydown', onKeydown, true);
    self.addEventListener('pagehide', cleanup);
  }

  FTM.intercept = { approve, deny, init };
  init();
})();
