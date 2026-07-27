// ===========================================================================
// shared/text.js — Pure, side-effect-free text helpers (no DOM, no chrome.*)
// Used identically by content scripts, service worker and offscreen document,
// so CSV/YAML/table/RTF behaviour can never diverge between contexts again.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  const LANGUAGE_TAGS = {
    '.txt': 'text', '.md': 'markdown', '.py': 'python', '.js': 'javascript',
    '.cpp': 'cpp', '.css': 'css', '.json': 'json', '.xml': 'xml', '.html': 'html', '.csv': 'csv'
  };

  // Only these escapes are legal inside a double-quoted YAML scalar.
  const YAML_ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

  const T = {
    getExtension(filename) {
      const idx = String(filename).lastIndexOf('.');
      return idx !== -1 ? String(filename).substring(idx) : '';
    },

    stem(filename) {
      return String(filename).replace(/\.[^.]+$/, '');
    },

    formatBytes(bytes) {
      const { KB, MB } = FTM.CONSTANTS;
      if (bytes < KB) return bytes + ' B';
      if (bytes < MB) return (bytes / KB).toFixed(1) + ' KB';
      return (bytes / MB).toFixed(1) + ' MB';
    },

    getLanguageTag(ext) {
      return LANGUAGE_TAGS[ext] || '';
    },

    // Strips control characters so a hostile filename cannot inject extra
    // Markdown blocks (or extra YAML lines) into the generated document.
    plain(value) {
      return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    },

    yamlString(value) {
      const escaped = String(value).replace(/[\\"\u0000-\u001f\u007f]/g, (ch) =>
        YAML_ESCAPES[ch] || '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
      return '"' + escaped + '"';
    },

    // Spreadsheet formula injection: Excel/Sheets/LibreOffice ignore leading
    // whitespace, tabs and CRs before evaluating, so the guard must too.
    sanitizeCsvCell(value) {
      const s = value == null ? '' : String(value);
      return /^[\s\u0000-\u001f]*[=+\-@|\t\r]/.test(s) ? "'" + s : s;
    },

    // Single-pass cell escaping (was three chained regex scans per cell).
    escapeCell(value) {
      const s = value == null ? '' : String(value);
      return s.replace(/\\|\||[\r\n]+/g, (m) => (m === '\\' ? '\\\\' : m === '|' ? '\\|' : ' '));
    },

    sanitizeAndEscapeCell(value) {
      return this.escapeCell(this.sanitizeCsvCell(value));
    },

    widestRow(rows) {
      let cols = 0;
      for (const row of rows) if (row && row.length > cols) cols = row.length;
      return cols;
    },

    tableLine(cells, cols, escape) {
      let line = '|';
      for (let i = 0; i < cols; i++) line += ' ' + escape(cells ? cells[i] : '') + ' |';
      return line;
    },

    separatorLine(cols) {
      let line = '|';
      for (let i = 0; i < cols; i++) line += ' --- |';
      return line;
    },

    // O(N*C) time, O(1) auxiliary space, and no argument spreading (the old
    // Math.max(...rows) threw RangeError above ~125k rows).
    markdownTable(rows, title, escape) {
      if (!rows || rows.length === 0) return title + '\n\n*No data*';
      const esc = escape || ((v) => this.sanitizeAndEscapeCell(v));
      const cols = this.widestRow(rows);
      const out = [this.tableLine(rows[0], cols, esc), this.separatorLine(cols)];
      for (let i = 1; i < rows.length; i++) out.push(this.tableLine(rows[i], cols, esc));
      return title + '\n\n' + out.join('\n');
    },

    rtfToMarkdown(text) {
      return String(text)
        .replace(/\\obj[\s\S]*?}/g, '')
        .replace(/\\pict[\s\S]*?}/g, '')
        .replace(/\\bin[\s\S]*?}/g, '')
        .replace(/\\u(-?\d+)\??/g, (_, code) => {
          const n = parseInt(code, 10);
          return n >= 0 && n <= 65535 ? String.fromCharCode(n) : '?';
        })
        .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\par\s*/g, '\n').replace(/\\line\s*/g, '\n').replace(/\\tab\s*/g, '\t')
        .replace(/\\[a-z]+\s?-?\d+;?/g, '').replace(/\\[a-z]+\s?/g, '')
        .replace(/[{}]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    },

    magicSignature(bytes) {
      for (const sig of FTM.MAGIC_SIGNATURES) {
        if (bytes.length >= sig.bytes.length && sig.bytes.every((b, i) => bytes[i] === b)) return sig.name;
      }
      return null;
    },

    countNullBytes(bytes) {
      let n = 0;
      for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x00) n++;
      return n;
    },

    // --- Chunked base64 transport codec ------------------------------------
    // chrome.runtime ports are JSON channels: ArrayBuffers serialise to {} and
    // transfer lists are ignored, so bytes travel as sized base64 chunks.
    toBase64(view) {
      let s = '';
      for (let i = 0; i < view.length; i += 0x8000) {
        s += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
      }
      return btoa(s);
    },

    fromBase64(str) {
      const bin = atob(str);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },

    encodeChunks(bytes, chunkSize) {
      const size = chunkSize || FTM.CONSTANTS.TRANSFER_CHUNK_BYTES;
      const chunks = [];
      for (let off = 0; off < bytes.length; off += size) {
        chunks.push(this.toBase64(bytes.subarray(off, Math.min(off + size, bytes.length))));
      }
      return chunks.length ? chunks : [''];
    },

    decodeChunks(chunks) {
      const parts = chunks.map((c) => this.fromBase64(c));
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      return out;
    },

    // --- History merging ---------------------------------------------------
    // Union of stored and in-memory entries so concurrent tabs cannot wipe
    // each other's history (the old code overwrote the whole array).
    mergeHistory(stored, local, max) {
      const seen = new Map();
      for (const entry of [...(Array.isArray(stored) ? stored : []), ...(Array.isArray(local) ? local : [])]) {
        if (entry && entry.timestamp) seen.set(entry.timestamp + '\u0000' + entry.file, entry);
      }
      const all = [...seen.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
      return max > 0 && all.length > max ? all.slice(all.length - max) : all;
    }
  };

  FTM.text = T;
})();
