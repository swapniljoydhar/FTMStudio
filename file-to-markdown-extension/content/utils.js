// ===========================================================================
// content/utils.js — Pure utility functions
// ===========================================================================

window.FTM = window.FTM || {};

FTM.getExtension = function (filename) {
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.substring(idx) : '';
};

FTM.formatBytes = function (bytes) {
  if (bytes < FTM.CONSTANTS.KB) return bytes + ' B';
  if (bytes < FTM.CONSTANTS.MB) return (bytes / FTM.CONSTANTS.KB).toFixed(1) + ' KB';
  return (bytes / FTM.CONSTANTS.MB).toFixed(1) + ' MB';
};

FTM.getLanguageTag = function (ext) {
  const map = {
    '.txt': 'text', '.md': 'markdown', '.py': 'python', '.js': 'javascript',
    '.cpp': 'cpp', '.css': 'css', '.json': 'json', '.xml': 'xml',
    '.html': 'html', '.csv': 'csv'
  };
  return map[ext] || '';
};

FTM.readFileAsText = function (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read: ' + file.name));
    reader.readAsText(file, 'UTF-8');
  });
};

FTM.isBlacklisted = function () {
  try {
    const hostname = window.location.hostname.toLowerCase();
    const list = FTM.config.domainBlacklist;
    if (list && list.length > 0) {
      for (const domain of list) {
        const trimmed = domain.trim().toLowerCase();
        if (!trimmed) continue;
        if (hostname === trimmed || hostname.endsWith('.' + trimmed)) return true;
      }
    }
  } catch (e) { /* cross-origin */ }
  return false;
};

/**
 * Smart Mode activation check.
 * - Smart Mode OFF: activate everywhere (unless blacklisted)
 * - Smart Mode ON: only activate on AI sites + user-whitelisted sites
 */
FTM.shouldActivate = function () {
  if (FTM.isBlacklisted()) return false;
  if (!FTM.config.smartMode) return true;

  try {
    const hostname = window.location.hostname.toLowerCase();

    // Check user whitelist
    const wl = FTM.config.domainWhitelist;
    if (wl && wl.length > 0) {
      for (const domain of wl) {
        const trimmed = domain.trim().toLowerCase();
        if (!trimmed) continue;
        if (hostname === trimmed || hostname.endsWith('.' + trimmed)) return true;
      }
    }

    // Check built-in AI hosts
    for (const ai of FTM.AI_HOSTS) {
      if (hostname === ai || hostname.endsWith('.' + ai)) return true;
    }

    return false;
  } catch (e) { /* cross-origin — default to activate */
    return true;
  }
};

FTM.shouldInterceptFile = function (file) {
  const ext = FTM.getExtension(file.name).toLowerCase();
  const category = FTM.EXTENSION_MAP[ext];
  if (!category) return false;
  if (!FTM.config.categories || !FTM.config.categories[category]) return false;
  return true;
};

FTM.sanitizeCsvCell = function (value) {
  if (typeof value !== 'string') value = String(value ?? '');
  if (/^[=+\-@]/.test(value)) return "'" + value;
  return value;
};

FTM.buildMarkdownTable = function (rows, title) {
  if (rows.length === 0) return title + '\n\n*No data*';
  const maxCols = Math.max(...rows.map(r => r.length));
  const normalized = rows.map(r => {
    while (r.length < maxCols) r.push('');
    return r.map(c => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' '));
  });
  const header = '| ' + normalized[0].join(' | ') + ' |';
  const separator = '| ' + normalized[0].map(() => '---').join(' | ') + ' |';
  const body = normalized.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n');
  return title + '\n\n' + header + '\n' + separator + '\n' + body;
};
