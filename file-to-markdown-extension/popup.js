// ===========================================================================
// popup.js — Configuration Dashboard Logic (v7)
// ===========================================================================
//
// V7 CHANGES:
//   - Added 'images' category to checkboxes
//   - Fixed history rendering to use pure DOM methods (no innerHTML XSS)
//   - Removed version text drift (now reads from manifest)
//   - Cleaner config merge on storage change
// ===========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  let currentConfig = {};

  const DEFAULT_CONFIG = {
    enabled: true,
    autoDismissSeconds: 10,
    domainBlacklist: [],
    categories: {
      pdf: true, documents: true, spreadsheets: true,
      code: true, markup: true, presentations: true, images: true
    },
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

  // ─── VERSION DISPLAY ───
  const versionEl = document.querySelector('.version');
  if (versionEl) {
    const manifest = chrome.runtime.getManifest();
    versionEl.textContent = 'v' + manifest.version;
  }

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
  const categoryCheckboxes = ['pdf', 'documents', 'spreadsheets', 'code', 'markup', 'presentations', 'images'];

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
    // Clear container safely
    while (regexContainer.firstChild) regexContainer.removeChild(regexContainer.firstChild);

    const rules = currentConfig.regexPipeline || [];

    if (rules.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'card-hint';
      hint.style.cssText = 'padding:4px 0';
      hint.textContent = 'No custom rules configured. Click "+ Rule" to add one.';
      regexContainer.appendChild(hint);
      return;
    }

    rules.forEach((rule, idx) => {
      const div = document.createElement('div');
      div.className = 'regex-rule';

      // Header row
      const header = document.createElement('div');
      header.className = 'regex-rule-header';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'regex-rule-title';
      titleSpan.textContent = 'Rule ' + (idx + 1);

      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display:flex;align-items:center;gap:6px';

      // Toggle
      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'mini-toggle';
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.className = 'regex-enabled';
      toggleInput.dataset.idx = idx;
      toggleInput.checked = rule.enabled !== false;
      const toggleTrack = document.createElement('span');
      toggleTrack.className = 'mini-track';
      const toggleThumb = document.createElement('span');
      toggleThumb.className = 'mini-thumb';
      toggleTrack.appendChild(toggleThumb);
      toggleLabel.appendChild(toggleInput);
      toggleLabel.appendChild(toggleTrack);

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove';
      removeBtn.dataset.idx = idx;
      removeBtn.setAttribute('title', 'Remove rule');
      removeBtn.textContent = '×';

      actionsDiv.appendChild(toggleLabel);
      actionsDiv.appendChild(removeBtn);
      header.appendChild(titleSpan);
      header.appendChild(actionsDiv);

      // Pattern input
      const patternInput = document.createElement('input');
      patternInput.type = 'text';
      patternInput.className = 'regex-pattern';
      patternInput.dataset.idx = idx;
      patternInput.placeholder = 'Pattern (e.g. https?://\\S+)';
      patternInput.value = rule.pattern || '';

      // Replacement + flags row
      const ruleRow = document.createElement('div');
      ruleRow.className = 'regex-rule-row';

      const replacementInput = document.createElement('input');
      replacementInput.type = 'text';
      replacementInput.className = 'regex-replacement';
      replacementInput.dataset.idx = idx;
      replacementInput.placeholder = 'Replacement';
      replacementInput.value = rule.replacement || '';

      const flagsInput = document.createElement('input');
      flagsInput.type = 'text';
      flagsInput.className = 'regex-flags';
      flagsInput.dataset.idx = idx;
      flagsInput.placeholder = 'Flags';
      flagsInput.value = rule.flags || 'g';
      flagsInput.style.cssText = 'width:45px;text-align:center';

      ruleRow.appendChild(replacementInput);
      ruleRow.appendChild(flagsInput);

      div.appendChild(header);
      div.appendChild(patternInput);
      div.appendChild(ruleRow);
      regexContainer.appendChild(div);
    });

    // Attach event listeners
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
    // Clear container safely
    while (historyList.firstChild) historyList.removeChild(historyList.firstChild);

    const history = currentConfig.conversionHistory || [];

    if (history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '40');
      svg.setAttribute('height', '40');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.2');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '10');

      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', '12 6 12 16 14');

      svg.appendChild(circle);
      svg.appendChild(polyline);
      empty.appendChild(svg);

      const p = document.createElement('p');
      p.textContent = 'No conversions logged';
      empty.appendChild(p);

      const hint = document.createElement('span');
      hint.className = 'history-hint';
      hint.textContent = 'Drag & drop files onto any webpage to begin';
      empty.appendChild(hint);

      historyList.appendChild(empty);
      return;
    }

    for (let i = history.length - 1; i >= 0; i--) {
      const item = history[i];
      const time = new Date(item.timestamp);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const itemDiv = document.createElement('div');
      itemDiv.className = 'history-item';

      const fileSpan = document.createElement('span');
      fileSpan.className = 'history-file';
      fileSpan.textContent = item.file || '';

      const extSpan = document.createElement('span');
      extSpan.className = 'history-ext';
      extSpan.textContent = (item.extension || '').toUpperCase().replace('.', '');

      const timeSpan = document.createElement('span');
      timeSpan.className = 'history-time';
      timeSpan.textContent = timeStr;

      itemDiv.appendChild(fileSpan);
      itemDiv.appendChild(extSpan);
      itemDiv.appendChild(timeSpan);

      historyList.appendChild(itemDiv);
    }
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

  // ─── STORAGE SYNC (listen for external changes) ───
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
