// ===========================================================================
// content/converters.js — File format converters (v3.0)
// ===========================================================================

window.FTM = window.FTM || {};

FTM.sniffFileContent = function (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      for (const sig of FTM.MAGIC_SIGNATURES) {
        if (bytes.length >= sig.bytes.length && sig.bytes.every((b, i) => bytes[i] === b)) {
          reject(new Error('Detected ' + sig.name + ' signature in "' + file.name + '"'));
          return;
        }
      }
      const nulls = Array.from(bytes).filter(b => b === 0x00).length;
      if (nulls > 3) reject(new Error('Binary data in "' + file.name + '" (' + nulls + ' null bytes)'));
      else resolve(bytes);
    };
    reader.onerror = () => reject(new Error('Failed to sniff: ' + file.name));
    reader.readAsArrayBuffer(file.slice(0, 128));
  });
};

FTM.processTextFile = async function (file, ext) {
  const C = FTM.CONSTANTS;
  if (file.size > C.MAX_TEXT_READ_SIZE_BYTES) throw new Error('File too large: ' + FTM.formatBytes(file.size));
  if (file.size > C.SNIFF_THRESHOLD_BYTES) await FTM.sniffFileContent(file);
  const text = await FTM.readFileAsText(file);
  if (ext === '.json') return FTM.formatJsonAsMarkdown(text, file.name);
  return '# ' + file.name + '\n\n```' + FTM.getLanguageTag(ext) + '\n' + text + '\n```';
};

FTM.formatJsonAsMarkdown = function (text, fileName) {
  try { return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n```json\n' + JSON.stringify(JSON.parse(text), null, 2) + '\n```'; }
  catch (_) { return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n```json\n' + text + '\n```'; }
};

FTM.processCsvFile = async function (file) {
  const threshold = (FTM.config.csvStreamThreshold || FTM.CONSTANTS.CSV_STREAM_THRESHOLD_MB_DEFAULT) * FTM.CONSTANTS.MB;
  if (file.size < threshold) return FTM.csvTextToMarkdown(await FTM.readFileAsText(file));
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
  return FTM.buildMarkdownTable(lines.filter(l => l.trim()).map(l => FTM.parseCsvLine(l).map(FTM.sanitizeCsvCell)), '# CSV Data');
};

FTM.parseCsvLine = function (line) {
  const cells = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
};

FTM.streamCsvToMarkdown = async function (file) {
  await FTM.loadPapaParse();
  const chunks = [];
  let rowCount = 0, isFirstRow = true, maxCols = 0;

  return new Promise((resolve, reject) => {
    Papa.parse(file.stream(), {
      worker: false, streaming: true,
      chunk(results) {
        for (const row of results.data) {
          if (!row || (row.length === 1 && row[0] === '')) continue;
          if (rowCount >= FTM.CONSTANTS.MAX_CSV_ROWS) { results.abort(); return; }
          const cells = row.map(c => FTM.sanitizeCsvCell(c).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' '));
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
      },
      complete() { resolve('# CSV Data (Streamed)\n\n' + chunks.join('')); },
      error(err) { reject(new Error('Stream CSV failed: ' + err.message)); }
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
    timeout = setTimeout(() => reject(new Error('Papa Parse load timeout')), FTM.CONSTANTS.SCRIPT_LOAD_TIMEOUT_MS);
    document.head.appendChild(script);
  });
};

FTM.readRtfFile = async function (file) {
  const text = await FTM.readFileAsText(file);
  const cleaned = text
    .replace(/\\obj(?=.*?})[\s\S]*?}/g, '')
    .replace(/\\pict[\s\S]*?}/g, '')
    .replace(/\\bin[\s\S]*?}/g, '')
    .replace(/\\u(-?\d+)\??/g, (_, code) => { const n = parseInt(code, 10); return n >= 0 && n <= 65535 ? String.fromCharCode(n) : '?'; })
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par\s*/g, '\n').replace(/\\line\s*/g, '\n').replace(/\\tab\s*/g, '\t')
    .replace(/\\[a-z]+\s?-?\d+;?/g, '').replace(/\\[a-z]+\s?/g, '')
    .replace(/[{}]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return '# ' + file.name.replace(/\.[^.]+$/, '') + '\n\n' + cleaned;
};

FTM.processImageFile = function (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const title = file.name.replace(/\.[^.]+$/, '');
      resolve('# ' + title + '\n\n![' + title + '](' + reader.result + ')\n\n*Size: ' + FTM.formatBytes(file.size) + '*\n');
    };
    reader.onerror = () => reject(new Error('Failed to read image: ' + file.name));
    reader.readAsDataURL(file);
  });
};
