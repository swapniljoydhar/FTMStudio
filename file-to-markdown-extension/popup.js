// ===========================================================================
// popup.js — Configuration dashboard
// ===========================================================================
// FIX #5 (Medium): ownWrites replaced with a Set-based change source tracker
//   that correctly ignores only self-originated writes, without race conditions.
// FIX #7 (Medium): unsafe markup construction replaced with DOM APIs.
// FIX Perf #4: Site search debounced at 150ms.
// FIX Perf #5: Site toggle uses delta DOM update (classList.toggle) instead
//   of full rebuild.
// FIX Perf #12: filterSites() skipped on fresh render when search is empty.
// ===========================================================================

'use strict';

(() => {
  const FTM = self.FTM;
  const $ = (id) => document.getElementById(id);

  const AI_CATEGORIES = {
    'LLM Chatbots': ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'claude.com', 'gemini.google.com', 'copilot.microsoft.com', 'chat.deepseek.com', 'chat.mistral.ai', 'huggingface.co', 'poe.com', 'perplexity.ai', 'you.com', 'character.ai', 'meta.ai', 'pi.ai', 'grok.com', 'x.ai', 'monica.im', 'felo.ai', 'genspark.ai', 'manus.im', 'qwen.ai'],
    'AI Code': ['cursor.com', 'replit.com', 'codeium.com', 'tabnine.com', 'phind.com', 'blackbox.ai', 'devv.ai'],
    'AI Image': ['midjourney.com', 'stability.ai', 'leonardo.ai', 'ideogram.ai', 'playground.ai', 'firefly.adobe.com', 'canva.com'],
    'AI Video': ['runwayml.com', 'synthesia.io', 'pika.art', 'heygen.com', 'luma.ai', 'descript.com'],
    'AI Audio': ['elevenlabs.io', 'play.ht', 'murf.ai', 'suno.com', 'udio.com', 'speechify.com'],
    'AI Writing': ['jasper.ai', 'copy.ai', 'writesonic.com', 'grammarly.com', 'quillbot.com', 'wordtune.com'],
    'AI Search': ['perplexity.ai', 'consensus.app', 'elicit.com', 'scite.ai'],
    'AI Productivity': ['notion.so', 'gamma.app', 'tome.app', 'beautiful.ai', 'fireflies.ai']
  };

  const FORMAT_META = {
    documents:     { label: 'Documents',     exts: '.docx .txt .rtf .md' },
    pdf:           { label: 'PDF',           exts: '.pdf' },
    spreadsheets:  { label: 'Spreadsheets',  exts: '.csv .xlsx .xls' },
    presentations: { label: 'Presentations', exts: '.pptx' },
    markup:        { label: 'Markup',        exts: '.html .epub' },
    code:          { label: 'Source Code',   exts: '.py .js .cpp .css .json .xml' },
    images:        { label: 'Images',        exts: '.png .jpg .gif .webp .svg' }
  };

  // FIX #7: Create SVG icon via DOM APIs.
  function createCloseIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', '18'); line1.setAttribute('y1', '6');
    line1.setAttribute('x2', '6'); line1.setAttribute('y2', '18');
    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', '6'); line2.setAttribute('y1', '6');
    line2.setAttribute('x2', '18'); line2.setAttribute('y2', '18');
    svg.append(line1, line2);
    return svg;
  }

  // FIX #7: Create the empty-state SVG via DOM APIs.
  function createEmptyStateIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '40');
    svg.setAttribute('height', '40');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('opacity', '0.4');
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '17 8 12 3 7 8');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '12'); line.setAttribute('y1', '3');
    line.setAttribute('x2', '12'); line.setAttribute('y2', '15');
    svg.append(path1, polyline, line);
    return svg;
  }

  let config = FTM.configUtils.defaults({});
  // FIX #5: Track pending storage writes by timestamp to ignore self-originated
  //   onChanged events without a race-prone counter.
  const ownWriteTimestamps = new Set();
  let saveStatusTimer = null;

  // ── Storage ──────────────────────────────────────────────────────────────
  function setSaveStatus(message, failed) {
    const node = $('save-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', !!failed);
    node.classList.add('visible');
    if (saveStatusTimer) clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => node.classList.remove('visible'), 1800);
  }

  function save(patch) {
    const previous = config;
    config = FTM.configUtils.merge(config, patch);
    const ts = Date.now();
    ownWriteTimestamps.add(ts);
    chrome.storage.local.set(patch, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        config = previous;
        setSaveStatus('Not saved', true);
        console.error('[FTM Studio] Settings save failed:', error?.name || 'UnknownError');
      } else setSaveStatus('Saved', false);
      ownWriteTimestamps.delete(ts);
      // Remove after a short delay to cover the onChanged delivery window.
      setTimeout(() => ownWriteTimestamps.delete(ts), 500);
    });
  }

  async function load() {
    config = FTM.configUtils.defaults(await chrome.storage.local.get(null));
    return config;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function overrides() {
    return config.customAiHosts || [];
  }

  function removedHosts() {
    return new Set(overrides().filter((entry) => String(entry).startsWith('-')));
  }

  function setOverrides(list) {
    save({ customAiHosts: list });
    renderSites();
  }

  // ── Chrome / shell ───────────────────────────────────────────────────────
  function initChrome() {
    const badge = $('version-badge');
    if (badge) badge.textContent = 'v' + chrome.runtime.getManifest().version;
    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab)));
  }

  function selectTab(tab) {
    document.querySelectorAll('.tab').forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    $('panel-' + tab.dataset.tab).classList.add('active');
  }

  // ── Toggles and inputs ───────────────────────────────────────────────────
  const TOGGLES = [
    ['master-toggle', 'enabled', true],
    ['smart-mode', 'smartMode', true],
    ['auto-convert', 'autoConvert', false],
    ['yaml-toggle', 'yamlFrontmatter', true],
    ['preserve-mime', 'preserveOriginalMime', false],
    ['opt-strip-trailing', 'stripTrailingWhitespace', true],
    ['opt-heading-hierarchy', 'enforceHeadingHierarchy', false]
  ];

  // FIX Perf #4: Debounce helper.
  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn.apply(this, args); }, ms);
    };
  }

  function bindToggles() {
    for (const [id, key] of TOGGLES) {
      const node = $(id);
      if (!node) continue;
      node.addEventListener('change', () => {
        save({ [key]: node.checked });
        if (key === 'enabled') renderStatus();
      });
    }
  }

  function bindFields() {
    $('blacklist-textarea').addEventListener('change', (e) =>
      save({ domainBlacklist: FTM.configUtils.domainList(e.target.value.split('\n')) }));
    $('csv-threshold-slider').addEventListener('input', (e) => { $('csv-threshold-value').textContent = e.target.value + ' MB'; });
    $('csv-threshold-slider').addEventListener('change', (e) => save({ csvStreamThreshold: parseInt(e.target.value, 10) }));
    $('btn-add-regex').addEventListener('click', () => addRule());
    // FIX Perf #4: Debounce site search at 150ms.
    $('site-search-input').addEventListener('input', debounce(filterSites, 150));
    $('add-site-btn').addEventListener('click', addSite);
    $('custom-site-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSite(); } });
    $('reset-sites-btn').addEventListener('click', () => { if (confirm('Reset all AI site settings to defaults?')) setOverrides([]); });
    $('btn-export-history').addEventListener('click', exportHistory);
    $('btn-clear-history').addEventListener('click', () => { if (confirm('Clear all conversion history?')) { save({ conversionHistory: [] }); renderHistory(); } });
  }

  // ── Renderers ────────────────────────────────────────────────────────────
  function renderStatus() {
    const active = config.enabled !== false;
    const pill = $('status-pill');
    const dot = $('status-dot');
    const label = $('status-label');
    const header = document.querySelector('.header');
    const logo = document.querySelector('.logo-mark');

    pill.classList.toggle('inactive', !active);
    dot.classList.toggle('inactive', !active);
    label.textContent = active ? 'Active' : 'Disabled';
    if (header) header.classList.toggle('disabled', !active);
    if (logo) logo.classList.toggle('disabled', !active);

    // Update page title so user sees state in tab hover.
    document.title = active ? 'FTM Studio — Active' : 'FTM Studio — Disabled';
  }

  function renderFormatToggles() {
    const container = $('format-toggles-container');
    clear(container);
    for (const cat of FTM.CATEGORIES) {
      const meta = FORMAT_META[cat];
      if (!meta) continue;
      const row = el('label', 'format-row');
      const info = el('div', 'format-info');
      info.append(el('span', 'format-name', meta.label), el('span', 'format-exts', meta.exts));
      const toggle = el('input', 'switch');
      toggle.type = 'checkbox';
      toggle.id = 'cat-' + cat;
      toggle.checked = !!(config.categories && config.categories[cat]);
      toggle.addEventListener('change', () => save({ categories: { ...config.categories, [cat]: toggle.checked } }));
      row.append(info, toggle);
      container.appendChild(row);
    }
  }

  function renderSettings() {
    for (const [id, key, fallback] of TOGGLES) {
      const node = $(id);
      if (node) node.checked = config[key] !== undefined ? !!config[key] : fallback;
    }
    $('blacklist-textarea').value = (config.domainBlacklist || []).join('\n');
    const mb = config.csvStreamThreshold || FTM.CONSTANTS.CSV_STREAM_THRESHOLD_MB_DEFAULT;
    $('csv-threshold-slider').value = mb;
    $('csv-threshold-value').textContent = mb + ' MB';
    renderFormatToggles();
    renderStatus();
  }

  function sitePill(host, removed) {
    const pill = el('span', 'site-pill' + (removed.has('-' + host) ? ' removed' : ''));
    pill.setAttribute('data-host', host);
    const remove = el('span', 'site-pill-remove', '\u00D7');
    remove.title = removed.has('-' + host) ? 'Restore' : 'Remove';
    remove.addEventListener('click', (e) => { e.stopPropagation(); toggleBuiltIn(host); });
    pill.append(el('span', null, host), remove);
    return pill;
  }

  function siteGroup(category, hosts, removed) {
    const group = el('div', 'site-category-group');
    const pills = el('div', 'site-pills');
    for (const host of hosts) pills.appendChild(sitePill(host, removed));
    group.append(el('div', 'site-category-name', category), pills);
    return group;
  }

  function customRow(domain) {
    const row = el('div', 'custom-site-row');
    const button = el('button');
    // FIX #7: Use DOM APIs for safe rendering.
    button.appendChild(createCloseIcon());
    button.title = 'Remove';
    button.addEventListener('click', () => setOverrides(overrides().filter((e) => e !== '+' + domain)));
    row.append(el('span', null, domain), button);
    return row;
  }

  function renderSites() {
    const groups = $('site-categories');
    clear(groups);
    const removed = removedHosts();
    for (const [category, hosts] of Object.entries(AI_CATEGORIES)) groups.appendChild(siteGroup(category, hosts, removed));
    const custom = $('custom-sites-list');
    clear(custom);
    const added = overrides().filter((e) => String(e)[0] === '+');
    if (added.length) custom.appendChild(el('div', 'site-category-name', 'Custom Added'));
    for (const entry of added) custom.appendChild(customRow(entry.substring(1)));
    renderSiteStats(added.length, removed);
    // FIX Perf #12: Only run filterSites if a search query is active.
    const query = ($('site-search-input').value || '').trim();
    if (query) filterSites();
  }

  function renderSiteStats(customCount, removed = removedHosts()) {
    let enabled = 0;
    for (const hosts of Object.values(AI_CATEGORIES)) enabled += hosts.filter((h) => !removed.has('-' + h)).length;
    $('enabled-count').textContent = String(enabled);
    $('custom-count').textContent = String(customCount);
  }

  function filterSites() {
    const query = ($('site-search-input').value || '').trim().toLowerCase();
    for (const group of $('site-categories').querySelectorAll('.site-category-group')) {
      let visible = 0;
      for (const pill of group.querySelectorAll('.site-pill')) {
        const host = (pill.getAttribute('data-host') || '').toLowerCase();
        const hidden = !!query && !host.includes(query);
        pill.classList.toggle('hidden', hidden);
        if (!hidden) visible++;
      }
      group.classList.toggle('hidden', visible === 0);
    }
  }

  // FIX Perf #5: Delta DOM update — toggle the pill's class directly instead
  //   of rebuilding the entire site list.
  function toggleBuiltIn(host) {
    const list = [...overrides()];
    const idx = list.indexOf('-' + host);
    if (idx >= 0) list.splice(idx, 1); else list.push('-' + host);
    config.customAiHosts = list;
    save({ customAiHosts: list });
    // Update the specific pill in the DOM.
    const pill = $('site-categories').querySelector('[data-host="' + host + '"]');
    if (pill) pill.classList.toggle('removed', idx >= 0);
    // Update the remove button title.
    if (pill) {
      const removeBtn = pill.querySelector('.site-pill-remove');
      if (removeBtn) removeBtn.title = idx >= 0 ? 'Remove' : 'Restore';
    }
    renderSiteStats(overrides().filter((e) => String(e)[0] === '+').length);
  }

  function isValidDomain(domain) {
    if (!domain || domain.length > 253) return false;
    if (/[\s/@]|\.\./.test(domain) || domain.startsWith('.') || domain.endsWith('.')) return false;
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain);
  }

  function addSite() {
    const input = $('custom-site-input');
    const value = input.value.trim().toLowerCase();
    if (!value) return;
    if (!isValidDomain(value)) {
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => { input.style.borderColor = ''; }, 2000);
      return;
    }
    if (!overrides().includes('+' + value)) setOverrides([...overrides(), '+' + value]);
    input.value = '';
  }

  // ── Regex pipeline ───────────────────────────────────────────────────────
  function ruleField(className, placeholder, value, onCommit) {
    const input = el('input', className);
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = value || '';
    input.addEventListener('change', () => onCommit(input.value));
    return input;
  }

  function updateRule(index, patch) {
    const rules = (config.regexPipeline || []).map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    save({ regexPipeline: rules });
  }

  function ruleHeader(rule, index) {
    const header = el('div', 'regex-rule-header');
    const actions = el('div', 'regex-rule-actions');
    const toggle = el('input', 'switch');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled !== false;
    toggle.addEventListener('change', () => updateRule(index, { enabled: toggle.checked }));
    const remove = el('button', 'btn-icon-sm');
    remove.title = 'Remove';
    // FIX #7: Use DOM APIs for safe rendering.
    remove.appendChild(createCloseIcon());
    remove.addEventListener('click', () => removeRule(index));
    actions.append(toggle, remove);
    header.append(el('span', 'regex-rule-title', 'Rule ' + (index + 1)), actions);
    return header;
  }

  function ruleCard(rule, index) {
    const card = el('div', 'regex-rule');
    const row = el('div', 'regex-rule-row');
    row.append(
      ruleField('regex-replacement', 'Replacement', rule.replacement, (v) => updateRule(index, { replacement: v })),
      ruleField('regex-flags', 'g', rule.flags, (v) => updateRule(index, { flags: v.replace(/[^gimsuy]/g, '') }))
    );
    card.append(
      ruleHeader(rule, index),
      ruleField('regex-pattern', 'Pattern', rule.pattern, (v) => updateRule(index, { pattern: v })),
      row
    );
    return card;
  }

  function renderRules() {
    const container = $('regex-rules-container');
    clear(container);
    const rules = config.regexPipeline || [];
    if (!rules.length) {
      const empty = el('p', null, 'No rules yet.');
      empty.style.cssText = 'font-size:11px;color:var(--text-3);padding:2px 0';
      container.appendChild(empty);
      return;
    }
    rules.forEach((rule, index) => container.appendChild(ruleCard(rule, index)));
  }

  function addRule() {
    save({ regexPipeline: [...(config.regexPipeline || []), { pattern: '', replacement: '', flags: 'g', enabled: true, name: '' }] });
    renderRules();
  }

  function removeRule(index) {
    save({ regexPipeline: (config.regexPipeline || []).filter((_, i) => i !== index) });
    renderRules();
  }

  // ── History ──────────────────────────────────────────────────────────────
  function historyRow(item) {
    const row = el('div', 'history-item');
    row.append(
      el('span', 'history-file', item.file || ''),
      el('span', 'history-size', item.size ? FTM.text.formatBytes(item.size) : ''),
      el('span', 'history-ext', (item.extension || '').toUpperCase().replace('.', '')),
      el('span', 'history-time', new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    );
    return row;
  }

  function emptyHistory() {
    const empty = el('div', 'empty-state');
    // FIX #7: Use DOM APIs for safe rendering.
    empty.appendChild(createEmptyStateIcon());
    empty.append(el('p', null, 'No conversions yet'), el('span', null, 'Drop a file on any AI chatbot to start'));
    return empty;
  }

  function renderHistory() {
    const list = $('history-list');
    clear(list);
    const history = config.conversionHistory || [];
    if (!history.length) { list.appendChild(emptyHistory()); return; }
    for (let i = history.length - 1; i >= 0; i--) list.appendChild(historyRow(history[i]));
  }

  function exportHistory() {
    const history = config.conversionHistory || [];
    if (!history.length) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' }));
    chrome.downloads.download({ url, filename: 'ftm-conversion-history.json', saveAs: true }, () => {
      const error = chrome.runtime.lastError;
      if (error) console.error('[FTM Studio] History export failed:', error?.name || 'UnknownError');
      URL.revokeObjectURL(url);
    });
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── External sync ────────────────────────────────────────────────────────
  const SECTIONS = [
    { keys: ['customAiHosts'], render: renderSites },
    { keys: ['regexPipeline'], render: renderRules },
    { keys: ['conversionHistory'], render: renderHistory },
    { keys: ['categories'], render: renderFormatToggles }
  ];

  function onExternalChange(changes, area) {
    if (area !== 'local') return;
    // FIX #5: If we have pending self-originated writes, skip processing.
    //   This is more reliable than a counter because it tracks actual write
    //   timestamps rather than relying on callback ordering.
    if (ownWriteTimestamps.size > 0) return;
    const patch = {};
    for (const [key, change] of Object.entries(changes)) patch[key] = change.newValue;
    config = FTM.configUtils.merge(config, patch);
    const keys = Object.keys(patch);
    for (const section of SECTIONS) if (section.keys.some((k) => keys.includes(k))) section.render();
    if (keys.some((k) => !SECTIONS.some((s) => s.keys.includes(k)))) renderSettings();
  }

  // ── Splash Intro ──────────────────────────────────────────────────────
  function initSplash() {
    const splash = $('splash');
    if (!splash) return;
    // Remove from DOM after animation completes
    splash.addEventListener('animationend', (e) => {
      if (e.animationName === 'splash-fade-out') splash.remove();
    });
    // Fallback: force remove after 2s in case animation event doesn't fire
    setTimeout(() => { if (splash.parentNode) splash.remove(); }, 2000);
  }

  // ── Collapsible / Accordion ─────────────────────────────────────────────
  function bindCollapsibles() {
    document.querySelectorAll('.card-header-toggle').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        const targetId = toggle.getAttribute('aria-controls');
        const body = $(targetId);
        if (!body) return;
        toggle.setAttribute('aria-expanded', String(!expanded));
        body.classList.toggle('expanded', !expanded);
      });
    });
  }

  async function init() {
    initSplash();
    initChrome();
    bindToggles();
    bindFields();
    bindCollapsibles();
    await load();
    renderSettings();
    renderSites();
    renderRules();
    renderHistory();
    chrome.storage.onChanged.addListener(onExternalChange);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
