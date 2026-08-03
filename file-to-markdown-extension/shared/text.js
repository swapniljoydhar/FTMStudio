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

  const YAML_ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

  // Windows CP1252 codepage mapping for bytes 0x80-0x9F.
  const CP1252 = [
    0x20AC, 0x003F, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x003F, 0x017D, 0x003F,
    0x003F, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x003F, 0x017E, 0x0178
  ];

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

    plain(value) {
      return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    },

    yamlString(value) {
      const escaped = String(value).replace(/[\\"\u0000-\u001f\u007f]/g, (ch) =>
        YAML_ESCAPES[ch] || '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
      return '"' + escaped + '"';
    },

    // Formula injection: wrap risky cells in backticks instead of ' prefix.
    // Backticks render as code spans in markdown — neutralizes formulas
    // without corrupting real data (e.g. +880 phone numbers).
    sanitizeCsvCell(value) {
      const s = value == null ? '' : String(value);
      return /^[\s\u0000-\u001f]*[=+\-@|\t\r]/.test(s) ? '`' + s + '`' : s;
    },

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
      for (let j = 0; j < cols; j++) line += ' ' + escape(cells ? cells[j] : '') + ' |';
      return line;
    },

    separatorLine(cols) {
      let line = '|';
      for (let j = 0; j < cols; j++) line += ' --- |';
      return line;
    },

    markdownTable(rows, title, escape) {
      if (!rows || rows.length === 0) return title + '\n\n*No data*';
      const esc = escape || ((v) => this.sanitizeAndEscapeCell(v));
      const cols = this.widestRow(rows);
      const out = [this.tableLine(rows[0], cols, esc), this.separatorLine(cols)];
      for (let j = 1; j < rows.length; j++) out.push(this.tableLine(rows[j], cols, esc));
      return title + '\n\n' + out.join('\n');
    },

    // ── RTF parser ─────────────────────────────────────────────────────
    // Character-by-character state machine that correctly handles:
    //   - Nested groups {\\rtf1 {\\b bold} text}
    //   - Multi-entry groups like \\fonttbl{...}{...}
    //   - Unicode escapes (\\uN), hex escapes (\\'xx), CP1252
    //   - Skips non-content destinations (\\fonttbl, \\pict, etc.)
    //   - Bold/italic → **bold** / *italic*
    //
    // Memory: output string grows incrementally; no intermediate copies.
    // Peak ~ output size + O(group depth).
    // The state-machine implementation is intentionally kept contiguous for parser parity.
    // eslint-disable-next-line max-lines-per-function
    rtfToMarkdown(text) {
      const src = String(text);
      const len = src.length;
      let i = 0;
      let out = '';
      let ws = false;       // collapse whitespace
      let bold = false;
      let italic = false;
      const stack = [];     // [{ws, bold, italic}] per group depth
      let activeBold = false;
      let activeItalic = false;
      let tokenCount = 0;

      function consumeToken() {
        tokenCount++;
        if (tokenCount > FTM.CONSTANTS.MAX_RTF_TOKENS) throw new Error('RTF input exceeds the parser token limit.');
      }

      // Control words that produce output.
      const WORDS = {
        par: '\n', line: '\n', tab: '\t', bullet: '- ',
        emdash: '\u2014', endash: '\u2013',
        ldblquote: '\u201c', rdblquote: '\u201d',
        lquote: '\u2018', rquote: '\u2019'
      };

      // Control words whose entire group should be skipped.
      // When one of these is encountered, skipGroup() consumes from the
      // current { to its matching }, including all nested groups.
      const SKIP = new Set([
        'fonttbl', 'colortbl', 'stylesheet', 'stylerw',
        'pict', 'object', 'mbinary', 'bin',
        'filetbl', 'revtbl', 'listtable', 'listoverridetable',
        'rsidtbl', 'protusertbl', 'generator', 'xmlnstbl',
        'pnseclvl', 'themedata', 'datastore', 'latentstyles'
      ]);

      function push() {
        if (stack.length >= FTM.CONSTANTS.MAX_RTF_GROUP_DEPTH) throw new Error('RTF nesting exceeds the parser depth limit.');
        stack.push({ ws, bold, italic });
      }

      function pop() {
        if (stack.length) {
          const s = stack.pop();
          ws = s.ws; bold = s.bold; italic = s.italic;
        }
      }

      // Close/open formatting markers around whitespace.
      function flush() {
        if (activeItalic && !italic) { out += '*'; activeItalic = false; }
        if (activeBold && !bold) { out += '**'; activeBold = false; }
        if (ws) { out += ' '; ws = false; }
        if (bold && !activeBold) { out += '**'; activeBold = true; }
        if (italic && !activeItalic) { out += '*'; activeItalic = true; }
      }

      function append(ch) {
        if (ch === ' ' || ch === '\t') { ws = true; return; }
        flush();
        out += ch;
      }

      // Skip from the current { to its matching }, handling nested groups.
      // For multi-entry destinations like \fonttbl{...}{...}, consumes
      // ALL consecutive groups.
      function skipGroup() {
        do {
          let depth = 0;
          while (i < len) {
            consumeToken();
            const c = src[i]; i++;
            if (c === '{') {
              depth++;
              if (depth > FTM.CONSTANTS.MAX_RTF_GROUP_DEPTH) throw new Error('RTF nesting exceeds the parser depth limit.');
            }
            else if (c === '}') { depth--; if (depth <= 0) break; }
          }
          // Skip whitespace between consecutive groups.
          while (i < len && (src[i] === ' ' || src[i] === '\r' || src[i] === '\n')) i++;
        } while (i < len && src[i] === '{');
      }

      while (i < len) {
        consumeToken();
        const ch = src[i];

        if (ch === '\\') {
          i++;
          if (i >= len) break;

          // Escaped special characters: \\ \{ \}
          if (src[i] === '\\' || src[i] === '{' || src[i] === '}') {
            append(src[i]); i++; continue;
          }

          // Hex escape: \'xx
          if (src[i] === "'") {
            const hex = src.substring(i + 1, i + 3);
            if (/^[0-9a-fA-F]{2}$/.test(hex)) {
              const code = parseInt(hex, 16);
              if (code >= 0x80 && code <= 0x9f) {
                append(String.fromCharCode(CP1252[code - 0x80]));
              } else {
                append(String.fromCharCode(code));
              }
              i += 3;
              continue;
            }
          }

          // Unicode escape: \uN?
          if (src[i] === 'u') {
            i++;
            let num = '';
            let neg = false;
            if (i < len && src[i] === '-') { neg = true; i++; }
            while (i < len && src[i] >= '0' && src[i] <= '9') { num += src[i]; i++; }
            if (num) {
              let code = parseInt(num, 10);
              if (neg) code = 65536 + code;
              if (code >= 0 && code <= 65535) append(String.fromCharCode(code));
              if (i < len && src[i] === '?') i++;
              continue;
            }
          }

          // Control word.
          let word = '';
          while (i < len && src[i] >= 'a' && src[i] <= 'z') { word += src[i]; i++; }

          // Skip optional numeric parameter.
          let numStr = '';
          let neg = false;
          if (i < len && src[i] === '-') { neg = true; i++; }
          while (i < len && src[i] >= '0' && src[i] <= '9') { numStr += src[i]; i++; }
          // Skip delimiter space (but not after \u which uses ?).
          if (i < len && src[i] === ' ' && word !== 'u') i++;

          if (!word) continue;

          // Skip non-content destination groups entirely.
          // skipGroup() consumes from the current { to its matching }.
          if (SKIP.has(word)) { skipGroup(); continue; }
          if (word === '*') continue;

          // Formatting toggles.
          if (word === 'b') { bold = !neg && numStr !== '0'; continue; }
          if (word === 'i') { italic = !neg && numStr !== '0'; continue; }

          // Skip formatting-only words with no text output.
          if (word === 'ul' || word === 'ulw' || word === 'uldb' || word === 'uls') continue;
          if (word === 'strike' || word === 'strikedl') continue;
          if (word === 'sub' || word === 'super' || word === 'nosupersub') continue;
          if (word === 'fs' || word === 'f' || word === 'af') continue;
          if (word === 'cf' || word === 'cb' || word === 'chcbpat' || word === 'highlight') continue;
          if (word === 'lang' || word === 'loch' || word === 'hich' || word === 'dbch') continue;
          if (word === 'uc' || word === 'up' || word === 'dn') continue;
          if (word === 'expnd' || word === 'expndtw' || word === 'kerning' || word === 'charscalex') continue;
          if (word === 'ansi' || word === 'mac' || word === 'pc' || word === 'pca') continue;
          if (word === 'ansicpg' || word === 'cpg') continue;
          if (word === 'deff' || word === 'deflang') continue;
          if (word === 'paperw' || word === 'paperh' || word === 'margl' || word === 'margr') continue;
          if (word === 'margt' || word === 'margb') continue;
          if (word === 'sectd' || word === 'sect' || word === 'sbknone' || word === 'sbkpage' || word === 'sbkcol') continue;
          if (word === 'pard' || word === 'pardeftab' || word === 'widowctrl') continue;
          if (word === 'ftnsep' || word === 'ftnsepc' || word === 'ftncn') continue;
          if (word === 'aftnsep' || word === 'aftnsepc' || word === 'aftncn') continue;
          if (word === 'field' || word === 'fldinst' || word === 'fldrslt') continue;

          // Skip entire groups for headers, footers, metadata, shapes.
          if (word === 'header' || word === 'footer' || word === 'headerf' || word === 'footerf') { skipGroup(); continue; }
          if (word === 'info' || word === 'title' || word === 'author' || word === 'operator') { skipGroup(); continue; }
          if (word === 'company' || word === 'creatim' || word === 'revtim' || word === 'printim' || word === 'buptim') { skipGroup(); continue; }
          if (word === 'shp' || word === 'shptxt' || word === 'sp') { skipGroup(); continue; }

          // Output-producing control words.
          const replacement = WORDS[word];
          if (replacement) {
            if (replacement === '\n') ws = false;
            flush();
            out += replacement;
            ws = false;
            continue;
          }

          // Unknown control word — skip silently.
          continue;
        }

        if (ch === '{') { push(); i++; continue; }
        if (ch === '}') { pop(); i++; continue; }
        if (ch === '\n' || ch === '\r') { i++; continue; }

        // Regular text character.
        append(ch);
        i++;
      }

      // Close any open formatting.
      if (activeItalic) out += '*';
      if (activeBold) out += '**';

      return out.replace(/\n{3,}/g, '\n\n').trim();
    },

    // Fully decode HTML entities, including double-encoded ones.
    // Loops until stable (max 5 iterations): &amp;amp; → &amp; → &
    decodeHtmlEntities(text) {
      let prev = '';
      let result = String(text);
      const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
      const re = /&(?:amp|lt|gt|quot|apos|#39|#x27|#x60|nbsp);/gi;
      for (let i = 0; i < 5 && result !== prev; i++) {
        prev = result;
        result = result.replace(re, (m) => entities[m.toLowerCase()] || m);
      }
      return result;
    },

    magicSignature(bytes) {
      for (const sig of FTM.MAGIC_SIGNATURES) {
        if (bytes.length >= sig.bytes.length && sig.bytes.every((b, j) => bytes[j] === b)) return sig.name;
      }
      return null;
    },

    countNullBytes(bytes) {
      let n = 0;
      for (let j = 0; j < bytes.length; j++) if (bytes[j] === 0x00) n++;
      return n;
    },

    toBase64(view) {
      let s = '';
      for (let j = 0; j < view.length; j += 0x8000) {
        s += String.fromCharCode.apply(null, view.subarray(j, j + 0x8000));
      }
      return btoa(s);
    },

    fromBase64(str) {
      const bin = atob(str);
      const out = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
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

    mergeHistory(stored, local, max) {
      const seen = new Map();
      for (const entry of [...(Array.isArray(stored) ? stored : []), ...(Array.isArray(local) ? local : [])]) {
        if (entry && entry.timestamp) { const k = entry.timestamp + '\u0000' + entry.file + '\u0000' + (entry.uid || ''); seen.set(k, entry); }
      }
      const all = [...seen.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
      return max > 0 && all.length > max ? all.slice(all.length - max) : all;
    }
  };

  FTM.text = T;
})();
