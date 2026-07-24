// ===========================================================================
// popup.js — Configuration Dashboard Logic (v6.5)
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

  // ─── DOM REFERENCES ───
  const masterToggle = document.getElementById('master-toggle');
  const statusDot = document.getElementById('status-dot');
  const statusLabel = document.getElementById('status-label');
  const timerSlider = document.getElementById('timer-slider');
  const timerValue = document.getElementById('timer-value');
  const blacklistTextarea = document.getElementById('blacklist-textarea');
  const yamlToggle = document.getElementById('yaml-toggle');
  const csvSlider = document.getElementById('csv-threshold-slider');
  const csvValue = document.getElementById('csv-threshold-value');
  const stripToggle = document.getElementById('opt-strip-trailing');
  const headingToggle = document.getElementById('opt-heading-hierarchy');
  const btnAddRegex = document.getElementById('btn-add-regex');
  const regexContainer = document.getElementById('regex-rules-container');
  const historyList = document.getElementById('history-list');
  const btnExportHistory = document.getElementById('btn-export-history');
  const btnClearHistory = document.getElementById('btn-clear-history');

  // ─── TAB NAVIGATION ───
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ─── FORMAT BADGES ───
  const categoryCheckboxes = ['pdf', 'documents', 'spreadsheets', 'code', 'markup', 'presentations'];

  // ─── LOAD CONFIG ───
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

  // ─── SAVE CONFIG ───
  function saveConfig(partial) {
    chrome.storage.local.set(partial);
  }

  // ─── POPULATE UI ───
  function populateUI() {
    masterToggle.checked = currentConfig.enabled !== false;
    updateStatusUI();

    timerSlider.value = currentConfig.autoDismissSeconds || 10;
    timerValue.textContent = currentConfig.autoDismissSeconds + 's';

    blacklistTextarea.value = (currentConfig.domainBlacklist || []).join('\n');

    yamlToggle.checked = currentConfig.yamlFrontmatter !== false;

    csvSlider.value = currentConfig.csvStreamThreshold || 5;
    csvValue.textContent = currentConfig.csvStreamThreshold + ' MB';

    stripToggle.checked = currentConfig.stripTrailingWhitespace !== false;
    headingToggle.checked = !!currentConfig.enforceHeadingHierarchy;

    categoryCheckboxes.forEach(cat => {
      const el = document.getElementById('cat-' + cat);
      if (el) el.checked = !!(currentConfig.categories && currentConfig.categories[cat]);
    });

    renderRegexRules();
    renderHistory();
  }

  function updateStatusUI() {
    const active = currentConfig.enabled !== false;
    if (statusDot) {
      statusDot.classList.toggle('inactive', !active);
    }
    if (statusLabel) {
      statusLabel.textContent = active ? 'Active' : 'Disabled';
    }
  }

  // ─── EVENT LISTENERS ───

  masterToggle.addEventListener('change', () => {
    currentConfig.enabled = masterToggle.checked;
    saveConfig({ enabled: currentConfig.enabled });
    updateStatusUI();
  });

  timerSlider.addEventListener('input', () => {
    const val = parseInt(timerSlider.value, 10);
    timerValue.textContent = val + 's';
  });
  timerSlider.addEventListener('change', () => {
    currentConfig.autoDismissSeconds = parseInt(timerSlider.value, 10);
    saveConfig({ autoDismissSeconds: currentConfig.autoDismissSeconds });
  });

  blacklistTextarea.addEventListener('change', () => {
    const domains = blacklistTextarea.value
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
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

  // ─── REGEX PIPELINE ───
  function sanitizeRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules
      .filter(r => r && r.pattern && typeof r.pattern === 'string')
      .map(r => ({
        pattern: r.pattern,
        replacement: typeof r.replacement === 'string' ? r.replacement : '',
        flags: (r.flags || '').replace(/[^gimsuy]/g, ''),
        enabled: r.enabled !== false,
        name: typeof r.name === 'string' ? r.name : ''
      }));
  }

  function renderRegexRules() {
    regexContainer.innerHTML = '';
    const rules = currentConfig.regexPipeline || [];

    if (rules.length === 0) {
      regexContainer.innerHTML = '<p class="card-hint" style="padding:4px 0">No custom rules configured. Click "+ Rule" to add one.</p>';
      return;
    }

    rules.forEach((rule, idx) => {
      const div = document.createElement('div');
      div.className = 'regex-rule';

      div.innerHTML = `
        <div class="regex-rule-header">
          <span class="regex-rule-title">Rule ${idx + 1}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <label class="mini-toggle">
              <input type="checkbox" class="regex-enabled" data-idx="${idx}" ${rule.enabled ? 'checked' : ''}>
              <span class="mini-track"><span class="mini-thumb"></span></span>
            </label>
            <button class="btn-remove" data-idx="${idx}" title="Remove rule">&times;</button>
          </div>
        </div>
        <input type="text" class="regex-pattern" data-idx="${idx}" placeholder="Pattern (e.g. https?://\\S+)" value="${escapeAttr(rule.pattern)}">
        <div class="regex-rule-row">
          <input type="text" class="regex-replacement" data-idx="${idx}" placeholder="Replacement" value="${escapeAttr(rule.replacement || '')}">
          <input type="text" class="regex-flags" data-idx="${idx}" placeholder="Flags" value="${escapeAttr(rule.flags || 'g')}" style="width:45px;text-align:center">
        </div>
      `;

      regexContainer.appendChild(div);
    });

    regexContainer.querySelectorAll('.regex-pattern').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        currentConfig.regexPipeline[idx].pattern = e.target.value;
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
      });
    });

    regexContainer.querySelectorAll('.regex-replacement').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        currentConfig.regexPipeline[idx].replacement = e.target.value;
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
      });
    });

    regexContainer.querySelectorAll('.regex-flags').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        currentConfig.regexPipeline[idx].flags = e.target.value.replace(/[^gimsuy]/g, '');
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
      });
    });

    regexContainer.querySelectorAll('.regex-enabled').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        currentConfig.regexPipeline[idx].enabled = e.target.checked;
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
      });
    });

    regexContainer.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        currentConfig.regexPipeline.splice(idx, 1);
        saveConfig({ regexPipeline: currentConfig.regexPipeline });
        renderRegexRules();
      });
    });
  }

  btnAddRegex.addEventListener('click', () => {
    if (!currentConfig.regexPipeline) currentConfig.regexPipeline = [];
    currentConfig.regexPipeline.push({
      pattern: '',
      replacement: '',
      flags: 'g',
      enabled: true,
      name: ''
    });
    saveConfig({ regexPipeline: currentConfig.regexPipeline });
    renderRegexRules();
  });

  // ─── HISTORY ───
  function renderHistory() {
    const history = currentConfig.conversionHistory || [];
    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="history-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <p>No conversions logged</p>
          <span class="history-hint">Drag & drop files onto any webpage to begin</span>
        </div>
      `;
      return;
    }

    let html = '';
    for (let i = history.length - 1; i >= 0; i--) {
      const item = history[i];
      const time = new Date(item.timestamp);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      html += `
        <div class="history-item">
          <span class="history-file">${escapeHtml(item.file || '')}</span>
          <span class="history-ext">${(item.extension || '').toUpperCase().replace('.', '')}</span>
          <span class="history-time">${timeStr}</span>
        </div>
      `;
    }
    historyList.innerHTML = html;
  }

  btnExportHistory.addEventListener('click', () => {
    const history = currentConfig.conversionHistory || [];
    if (history.length === 0) return;
    const json = JSON.stringify(history, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'ftm-conversion-history.json', saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  btnClearHistory.addEventListener('click', () => {
    currentConfig.conversionHistory = [];
    saveConfig({ conversionHistory: [] });
    renderHistory();
  });

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

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
