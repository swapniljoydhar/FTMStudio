// ===========================================================================
// popup.js — FTM Studio v2.0 Configuration Dashboard
// Elegant, minimal UI with collapsible sections
// ===========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  let currentConfig = {};
  
  const DEFAULT_CONFIG = {
    enabled: true,
    smartMode: true,
    autoConvert: false,
    autoDismissSeconds: 10,
    domainBlacklist: [],
    domainWhitelist: [],
    customAiHosts: [],
    categories: { pdf: true, documents: true, spreadsheets: true, code: true, markup: true, presentations: true, images: true },
    yamlFrontmatter: true,
    csvStreamThreshold: 5,
    stripTrailingWhitespace: true,
    enforceHeadingHierarchy: false,
    regexPipeline: [],
    conversionHistory: [],
    maxConversions: 50
  };

  // ── DOM refs ──
  const $ = (id) => document.getElementById(id);
  const masterToggle = $('master-toggle');
  const smartModeToggle = $('smart-mode');
  const autoConvertToggle = $('auto-convert');
  const statusDot = $('status-dot');
  const statusLabel = $('status-label');
  const blacklistTextarea = $('blacklist-textarea');
  const yamlToggle = $('yaml-toggle');
  const csvSlider = $('csv-threshold-slider');
  const csvValue = $('csv-threshold-value');
  const stripToggle = $('opt-strip-trailing');
  const headingToggle = $('opt-heading-hierarchy');
  const btnAddRegex = $('btn-add-regex');
  const regexContainer = $('regex-rules-container');
  const historyList = $('history-list');
  const btnExportHistory = $('btn-export-history');
  const btnClearHistory = $('btn-clear-history');
  const versionBadge = $('version-badge');

  // ── Version badge ──
  if (versionBadge) {
    try {
      versionBadge.textContent = 'v' + chrome.runtime.getManifest().version;
    } catch (_) {
      versionBadge.textContent = 'v2.0';
    }
  }

  // ── Tabs ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ── Collapsible Cards ──
  document.querySelectorAll('.card-header').forEach(header => {
    header.addEventListener('click', () => {
      const card = header.closest('.collapsible');
      const contentId = header.dataset.target;
      const content = $(contentId);
      
      card.classList.toggle('expanded');
      const isExpanded = card.classList.contains('expanded');
      header.setAttribute('aria-expanded', isExpanded);
      if (isExpanded) {
        content.style.display = 'block';
      } else {
        content.style.display = 'none';
      }
    });
  });

  // ── AI Sites database ──
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

  const siteCategories = $('site-categories');
  const customSitesList = $('custom-sites-list');
  const customSiteInput = $('custom-site-input');
  const addSiteBtn = $('add-site-btn');
  const resetSitesBtn = $('reset-sites-btn');
  const enabledCountEl = $('enabled-count');
  const customCountEl = $('custom-count');
  const siteSearchInput = $('site-search-input');

  function getCustomOverrides() {
    return currentConfig.customAiHosts || [];
  }

  function isRemoved(host) {
    return getCustomOverrides().includes('-' + host);
  }

  function updateSiteStats() {
    const overrides = getCustomOverrides();
    const removedCount = overrides.filter(e => e.startsWith('-')).length;
    const customAdded = overrides.filter(e => e.startsWith('+')).length;
    
    let totalEnabled = 0;
    for (const hosts of Object.values(AI_CATEGORIES)) {
      totalEnabled += hosts.filter(h => !isRemoved(h)).length;
    }
    
    enabledCountEl.textContent = totalEnabled;
    customCountEl.textContent = customAdded;
  }

  function renderAiSites() {
    siteCategories.innerHTML = '';
    
    for (const [cat, hosts] of Object.entries(AI_CATEGORIES)) {
      const group = document.createElement('div');
      group.className = 'site-category-group';
      
      const name = document.createElement('div');
      name.className = 'site-category-name';
      name.textContent = cat;
      group.appendChild(name);
      
      const pills = document.createElement('div');
      pills.className = 'site-pills';
      
      hosts.forEach(h => {
        const pill = document.createElement('span');
        pill.className = 'site-pill' + (isRemoved(h) ? ' removed' : '');
        
        const text = document.createElement('span');
        text.textContent = h;
        pill.appendChild(text);
        
        const removeBtn = document.createElement('span');
        removeBtn.className = 'site-pill-remove';
        removeBtn.textContent = '×';
        removeBtn.title = isRemoved(h) ? 'Restore' : 'Remove';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleBuiltIn(h);
        });
        pill.appendChild(removeBtn);
        
        pills.appendChild(pill);
      });
      
      group.appendChild(pills);
      siteCategories.appendChild(group);
    }

    customSitesList.innerHTML = '';
    const customAdded = getCustomOverrides().filter(e => e.startsWith('+'));
    
    if (customAdded.length > 0) {
      const label = document.createElement('div');
      label.className = 'site-category-name';
      label.textContent = 'Custom Added';
      customSitesList.appendChild(label);
      
      for (const entry of customAdded) {
        const domain = entry.substring(1);
        const row = document.createElement('div');
        row.className = 'custom-site-row';
        
        const span = document.createElement('span');
        span.textContent = domain;
        
        const btn = document.createElement('button');
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        btn.title = 'Remove';
        btn.addEventListener('click', () => removeCustom(domain));
        
        row.appendChild(span);
        row.appendChild(btn);
        customSitesList.appendChild(row);
      }
    }
    
    updateSiteStats();
    applySiteSearchFilter();
  }

  function applySiteSearchFilter() {
    const q = (siteSearchInput ? siteSearchInput.value : '').trim().toLowerCase();
    const groups = siteCategories.querySelectorAll('.site-category-group');
    groups.forEach(group => {
      const pills = group.querySelectorAll('.site-pill');
      let visibleCount = 0;
      pills.forEach(pill => {
        const host = pill.querySelector('span')?.textContent?.toLowerCase() || '';
        if (!q || host.includes(q)) {
          pill.classList.remove('hidden');
          visibleCount++;
        } else {
          pill.classList.add('hidden');
        }
      });
      group.classList.toggle('hidden', visibleCount === 0);
    });
  }

  if (siteSearchInput) {
    siteSearchInput.addEventListener('input', applySiteSearchFilter);
  }

  function toggleBuiltIn(host) {
    const overrides = [...getCustomOverrides()];
    const idx = overrides.indexOf('-' + host);
    if (idx >= 0) {
      overrides.splice(idx, 1);
    } else {
      overrides.push('-' + host);
    }
    currentConfig.customAiHosts = overrides;
    saveConfig({ customAiHosts: overrides });
    renderAiSites();
  }

  function removeCustom(domain) {
    const overrides = getCustomOverrides().filter(e => e !== '+' + domain);
    currentConfig.customAiHosts = overrides;
    saveConfig({ customAiHosts: overrides });
    renderAiSites();
  }

  function isValidDomain(domain) {
    if (!domain || domain.length > 253) return false;
    if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) return false;
    if (domain.includes('/') || domain.includes(' ') || domain.includes('@')) return false;
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(domain);
  }

  addSiteBtn.addEventListener('click', () => {
    const val = customSiteInput.value.trim().toLowerCase();
    if (!val) return;
    if (!isValidDomain(val)) {
      customSiteInput.style.borderColor = 'var(--danger)';
      setTimeout(() => { customSiteInput.style.borderColor = ''; }, 2000);
      return;
    }
    const overrides = [...getCustomOverrides()];
    if (!overrides.includes('+' + val)) {
      overrides.push('+' + val);
      currentConfig.customAiHosts = overrides;
      saveConfig({ customAiHosts: overrides });
      renderAiSites();
    }
    customSiteInput.value = '';
  });

  customSiteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSiteBtn.click(); }
  });

  resetSitesBtn.addEventListener('click', () => {
    if (confirm('Reset all AI site settings to defaults?')) {
      currentConfig.customAiHosts = [];
      saveConfig({ customAiHosts: [] });
      renderAiSites();
    }
  });

  // ── Config ──
  const categoryCheckboxes = ['pdf', 'documents', 'spreadsheets', 'code', 'markup', 'presentations', 'images'];

  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        currentConfig = { ...DEFAULT_CONFIG, ...items };
        if (items && items.categories) {
          currentConfig.categories = { ...DEFAULT_CONFIG.categories, ...items.categories };
        }
        currentConfig.regexPipeline = sanitizeRules(currentConfig.regexPipeline || []);
        resolve(currentConfig);
      });
    });
  }

  function saveConfig(partial) {
    chrome.storage.local.set(partial);
  }

  function sanitizeRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules
      .filter(r => r && r.pattern && typeof r.pattern === 'string')
      .map(r => ({
        pattern: r.pattern,
        replacement: typeof r.replacement === 'string' ? r.replacement : '',
        flags: (r.flags || 'g').replace(/[^gimsuy]/g, '') || 'g',
        enabled: r.enabled !== false,
        name: typeof r.name === 'string' ? r.name : ''
      }));
  }

  // ── Populate UI ──
  function populateUI() {
    masterToggle.checked = currentConfig.enabled !== false;
    smartModeToggle.checked = currentConfig.smartMode !== false;
    autoConvertToggle.checked = !!currentConfig.autoConvert;
    updateStatus();

    blacklistTextarea.value = (currentConfig.domainBlacklist || []).join('\n');
    yamlToggle.checked = currentConfig.yamlFrontmatter !== false;

    csvSlider.value = currentConfig.csvStreamThreshold || 5;
    csvValue.textContent = (currentConfig.csvStreamThreshold || 5) + ' MB';

    stripToggle.checked = currentConfig.stripTrailingWhitespace !== false;
    headingToggle.checked = !!currentConfig.enforceHeadingHierarchy;

    categoryCheckboxes.forEach(cat => {
      const el = document.getElementById('cat-' + cat);
      if (el) el.checked = !!(currentConfig.categories && currentConfig.categories[cat]);
    });

    renderRegexRules();
    renderHistory();
    renderAiSites();
  }

  function updateStatus() {
    const active = currentConfig.enabled !== false;
    if (statusDot) statusDot.classList.toggle('inactive', !active);
    if (statusLabel) statusLabel.textContent = active ? 'Active' : 'Disabled';
  }

  // ── Events ──
  masterToggle.addEventListener('change', () => {
    currentConfig.enabled = masterToggle.checked;
    saveConfig({ enabled: currentConfig.enabled });
    updateStatus();
  });

  smartModeToggle.addEventListener('change', () => {
    currentConfig.smartMode = smartModeToggle.checked;
    saveConfig({ smartMode: currentConfig.smartMode });
  });

  autoConvertToggle.addEventListener('change', () => {
    currentConfig.autoConvert = autoConvertToggle.checked;
    saveConfig({ autoConvert: currentConfig.autoConvert });
  });

  blacklistTextarea.addEventListener('change', () => {
    const domains = blacklistTextarea.value.split('\n').map(s => s.trim()).filter(Boolean);
    currentConfig.domainBlacklist = domains;
    saveConfig({ domainBlacklist: domains });
  });

  yamlToggle.addEventListener('change', () => {
    currentConfig.yamlFrontmatter = yamlToggle.checked;
    saveConfig({ yamlFrontmatter: yamlToggle.checked });
  });

  csvSlider.addEventListener('input', () => {
    csvValue.textContent = csvSlider.value + ' MB';
  });
  csvSlider.addEventListener('change', () => {
    currentConfig.csvStreamThreshold = parseInt(csvSlider.value, 10);
    saveConfig({ csvStreamThreshold: currentConfig.csvStreamThreshold });
  });

  stripToggle.addEventListener('change', () => {
    currentConfig.stripTrailingWhitespace = stripToggle.checked;
    saveConfig({ stripTrailingWhitespace: stripToggle.checked });
  });

  headingToggle.addEventListener('change', () => {
    currentConfig.enforceHeadingHierarchy = headingToggle.checked;
    saveConfig({ enforceHeadingHierarchy: headingToggle.checked });
  });

  categoryCheckboxes.forEach(cat => {
    const el = document.getElementById('cat-' + cat);
    if (el) {
      el.addEventListener('change', () => {
        if (!currentConfig.categories) currentConfig.categories = {};
        currentConfig.categories[cat] = el.checked;
        saveConfig({ categories: currentConfig.categories });
      });
    }
  });

  // ── Regex pipeline ──
  function renderRegexRules() {
    // Clear container safely
    while (regexContainer.firstChild) regexContainer.removeChild(regexContainer.firstChild);

    const rules = currentConfig.regexPipeline || [];

    if (rules.length === 0) {
      regexContainer.innerHTML = '<p style="font-size:11px;color:var(--text-3);padding:2px 0">No rules yet.</p>';
      return;
    }

    rules.forEach((rule, idx) => {
      const div = document.createElement('div');
      div.className = 'regex-rule';

      const header = document.createElement('div');
      header.className = 'regex-rule-header';

      const title = document.createElement('span');
      title.className = 'regex-rule-title';
      title.textContent = 'Rule ' + (idx + 1);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;align-items:center;gap:8px';

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'switch';
      toggle.dataset.idx = idx;
      toggle.checked = rule.enabled !== false;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-icon';
      removeBtn.dataset.idx = idx;
      removeBtn.title = 'Remove';
      removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

      actions.appendChild(toggle);
      actions.appendChild(removeBtn);
      header.appendChild(title);
      header.appendChild(actions);

      const pattern = document.createElement('input');
      pattern.type = 'text';
      pattern.className = 'regex-pattern';
      pattern.dataset.idx = idx;
      pattern.placeholder = 'Pattern';
      pattern.value = rule.pattern || '';

      const row = document.createElement('div');
      row.className = 'regex-rule-row';

      const replacement = document.createElement('input');
      replacement.type = 'text';
      replacement.className = 'regex-replacement';
      replacement.dataset.idx = idx;
      replacement.placeholder = 'Replacement';
      replacement.value = rule.replacement || '';

      const flags = document.createElement('input');
      flags.type = 'text';
      flags.className = 'regex-flags';
      flags.dataset.idx = idx;
      flags.placeholder = 'g';
      flags.value = rule.flags || 'g';

      row.appendChild(replacement);
      row.appendChild(flags);

      div.appendChild(header);
      div.appendChild(pattern);
      div.appendChild(row);
      regexContainer.appendChild(div);
    });

    regexContainer.querySelectorAll('.regex-pattern').forEach(el => {
      el.addEventListener('change', (e) => {
        const i = +e.target.dataset.idx;
        currentConfig.regexPipeline[i].pattern = e.target.value;
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
      });
    });

    regexContainer.querySelectorAll('.regex-replacement').forEach(el => {
      el.addEventListener('change', (e) => {
        const i = +e.target.dataset.idx;
        currentConfig.regexPipeline[i].replacement = e.target.value;
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
      });
    });

    regexContainer.querySelectorAll('.regex-flags').forEach(el => {
      el.addEventListener('change', (e) => {
        const i = +e.target.dataset.idx;
        currentConfig.regexPipeline[i].flags = e.target.value.replace(/[^gimsuy]/g, '');
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
      });
    });

    regexContainer.querySelectorAll('.regex-enabled, .switch[data-idx]').forEach(el => {
      el.addEventListener('change', (e) => {
        const i = +e.target.dataset.idx;
        currentConfig.regexPipeline[i].enabled = e.target.checked;
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
      });
    });

    regexContainer.querySelectorAll('.btn-remove, .btn-icon[data-idx]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = +e.currentTarget.dataset.idx;
        currentConfig.regexPipeline.splice(i, 1);
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
        renderRegexRules();
      });
    });
  }

  btnAddRegex.addEventListener('click', () => {
    if (!currentConfig.regexPipeline) currentConfig.regexPipeline = [];
    currentConfig.regexPipeline.push({ pattern: '', replacement: '', flags: 'g', enabled: true, name: '' });
    saveConfig({ regexPipeline: currentConfig.regexPipeline });
    renderRegexRules();
  });

  // ── Helpers ──
  function formatBytesLocal(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ── History ──
  function renderHistory() {
    // Clear container safely
    while (historyList.firstChild) historyList.removeChild(historyList.firstChild);

    const history = currentConfig.conversionHistory || [];

    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p>No conversions yet</p>
          <span>Drop a file on any webpage to start</span>
        </div>`;
      return;
    }

    historyList.innerHTML = '';
    for (let i = history.length - 1; i >= 0; i--) {
      const item = history[i];
      const time = new Date(item.timestamp);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const row = document.createElement('div');
      row.className = 'history-item';

      const file = document.createElement('span');
      file.className = 'history-file';
      file.textContent = item.file || '';

      const sizeEl = document.createElement('span');
      sizeEl.className = 'history-size';
      sizeEl.textContent = item.size ? formatBytesLocal(item.size) : '';

      const ext = document.createElement('span');
      ext.className = 'history-ext';
      ext.textContent = (item.extension || '').toUpperCase().replace('.', '');

      const t = document.createElement('span');
      t.className = 'history-time';
      t.textContent = timeStr;

      row.appendChild(file);
      row.appendChild(sizeEl);
      row.appendChild(ext);
      row.appendChild(t);
      historyList.appendChild(row);
    }
  }

  btnExportHistory.addEventListener('click', () => {
    const history = currentConfig.conversionHistory || [];
    if (!history.length) return;
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'ftm-conversion-history.json', saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  btnClearHistory.addEventListener('click', () => {
    if (confirm('Clear all conversion history?')) {
      currentConfig.conversionHistory = [];
      saveConfig({ conversionHistory: [] });
      renderHistory();
    }
  });

  // ── External config sync ──
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      chrome.storage.local.get(null, (items) => {
        if (items) {
          currentConfig = { ...DEFAULT_CONFIG, ...items };
          if (items.categories) {
            currentConfig.categories = { ...DEFAULT_CONFIG.categories, ...items.categories };
          }
          populateUI();
        }
      });
    }
  });

  // ─── INITIALIZE ───
  await loadConfig();
  populateUI();
});
