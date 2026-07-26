// ===========================================================================
// popup.js — Configuration Dashboard Logic (v1.0.1)
// ===========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  let currentConfig = {};
  const DEFAULT_CONFIG = {
    enabled: true,
    autoDismissSeconds: 10,
    domainBlacklist: [],
    categories: { pdf: true, documents: true, spreadsheets: true, code: true, markup: true, presentations: true },
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
  const statusDot = $('status-dot');
  const statusLabel = $('status-label');
  const timerSlider = $('timer-slider');
  const timerValue = $('timer-value');
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

  // ── Version badge ──
  const versionBadge = $('version-badge');
  if (versionBadge) {
    try {
      versionBadge.textContent = 'v' + chrome.runtime.getManifest().version;
    } catch (_) {
      versionBadge.textContent = 'v1.0.1';
    }
  }

  // ── Tabs ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ── Config ──
  const categoryCheckboxes = ['pdf', 'documents', 'spreadsheets', 'code', 'markup', 'presentations'];

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

  // ── Populate UI ──
  function populateUI() {
    masterToggle.checked = currentConfig.enabled !== false;
    updateStatus();

    timerSlider.value = currentConfig.autoDismissSeconds || 10;
    timerValue.textContent = (currentConfig.autoDismissSeconds || 10) + 's';

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

  timerSlider.addEventListener('input', () => {
    timerValue.textContent = timerSlider.value + 's';
  });
  timerSlider.addEventListener('change', () => {
    currentConfig.autoDismissSeconds = parseInt(timerSlider.value, 10);
    saveConfig({ autoDismissSeconds: currentConfig.autoDismissSeconds });
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

  function renderRegexRules() {
    regexContainer.innerHTML = '';
    const rules = currentConfig.regexPipeline || [];

    if (rules.length === 0) {
      regexContainer.innerHTML = '<p style="font-size:11px;color:var(--text-3);padding:2px 0">No rules yet.</p>';
      return;
    }

    rules.forEach((rule, idx) => {
      const div = document.createElement('div');
      div.className = 'regex-rule';

      // Header
      const header = document.createElement('div');
      header.className = 'regex-rule-header';

      const title = document.createElement('span');
      title.className = 'regex-rule-title';
      title.textContent = 'Rule ' + (idx + 1);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;align-items:center;gap:8px';

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'switch regex-enabled';
      toggle.dataset.idx = idx;
      toggle.checked = rule.enabled !== false;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove';
      removeBtn.dataset.idx = idx;
      removeBtn.title = 'Remove';
      removeBtn.textContent = '×';

      actions.appendChild(toggle);
      actions.appendChild(removeBtn);
      header.appendChild(title);
      header.appendChild(actions);

      // Pattern
      const pattern = document.createElement('input');
      pattern.type = 'text';
      pattern.className = 'regex-pattern';
      pattern.dataset.idx = idx;
      pattern.placeholder = 'Pattern';
      pattern.value = rule.pattern || '';

      // Replacement + flags
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
      flags.style.cssText = 'width:40px;text-align:center;flex:none';

      row.appendChild(replacement);
      row.appendChild(flags);

      div.appendChild(header);
      div.appendChild(pattern);
      div.appendChild(row);
      regexContainer.appendChild(div);
    });

    // Bind events
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

    regexContainer.querySelectorAll('.regex-enabled').forEach(el => {
      el.addEventListener('change', (e) => {
        const i = +e.target.dataset.idx;
        currentConfig.regexPipeline[i].enabled = e.target.checked;
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
      });
    });

    regexContainer.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = +e.target.dataset.idx;
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

  // ── History ──
  function renderHistory() {
    const history = currentConfig.conversionHistory || [];
    if (history.length === 0) {
      historyList.innerHTML = '<div class="empty"><p>No conversions yet</p><span>Drop a file on any webpage to start</span></div>';
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

      const ext = document.createElement('span');
      ext.className = 'history-ext';
      ext.textContent = (item.extension || '').toUpperCase().replace('.', '');

      const t = document.createElement('span');
      t.className = 'history-time';
      t.textContent = timeStr;

      row.appendChild(file);
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
    currentConfig.conversionHistory = [];
    saveConfig({ conversionHistory: [] });
    renderHistory();
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

  await loadConfig();
  populateUI();
});
