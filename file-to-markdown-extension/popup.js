// ===========================================================================
// popup.js — Configuration dashboard
// ===========================================================================
// Uses the shared config schema (no third divergent DEFAULT_CONFIG copy) and
// re-renders only the sections that actually changed; self-originated writes
// are ignored, which removes the full-tree re-render loop on every keystroke.
// ===========================================================================

'use strict';

(() => {
  const FTM = self.FTM;
  const $ = (id) => document.getElementById(id);

  const AI_CATEGORIES = {
    'LLM Chatbots': ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com', 'chat.deepseek.com', 'chat.mistral.ai', 'huggingface.co', 'poe.com', 'perplexity.ai', 'you.com', 'character.ai', 'meta.ai', 'pi.ai'],
    'AI Code': ['cursor.com', 'replit.com', 'codeium.com', 'tabnine.com', 'phind.com', 'blackbox.ai', 'devv.ai'],
    'AI Image': ['midjourney.com', 'stability.ai', 'leonardo.ai', 'ideogram.ai', 'playground.ai', 'firefly.adobe.com', 'canva.com'],
    'AI Video': ['runwayml.com', 'synthesia.io', 'pika.art', 'heygen.com', 'luma.ai', 'descript.com'],
    'AI Audio': ['elevenlabs.io', 'play.ht', 'murf.ai', 'suno.com', 'udio.com', 'speechify.com'],
    'AI Writing': ['jasper.ai', 'copy.ai', 'writesonic.com', 'grammarly.com', 'quillbot.com', 'wordtune.com'],
    'AI Search': ['perplexity.ai', 'consensus.app', 'elicit.com', 'scite.ai'],
    'AI Productivity': ['notion.so', 'gamma.app', 'tome.app', 'beautiful.ai', 'fireflies.ai']
  };

  const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  let config = FTM.configUtils.defaults({});
  let ownWrites = 0;

  // ── Storage ──────────────────────────────────────────────────────────────
  function save(patch) {
    config = FTM.configUtils.merge(config, patch);
    ownWrites++;
    chrome.storage.local.set(patch, () => { ownWrites = Math.max(0, ownWrites - 1); });
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

  function isRemoved(host) {
    return overrides().includes('-' + host);
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
    document.querySelectorAll('.card-header').forEach((header) => header.addEventListener('click', () => toggleCard(header)));
  }

  function selectTab(tab) {
    document.querySelectorAll('.tab').forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    $('panel-' + tab.dataset.tab).classList.add('active');
  }

  function toggleCard(header) {
    const card = header.closest('.collapsible');
    card.classList.toggle('expanded');
    const expanded = card.classList.contains('expanded');
    header.setAttribute('aria-expanded', String(expanded));
    $(header.dataset.target).style.display = expanded ? 'block' : 'none';
  }

  // ── Toggles and inputs ───────────────────────────────────────────────────
  const TOGGLES = [
    ['master-toggle', 'enabled', true],
    ['smart-mode', 'smartMode', true],
    ['auto-convert', 'autoConvert', false],
    ['yaml-toggle', 'yamlFrontmatter', true],
    ['opt-strip-trailing', 'stripTrailingWhitespace', true],
    ['opt-heading-hierarchy', 'enforceHeadingHierarchy', false]
  ];

  function bindToggles() {
    for (const [id, key] of TOGGLES) {
      const node = $(id);
      if (!node) continue;
      node.addEventListener('change', () => {
        save({ [key]: node.checked });
        if (key === 'enabled') renderStatus();
      });
    }
    for (const cat of FTM.CATEGORIES) {
      const node = $('cat-' + cat);
      if (node) node.addEventListener('change', () => save({ categories: { ...config.categories, [cat]: node.checked } }));
    }
  }

  function bindFields() {
    $('blacklist-textarea').addEventListener('change', (e) =>
      save({ domainBlacklist: FTM.configUtils.domainList(e.target.value.split('\n')) }));
    $('csv-threshold-slider').addEventListener('input', (e) => { $('csv-threshold-value').textContent = e.target.value + ' MB'; });
    $('csv-threshold-slider').addEventListener('change', (e) => save({ csvStreamThreshold: parseInt(e.target.value, 10) }));
    $('btn-add-regex').addEventListener('click', () => addRule());
    $('site-search-input').addEventListener('input', filterSites);
    $('add-site-btn').addEventListener('click', addSite);
    $('custom-site-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSite(); } });
    $('reset-sites-btn').addEventListener('click', () => { if (confirm('Reset all AI site settings to defaults?')) setOverrides([]); });
    $('btn-export-history').addEventListener('click', exportHistory);
    $('btn-clear-history').addEventListener('click', () => { if (confirm('Clear all conversion history?')) { save({ conversionHistory: [] }); renderHistory(); } });
  }

  // ── Renderers ────────────────────────────────────────────────────────────
  function renderStatus() {
    const active = config.enabled !== false;
    $('status-dot').classList.toggle('inactive', !active);
    $('status-label').textContent = active ? 'Active' : 'Disabled';
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
    for (const cat of FTM.CATEGORIES) {
      const node = $('cat-' + cat);
      if (node) node.checked = !!(config.categories && config.categories[cat]);
    }
    renderStatus();
  }

  function sitePill(host) {
    const pill = el('span', 'site-pill' + (isRemoved(host) ? ' removed' : ''));
    const remove = el('span', 'site-pill-remove', '\u00D7');
    remove.title = isRemoved(host) ? 'Restore' : 'Remove';
    remove.addEventListener('click', (e) => { e.stopPropagation(); toggleBuiltIn(host); });
    pill.append(el('span', null, host), remove);
    return pill;
  }

  function siteGroup(category, hosts) {
    const group = el('div', 'site-category-group');
    const pills = el('div', 'site-pills');
    for (const host of hosts) pills.appendChild(sitePill(host));
    group.append(el('div', 'site-category-name', category), pills);
    return group;
  }

  function customRow(domain) {
    const row = el('div', 'custom-site-row');
    const button = el('button');
    button.innerHTML = CLOSE_ICON;
    button.title = 'Remove';
    button.addEventListener('click', () => setOverrides(overrides().filter((e) => e !== '+' + domain)));
    row.append(el('span', null, domain), button);
    return row;
  }

  function renderSites() {
    const groups = $('site-categories');
    clear(groups);
    for (const [category, hosts] of Object.entries(AI_CATEGORIES)) groups.appendChild(siteGroup(category, hosts));
    const custom = $('custom-sites-list');
    clear(custom);
    const added = overrides().filter((e) => String(e)[0] === '+');
    if (added.length) custom.appendChild(el('div', 'site-category-name', 'Custom Added'));
    for (const entry of added) custom.appendChild(customRow(entry.substring(1)));
    renderSiteStats(added.length);
    filterSites();
  }

  function renderSiteStats(customCount) {
    let enabled = 0;
    for (const hosts of Object.values(AI_CATEGORIES)) enabled += hosts.filter((h) => !isRemoved(h)).length;
    $('enabled-count').textContent = String(enabled);
    $('custom-count').textContent = String(customCount);
  }

  function filterSites() {
    const query = ($('site-search-input').value || '').trim().toLowerCase();
    for (const group of $('site-categories').querySelectorAll('.site-category-group')) {
      let visible = 0;
      for (const pill of group.querySelectorAll('.site-pill')) {
        const host = (pill.querySelector('span')?.textContent || '').toLowerCase();
        const hidden = !!query && !host.includes(query);
        pill.classList.toggle('hidden', hidden);
        if (!hidden) visible++;
      }
      group.classList.toggle('hidden', visible === 0);
    }
  }

  function toggleBuiltIn(host) {
    const list = [...overrides()];
    const idx = list.indexOf('-' + host);
    if (idx >= 0) list.splice(idx, 1); else list.push('-' + host);
    setOverrides(list);
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
    const actions = el('div');
    actions.style.cssText = 'display:flex;align-items:center;gap:8px';
    const toggle = el('input', 'switch');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled !== false;
    toggle.addEventListener('change', () => updateRule(index, { enabled: toggle.checked }));
    const remove = el('button', 'btn-icon');
    remove.title = 'Remove';
    remove.innerHTML = CLOSE_ICON;
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
    empty.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
    empty.append(el('p', null, 'No conversions yet'), el('span', null, 'Drop a file on any webpage to start'));
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
    chrome.downloads.download({ url, filename: 'ftm-conversion-history.json', saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── External sync ────────────────────────────────────────────────────────
  const SECTIONS = [
    { keys: ['customAiHosts'], render: renderSites },
    { keys: ['regexPipeline'], render: renderRules },
    { keys: ['conversionHistory'], render: renderHistory }
  ];

  function onExternalChange(changes, area) {
    if (area !== 'local' || ownWrites > 0) return;
    const patch = {};
    for (const [key, change] of Object.entries(changes)) patch[key] = change.newValue;
    config = FTM.configUtils.merge(config, patch);
    const keys = Object.keys(patch);
    for (const section of SECTIONS) if (section.keys.some((k) => keys.includes(k))) section.render();
    if (keys.some((k) => !SECTIONS.some((s) => s.keys.includes(k)))) renderSettings();
  }

  async function init() {
    initChrome();
    bindToggles();
    bindFields();
    await load();
    renderSettings();
    renderSites();
    renderRules();
    renderHistory();
    chrome.storage.onChanged.addListener(onExternalChange);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
