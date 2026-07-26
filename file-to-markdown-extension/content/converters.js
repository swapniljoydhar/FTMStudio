// ===========================================================================
// content/converters.js — File format converters (text, CSV, RTF)
// ===========================================================================

window.FTM = window.FTM || {};

// ---------------------------------------------------------------------------
// Content Sniffing
// ---------------------------------------------------------------------------
FTM.sniffFileContent = function (file) {
  return new Promise((resolve, reject) => {
    const slice = file.slice(0, 128);
    const reader = new FileReader();

    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);

      for (const sig of FTM.MAGIC_SIGNATURES) {
        if (bytes.length >= sig.bytes.length) {
          const match = sig.bytes.every((b, i) => bytes[i] === b);
          if (match) {
            reject(new Error('Content sniffing detected ' + sig.name + ' signature in "' + file.name + '". Aborted.'));
            return;
          }
        }
      }

      const nullBytes = Array.from(bytes).filter(b => b === 0x00).length;
      if (nullBytes > 3) {
        reject(new Error('Content sniffing detected binary data in "' + file.name + '" (' + nullBytes + ' null bytes). Aborted.'));
      } else {
        resolve(bytes);
      }
    };

    reader.onerror = () => reject(new Error('Failed to sniff file: ' + file.name));
    reader.readAsArrayBuffer(slice);
  });
};

// ---------------------------------------------------------------------------
// Text Files
// ---------------------------------------------------------------------------
FTM.processTextFile = async function (file, ext) {
  const fileName = file.name;
  const C = FTM.CONSTANTS;

  if (file.size > C.MAX_TEXT_READ_SIZE_BYTES) {
    throw new Error('File "' + fileName + '" is too large (' + FTM.formatBytes(file.size) + '). Max: ' + FTM.formatBytes(C.MAX_TEXT_READ_SIZE_BYTES) + '.');
  }

  if (file.size > C.SNIFF_THRESHOLD_BYTES) {
    try {
      await FTM.sniffFileContent(file);
    } catch (err) {
      console.warn('[FTM]', err.message);
      throw new Error('File "' + fileName + '" appears to be binary. Cannot process as text.');
    }
  }

  const text = await FTM.readFileAsText(file);
  if (ext === '.json') return FTM.formatJsonAsMarkdown(text, fileName);
  const lang = FTM.getLanguageTag(ext);
  return '# ' + fileName + '\n\n```' + lang + '\n' + text + '\n```';
};

FTM.formatJsonAsMarkdown = function (text, fileName) {
  try {
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n```json\n' + pretty + '\n```';
  } catch {
    return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n```json\n' + text + '\n```';
  }
};

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
FTM.processCsvFile = async function (file) {
  const threshold = (FTM.config.csvStreamThreshold || FTM.CONSTANTS.CSV_STREAM_THRESHOLD_MB_DEFAULT) * FTM.CONSTANTS.MB;
  if (file.size < threshold) {
    const text = await FTM.readFileAsText(file);
    return FTM.csvTextToMarkdown(text);
  }
  console.log('[FTM] Large CSV (' + FTM.formatBytes(file.size) + '). Using Stream API.');
  return FTM.streamCsvToMarkdown(file);
};

FTM.csvTextToMarkdown = function (text) {
  if (typeof Papa !== 'undefined') {
    const result = Papa.parse(text, { skipEmptyLines: true });
    if (result.data.length === 0) return '# CSV Data\n\n```\n' + text + '\n```';
    return FTM.buildMarkdownTable(result.data.map(r => r.map(FTM.sanitizeCsvCell)), '# CSV Data');
  }
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return '# CSV Data\n\n```\n' + text + '\n```';
  const rows = lines.filter(l => l.trim()).map(l => FTM.parseCsvLine(l).map(FTM.sanitizeCsvCell));
  return FTM.buildMarkdownTable(rows, '# CSV Data');
};

FTM.parseCsvLine = function (line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
};

FTM.streamCsvToMarkdown = async function (file) {
  await FTM.loadPapaParse();
  const chunks = [];
  let rowCount = 0;
  let isFirstRow = true;
  let maxCols = 0;

  return new Promise((resolve, reject) => {
    Papa.parse(file.stream(), {
      worker: false,
      streaming: true,
      chunk: function (results) {
        const data = results.data;
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          if (!row || (row.length === 1 && row[0] === '')) continue;
          if (rowCount >= FTM.CONSTANTS.MAX_CSV_ROWS) return;

          const cells = row.map(c => {
            const raw = String(c !== null && c !== undefined ? c : '');
            const sanitized = /^[=+\-@]/.test(raw) ? "'" + raw : raw;
            return sanitized.replace(/\|/g, '\\|').replace(/\n/g, ' ');
          });

          if (cells.length > maxCols) maxCols = cells.length;
          if (isFirstRow) {
            chunks.push('| ' + cells.join(' | ') + ' |\n| ' + cells.map(() => '---').join(' | ') + ' |\n');
            isFirstRow = false;
          } else {
            while (cells.length < maxCols) cells.push('');
            chunks.push('| ' + cells.join(' | ') + ' |\n');
          }
          rowCount++;
        }
        if (rowCount >= FTM.CONSTANTS.MAX_CSV_ROWS) results.abort();
      },
      complete: () => resolve('# CSV Data (Streamed)\n\n' + chunks.join('')),
      error: (err) => reject(new Error('Stream CSV failed: ' + err.message))
    });
  });
};

FTM.loadPapaParse = function () {
  if (typeof Papa !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/papaparse.min.js');
    let timeout = null;
    script.onload = () => { if (timeout) clearTimeout(timeout); resolve(); };
    script.onerror = () => { if (timeout) clearTimeout(timeout); reject(new Error('Failed to load Papa Parse')); };
    timeout = setTimeout(() => script.onerror(new Error('Papa Parse load timeout')), FTM.CONSTANTS.SCRIPT_LOAD_TIMEOUT_MS);
    document.head.appendChild(script);
  });
};

// ---------------------------------------------------------------------------
// RTF
// ---------------------------------------------------------------------------
FTM.readRtfFile = async function (file) {
  const text = await FTM.readFileAsText(file);
  let cleaned = text
    .replace(/\\obj(?=.*?})[\s\S]*?}/g, '')
    .replace(/\\pict[\s\S]*?}/g, '')
    .replace(/\\bin[\s\S]*?}/g, '')
    .replace(/\\[a-z]+\s?-?\d+;?/g, '')
    .replace(/\\[a-z]+\s?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\u(-?\d+)\??/g, (_, code) => {
      const n = parseInt(code, 10);
      return n >= 0 && n <= 65535 ? String.fromCharCode(n) : '?';
    })
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par\s*/g, '\n')
    .replace(/\\line\s*/g, '\n')
    .replace(/\\tab\s*/g, '\t')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return '# ' + file.name.replace(/\.[^.]+$/, '') + '\n\n' + cleaned;
};
