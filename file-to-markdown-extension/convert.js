// convert.js — manual, policy-neutral conversion workspace
// ===========================================================================

'use strict';

(() => {
  const FTM = self.FTM;
  const MAX_QUEUE = FTM.CONSTANTS.MAX_QUEUE_FILES || 12;
  const jobs = [];
  let running = false;
  let activeJob = null;

  const $ = (id) => document.getElementById(id);
  const fileInput = $('file-input');
  const dropzone = $('dropzone');
  const queueNode = $('queue');
  const statusNode = $('status');
  const errorNode = $('error');

  function text(node, value) { node.textContent = value; }
  function extensionOf(name) {
    const match = /(?:^|\.)([^.]+)$/.exec(String(name || '').toLowerCase());
    return match ? '.' + match[1] : '';
  }
  function formatBytes(bytes) { return FTM.text.formatBytes(bytes); }
  function supported(file) { return FTM.MANUAL_EXTENSIONS.has(extensionOf(file.name)) && file.size <= FTM.CONSTANTS.MAX_FILE_SIZE_BYTES; }
  function parserMeta(file, ext) {
    const threshold = Number(FTM.config.csvStreamThreshold) || FTM.CONSTANTS.CSV_STREAM_THRESHOLD_MB_DEFAULT;
    return { fileName: file.name, imageMode: FTM.config.imageMode, extension: ext,
      streaming: ext === '.csv' && file.size >= threshold * FTM.CONSTANTS.MB };
  }

  async function convertFile(file, ext) {
    if (FTM.OFFSCREEN_EXTENSIONS.has(ext)) {
      const parser = FTM.parsers && FTM.parsers[ext];
      if (!parser) throw new Error('No local parser is available for ' + ext + '.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      return parser(bytes, parserMeta(file, ext));
    }
    if (FTM.RTF_EXTENSION.has(ext)) return FTM.converters.rtf(file);
    return FTM.converters.text(file, ext);
  }
  function statusLabel(job) {
    if (job.error) return 'Failed';
    if (job.url) return 'Ready';
    if (job.running) return 'Converting…';
    return 'Waiting';
  }
  function showError(message) {
    text(errorNode, message || 'Conversion failed.');
    errorNode.hidden = !message;
  }
  function setStatus(message) { text(statusNode, message); }
  function releaseUrl(job) {
    if (job.url) { URL.revokeObjectURL(job.url); job.url = ''; }
  }

  function makeButton(label, className, handler) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = className; text(button, label); button.addEventListener('click', handler);
    return button;
  }

  const rowById = new Map();

  function createJobRow() {
    const row = document.createElement('article'); row.className = 'job';
    const main = document.createElement('div'); main.className = 'job-main';
    const name = document.createElement('p'); name.className = 'job-name'; main.appendChild(name);
    const meta = document.createElement('p'); meta.className = 'job-meta'; main.appendChild(meta);
    const state = document.createElement('p'); state.className = 'job-state'; main.appendChild(state);
    const actions = document.createElement('div'); actions.className = 'job-actions';
    row.append(main, actions);
    return { row, name, meta, state, actions };
  }

  function updateJobRow(elements, job) {
    elements.name.textContent = job.file.name;
    elements.meta.textContent = formatBytes(job.file.size) + ' · ' + extensionOf(job.file.name);
    elements.state.textContent = statusLabel(job);
    const actions = elements.actions; actions.replaceChildren();
    if (job.url) {
      const download = document.createElement('a'); download.className = 'download'; download.href = job.url; download.download = job.outputName; download.draggable = true; text(download, 'Download / drag');
      download.addEventListener('dragstart', (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('DownloadURL', 'text/markdown:' + job.outputName + ':' + job.url);
        event.dataTransfer.setData('text/uri-list', job.url);
        event.dataTransfer.setData('text/plain', job.outputName);
      });
      actions.appendChild(download);
    } else if (job.running) actions.appendChild(makeButton('Cancel', 'cancel', () => cancelJob(job)));
    else actions.appendChild(makeButton('Remove', 'cancel', () => removeJob(job)));
  }

  function render() {
    if (!jobs.length) {
      rowById.clear();
      const empty = document.createElement('p'); empty.className = 'empty'; text(empty, 'No files selected yet.'); queueNode.replaceChildren(empty); return;
    }
    const fragment = document.createDocumentFragment();
    const activeIds = new Set();
    for (const job of jobs) {
      const elements = rowById.get(job.id) || createJobRow();
      rowById.set(job.id, elements); activeIds.add(job.id); updateJobRow(elements, job); fragment.appendChild(elements.row);
    }
    for (const id of rowById.keys()) if (!activeIds.has(id)) rowById.delete(id);
    queueNode.replaceChildren(fragment);
  }

  function removeJob(job) {
    if (job === activeJob) return;
    const index = jobs.indexOf(job); if (index >= 0) jobs.splice(index, 1); releaseUrl(job); render();
  }

  function cancelJob(job) {
    job.cancelled = true;
    if (job.controller && typeof job.controller.cancel === 'function') job.controller.cancel();
    if (job === activeJob) setStatus('Cancelling ' + job.file.name + '…');
    render();
  }

  function clearJobs() {
    for (const job of jobs) { if (job.controller) job.controller.cancel?.(); releaseUrl(job); }
    jobs.length = 0; activeJob = null; running = false; showError(''); setStatus('Ready for a local file.'); render();
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    let rejected = 0;
    for (const file of incoming) {
      if (jobs.length >= MAX_QUEUE || !supported(file)) { rejected++; continue; }
      if (jobs.some((job) => job.file.name === file.name && job.file.size === file.size && job.file.lastModified === file.lastModified)) continue;
      jobs.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(), file, running: false, cancelled: false, url: '', outputName: FTM.text.stem(file.name) + '.md' });
    }
    if (rejected) showError('Some files were skipped. Choose a supported format and keep the queue under ' + MAX_QUEUE + ' files.');
    else showError('');
    render(); processQueue();
  }

  async function convertJob(job) {
    job.running = true; activeJob = job; render(); setStatus('Converting ' + job.file.name + ' locally…');
    try {
      const ext = extensionOf(job.file.name);
      let markdown = await convertFile(job.file, ext);
      if (job.cancelled) throw new Error('Conversion cancelled.');
      markdown = FTM.postprocess.apply(markdown);
      if (FTM.config.yamlFrontmatter) markdown = FTM.postprocess.injectFrontmatter(markdown, job.file);
      if (markdown.length > FTM.CONSTANTS.MAX_OUTPUT_BYTES) throw new Error('Output exceeded the safe Markdown limit.');
      job.url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
      job.running = false; job.outputName = FTM.text.stem(job.file.name) + '.md';
      FTM.history.record(job.file.name, job.file.size, ext, markdown.length);
      setStatus('Ready: ' + job.outputName + '. Download it or drag the result handle into a destination that accepts file drops.');
    } catch (error) {
      job.running = false; job.error = error && error.message ? error.message : 'Conversion failed.';
      if (!job.cancelled) showError(job.error); setStatus(job.cancelled ? 'Conversion cancelled.' : 'Conversion failed.');
    } finally { activeJob = null; render(); }
  }

  async function processQueue() {
    if (running) return; running = true;
    try {
      for (const job of jobs) {
        if (job.url || job.error || job.cancelled) continue;
        await convertJob(job);
      }
    } finally {
      running = false;
      await FTM.history.flush();
    }
  }

  $('choose-button').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  dropzone.addEventListener('click', (event) => { if (event.target !== $('choose-button')) fileInput.click(); });
  dropzone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } });
  for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.add('is-over'); });
  for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.remove('is-over'); });
  dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer && event.dataTransfer.files));
  $('clear-button').addEventListener('click', clearJobs);
  addEventListener('beforeunload', () => jobs.forEach(releaseUrl));

  (async () => {
    try { await FTM.loadConfig(); } catch (_) { showError('Settings could not be loaded; safe defaults are active.'); }
    render();
  })();
})();
