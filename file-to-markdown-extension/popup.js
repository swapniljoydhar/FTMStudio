// popup.js — compact settings and history controller

'use strict';

(() => {
  const FTM = self.FTM;
  const API = self.FTM_BROWSER;
  const configKeys = ['enabled', 'yamlFrontmatter', 'stripTrailingWhitespace', 'enforceHeadingHierarchy'];
  const categoryLabels = {
    documents: ['Documents', 'DOCX, TXT, MD, RTF'],
    pdf: ['PDF', 'Page extraction with bounded OCR fallback'],
    spreadsheets: ['Spreadsheets', 'CSV, XLSX, XLS'],
    code: ['Source code', 'Python, JavaScript, C++, CSS, JSON, XML'],
    markup: ['Markup', 'HTML documents']
  };
  let config = FTM.configUtils.defaults({});
  let saveTimer = null;

  const $ = (id) => document.getElementById(id);
  const setText = (node, value) => { if (node) node.textContent = value; };

  async function save(patch) {
    const previous = config;
    config = FTM.configUtils.defaults(FTM.configUtils.merge(config, patch));
    try {
      await API.storage.set(patch);
      setText($('save-status'), 'Saved');
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => setText($('save-status'), ''), 1800);
      if (patch.conversionHistory) renderHistory();
    } catch (_) {
      config = previous;
      setText($('save-status'), 'Not saved');
      render();
    }
  }

  function renderFormats() {
    const root = $('format-list'); root.replaceChildren();
    for (const [category, [labelText, detail]] of Object.entries(categoryLabels)) {
      const label = document.createElement('label'); label.className = 'format-item';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = config.categories[category] !== false;
      input.addEventListener('change', () => save({ categories: { [category]: input.checked } }));
      const name = document.createElement('span'); setText(name, labelText);
      const suffix = document.createElement('small'); setText(suffix, detail);
      label.append(input, name, suffix); root.appendChild(label);
    }
  }

  function renderHistory() {
    const root = $('history-list'); root.replaceChildren();
    const entries = Array.isArray(config.conversionHistory) ? config.conversionHistory.slice().reverse().slice(0, 8) : [];
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'empty'; setText(empty, 'No local conversion history.'); root.appendChild(empty); return; }
    for (const entry of entries) {
      const row = document.createElement('div'); row.className = 'history-item';
      const label = document.createElement('strong'); setText(label, entry.file || entry.extension || 'file');
      const meta = document.createElement('small'); setText(meta, [entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '', entry.outputSize ? FTM.text.formatBytes(entry.outputSize) : ''].filter(Boolean).join(' · '));
      row.append(label, meta); root.appendChild(row);
    }
  }

  function render() {
    $('master-toggle').checked = config.enabled !== false;
    $('yaml-toggle').checked = config.yamlFrontmatter !== false;
    $('trim-whitespace').checked = config.stripTrailingWhitespace !== false;
    $('heading-hierarchy').checked = config.enforceHeadingHierarchy === true;
    renderFormats(); renderHistory();
  }

  async function exportHistory() {
    const data = JSON.stringify(config.conversionHistory || [], null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ftm-conversion-history.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function init() {
    try { config = FTM.configUtils.defaults(await API.storage.get(null)); } catch (_) { setText($('save-status'), 'Safe defaults'); }
    const badge = $('version-badge');
    try { setText(badge, 'v' + API.runtime.getManifest().version); } catch (_) { setText(badge, 'v4'); }
    $('open-converter').addEventListener('click', () => { location.href = 'convert.html'; });
    for (const [id, key] of [['master-toggle', 'enabled'], ['yaml-toggle', 'yamlFrontmatter'], ['trim-whitespace', 'stripTrailingWhitespace'], ['heading-hierarchy', 'enforceHeadingHierarchy']]) $(id).addEventListener('change', (event) => save({ [key]: event.target.checked }));
    $('clear-history').addEventListener('click', () => { if (confirm('Clear local conversion history?')) save({ conversionHistory: [] }); });
    $('export-history').addEventListener('click', exportHistory);
    if (API.api.storage?.onChanged) API.api.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      const patch = {}; for (const key of configKeys) if (changes[key]) patch[key] = changes[key].newValue;
      if (changes.conversionHistory) patch.conversionHistory = changes.conversionHistory.newValue;
      if (Object.keys(patch).length) { config = FTM.configUtils.defaults(FTM.configUtils.merge(config, patch)); render(); }
    });
    render();
  }

  init();
})();
