// ===========================================================================
// offscreen/documents.js — DOCX, PDF and spreadsheet parsers
// ===========================================================================

'use strict';

(() => {
  const FTM = self.FTM || {};
  const T = FTM.text;

  // Max embedded image size (raw bytes) — skip larger images to avoid
  // bloating the Markdown output and blowing up RAM via base64 encoding.
  const MAX_EMBED_IMAGE_BYTES = 2 * 1024 * 1024;

  // Y-position tolerance for clustering text items into visual lines.
  // Items within this many pixels of each other are considered same-line.
  const LINE_TOLERANCE = 4;

  // Minimum rows / columns to consider a text cluster a table.
  const TABLE_MIN_ROWS = 3;
  const TABLE_MIN_COLS = 2;

  // ── DOCX ────────────────────────────────────────────────────────────

  function docxImageConverter(images, imageMode, mammoth) {
    return mammoth.images.imgElement((img) => {
      if (imageMode === 'placeholder') return { src: '', alt: '[Image]' };
      return img.read('base64').then((b64) => {
        if (b64.length * 0.75 > MAX_EMBED_IMAGE_BYTES) return { src: '', alt: '[Image — too large to embed]' };
        const src = 'data:' + (img.contentType || 'image/png') + ';base64,' + b64;
        images.push(src);
        return { src, alt: 'Image ' + images.length };
      });
    });
  }

  function appendDocxImages(markdown, images) {
    if (!images.length) return markdown;
    let result = markdown + '\n\n---\n\n## Embedded Images\n\n';
    for (let i = 0; i < images.length; i++) result += '![Image ' + (i + 1) + '](' + images[i] + ')\n\n';
    return result;
  }

  async function parseDocx(bytes, meta) {
    const mammoth = await FTM.libs.get('mammoth');
    const imageMode = (FTM.config && FTM.config.imageMode) || 'embedded';
    const images = [];
    const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer }, {
      convertImage: docxImageConverter(images, imageMode, mammoth)
    });
    const html = result.value || '';
    const turndown = await FTM.libs.turndown();
    const markdown = appendDocxImages(turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim(), images);
    return '# ' + T.plain(T.stem(meta.fileName)) + '\n\n' + markdown;
  }

  // ── Spreadsheet helpers ─────────────────────────────────────────────

  function headerIndex(rows) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].some((cell) => cell !== '' && cell != null)) return i;
    }
    return 0;
  }

  function sheetToMarkdown(rows, sheetName, multiple) {
    const start = headerIndex(rows);
    const body = rows.slice(start).filter(Boolean);
    if (body.length === 0 || !body[0].length) return '';
    const heading = multiple ? '## ' + T.plain(sheetName) + '\n\n' : '';
    return heading + T.markdownTable(body, '', (v) => T.sanitizeAndEscapeCell(v)).replace(/^\n\n/, '') + '\n\n';
  }

  async function parseSpreadsheet(bytes, meta) {
    const XLSX = await FTM.libs.get('xlsx');
    const workbook = XLSX.read(bytes, { type: 'array' });
    const parts = ['# ' + T.plain(T.stem(meta.fileName)) + '\n\n'];
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
      if (rows && rows.length) parts.push(sheetToMarkdown(rows, sheetName, workbook.SheetNames.length > 1));
    }
    return parts.join('');
  }

  // ── PDF layout-aware text extraction ────────────────────────────────

  /**
   * Cluster text items by Y position into visual lines.
   * Items whose rounded Y values are within LINE_TOLERANCE of each other
   * are grouped into the same row.  Within a row, items are sorted by X.
   *
   * This correctly handles multi-column layouts (items from different
   * columns on the same visual line stay together, read left→right) and
   * table rows (cells on the same row are grouped).
   */
  function clusterLines(textContent) {
    const items = textContent.items
      .filter((item) => item && item.str && item.str.trim())
      .map((item) => {
        const tr = Array.isArray(item.transform) && item.transform.length >= 6
          ? item.transform : [1, 0, 0, 1, 0, 0];
        return { str: item.str, x: tr[4], y: Math.round(tr[5]), w: item.width || 0 };
      });

    if (!items.length) return [];

    // Sort by Y descending (PDF origin is bottom-left), then X ascending.
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // Cluster into lines by Y proximity.
    const lines = [];
    let row = [items[0]];
    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].y - row[0].y) <= LINE_TOLERANCE) {
        row.push(items[i]);
      } else {
        lines.push(row);
        row = [items[i]];
      }
    }
    lines.push(row);

    // Sort items within each row by X position.
    for (const r of lines) r.sort((a, b) => a.x - b.x);
    return lines;
  }

  /**
   * Detect whether a group of visual lines forms a table.
   *
   * Heuristic: if enough lines share the same set of column X-positions
   * (within tolerance), it's a table.  Returns column boundary X values
   * or null if no table is detected.
   */
  function detectTableColumns(lines) {
    if (lines.length < TABLE_MIN_ROWS) return null;

    // For each line, collect the X positions of item starts.
    // Round to 30px grid to tolerate slight alignment drift.
    const xPositions = lines.map((row) => row.map((item) => Math.round(item.x / 30) * 30));
    const uniqueCols = new Set();
    for (const xs of xPositions) for (const x of xs) uniqueCols.add(x);

    // A table needs at least 2 distinct column positions shared across rows.
    if (uniqueCols.size < TABLE_MIN_COLS) return null;

    // Count how many rows have items at each column position.
    const colCounts = new Map();
    for (const x of uniqueCols) {
      let count = 0;
      for (const xs of xPositions) {
        if (xs.some((v) => Math.abs(v - x) <= 30)) count++;
      }
      colCounts.set(x, count);
    }

    // A column must appear in at least 70% of rows to be considered shared.
    // This prevents natural text indentation from being misidentified.
    const threshold = Math.ceil(lines.length * 0.7);
    const sharedCols = [...colCounts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([x]) => x)
      .sort((a, b) => a - b);

    return sharedCols.length >= TABLE_MIN_COLS ? sharedCols : null;
  }

  /**
   * Reconstruct a visual line into text, respecting column boundaries.
   * If column boundaries are known, inserts `|` separators between columns
   * and pads cells for Markdown table alignment.
   */
  function lineToText(row, colBoundaries) {
    if (!colBoundaries || colBoundaries.length < 2) {
      // No table — just join with spaces, collapsing multiple spaces.
      return row.map((item) => item.str).join(' ').replace(/\s{2,}/g, ' ').trim();
    }

    // Assign each item to the nearest column boundary.
    const cells = new Array(colBoundaries.length).fill('');
    for (const item of row) {
      let best = 0;
      let bestDist = Math.abs(item.x - colBoundaries[0]);
      for (let c = 1; c < colBoundaries.length; c++) {
        const dist = Math.abs(item.x - colBoundaries[c]);
        if (dist < bestDist) { bestDist = dist; best = c; }
      }
      cells[best] += (cells[best] ? ' ' : '') + item.str;
    }

    // Clean up cells.
    return cells.map((c) => c.replace(/\s{2,}/g, ' ').trim());
  }

  /**
   * Convert an array of cell arrays into a Markdown table string.
   */
  function cellsToMarkdownTable(cellRows) {
    if (!cellRows.length) return '';
    const cols = cellRows.reduce((max, row) => Math.max(max, row.length), 0);
    const lines = [];
    // Header row.
    lines.push('| ' + cellRows[0].map((c) => T.escapeCell(c || '')).join(' | ') + ' |');
    // Separator.
    lines.push('| ' + Array(cols).fill('---').join(' | ') + ' |');
    // Body rows.
    for (let r = 1; r < cellRows.length; r++) {
      const padded = cellRows[r].concat(Array(Math.max(0, cols - cellRows[r].length)).fill(''));
      lines.push('| ' + padded.map((c) => T.escapeCell(c || '')).join(' | ') + ' |');
    }
    return lines.join('\n');
  }

  function isHeadingLine(line) {
    return typeof line === 'string' && line.length >= 3 && line.length <= 50 &&
      line === line.toUpperCase() && /[A-Z]{3,}/.test(line) &&
      !/^\d+$/.test(line) && !line.endsWith('.') && !line.endsWith(',');
  }

  // Minimum character count from PDF.js before considering OCR fallback.
  const OCR_THRESHOLD = 50;

  /**
   * Layout-aware extraction for a single PDF page.
   * Detects tables from column alignment, handles multi-column text,
   * and produces clean reading-order output.
   */
  function renderPdfTable(lines, parts, boundaries) {
    const rows = lines.map((row) => lineToText(row, boundaries)).filter((cells) => Array.isArray(cells) ? cells.some((c) => c) : cells);
    if (rows.length) parts.push(cellsToMarkdownTable(rows.map((cells) => Array.isArray(cells) ? cells : [cells])) + '\n\n');
  }

  function renderPdfText(lines, parts) {
    for (const row of lines) {
      const text = lineToText(row, null);
      if (text) parts.push(isHeadingLine(text) ? '## ' + text + '\n\n' : text + '\n\n');
    }
  }

  async function pdfPage(pdf, pageNum, parts) {
    try {
      const content = await (await pdf.getPage(pageNum)).getTextContent();
      const lines = clusterLines(content);
      if (!lines.length) { parts.push('*[Page ' + pageNum + ': no text content]*\n\n'); return; }
      const boundaries = detectTableColumns(lines);
      if (boundaries) renderPdfTable(lines, parts, boundaries); else renderPdfText(lines, parts);
    } catch (_) { parts.push('*[Page ' + pageNum + ' could not be extracted]*\n\n'); }
  }

  // ── PDF canvas / OCR helpers ────────────────────────────────────────

  async function renderPageToCanvas(pdf, pageNum, scale) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: scale || 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/png');
    // Free canvas memory immediately.
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl;
  }

  async function ocrPage(pdf, pageNum) {
    const worker = await FTM.libs.tesseract();
    const dataUrl = await renderPageToCanvas(pdf, pageNum, 2.0);
    const result = await worker.recognize(dataUrl);
    return (result.data.text || '').trim();
  }

  async function extractTextSample(pdf) {
    let total = '';
    const pagesToSample = Math.min(pdf.numPages, 3);
    for (let i = 1; i <= pagesToSample; i++) {
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        total += content.items.map((item) => item.str).join(' ');
      } catch (_) { /* skip page */ }
    }
    return total;
  }

  // ── Main PDF parser ─────────────────────────────────────────────────

  // Remove repeated headers/footers across PDF pages.
  // Lines that appear identically at the start or end of ≥2 pages
  // are likely headers/footers and get stripped.
  function repeatedLines(lineSets) {
    const counts = new Map();
    for (const line of lineSets) if (line.trim()) counts.set(line, (counts.get(line) || 0) + 1);
    return new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([line]) => line));
  }

  function stripRepeatedPage(page, headers, footers) {
    const lines = page.split('\n');
    let start = 0;
    let end = lines.length;
    if (headers.has(lines.slice(0, 3).join('\n'))) while (start < lines.length && start < 3 && lines[start].trim()) start++;
    if (footers.has(lines.slice(-3).join('\n'))) while (end > start && end > lines.length - 3 && lines[end - 1].trim()) end--;
    return lines.slice(start, end).join('\n');
  }

  function dedupPageHeaders(text, numPages) {
    if (numPages < 2) return text;
    const pageRe = /\n---\n\n\*\*Page \d+\*\*\n\n/g;
    const pages = text.split(pageRe);
    if (pages.length < 3) return text; // pages[0] is the title+info prefix

    const HEADER_LINES = 3;
    const FOOTER_LINES = 3;
    const pageContents = pages.slice(1); // skip the title prefix

    // Collect first/last lines per page.
    const headers = [];
    const footers = [];
    for (const page of pageContents) {
      const lines = page.split('\n').filter((l) => l.trim());
      headers.push(lines.slice(0, HEADER_LINES).join('\n'));
      footers.push(lines.slice(-FOOTER_LINES).join('\n'));
    }

    const repeatedHeaders = repeatedLines(headers);
    const repeatedFooters = repeatedLines(footers);
    if (!repeatedHeaders.size && !repeatedFooters.size) return text;

    let idx = 0;
    return text.replace(pageRe, (match) => {
      idx++;
      pageContents[idx - 1] = stripRepeatedPage(pageContents[idx - 1] || '', repeatedHeaders, repeatedFooters);
      return match;
    });
  }

  async function openPdf(bytes) {
    const pdfjs = await FTM.libs.pdf();
    if (!bytes.length) throw new Error('PDF file is empty.');
    try {
      return await pdfjs.getDocument({ data: bytes, isEvalSupported: false, isOffscreenCanvasSupported: false }).promise;
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/password|encrypt/i.test(msg)) throw new Error('PDF is password-protected and cannot be converted.');
      throw new Error('Failed to open PDF: ' + msg);
    }
  }

  async function parseScannedPdf(pdf, title) {
    const parts = [title, '*[Scanned PDF — OCR applied]*\n\n'];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (pdf.numPages > 1) parts.push('\n---\n\n**Page ' + pageNum + '**\n\n');
      try {
        const text = await ocrPage(pdf, pageNum);
        if (!text) parts.push('*[No text detected on this page]*\n\n');
        else for (const line of text.split('\n').filter((l) => l.trim())) parts.push(isHeadingLine(line) ? '## ' + line + '\n\n' : line + '\n\n');
      } catch (_) { parts.push('*[OCR failed for page ' + pageNum + ']*\n\n'); }
      if (pageNum % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return parts;
  }

  async function parsePdf(bytes, meta) {
    const pdf = await openPdf(bytes);

    const title = '# ' + T.plain(T.stem(meta.fileName)) + '\n\n';
    const pageInfo = '*' + pdf.numPages + ' page' + (pdf.numPages !== 1 ? 's' : '') + ' extracted*\n\n';

    // First pass: try PDF.js text extraction.
    const extractedText = await extractTextSample(pdf);

    // If very little text was extracted, this is likely a scanned PDF.
    if (extractedText.length < OCR_THRESHOLD) {
      const parts = await parseScannedPdf(pdf, title);
      await pdf.destroy();
      return dedupPageHeaders(parts.join('').replace(/\n{3,}/g, '\n\n').trim(), pdf.numPages);
    }

    // Normal path: layout-aware text extraction.
    const parts = [title, pageInfo];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (pdf.numPages > 1) parts.push('\n---\n\n**Page ' + pageNum + '**\n\n');
      await pdfPage(pdf, pageNum, parts);
      // Yield every 5 pages to keep the offscreen document responsive.
      if (pageNum % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    await pdf.destroy();
    return dedupPageHeaders(parts.join('').replace(/\n{3,}/g, '\n\n').trim(), pdf.numPages);
  }

  // ── Expose internals for testing ────────────────────────────────────

  FTM._pdfLayout = { clusterLines, detectTableColumns, lineToText, cellsToMarkdownTable };

  // ── Register parsers ────────────────────────────────────────────────

  FTM.parsers = FTM.parsers || {};
  FTM.parsers['.docx'] = parseDocx;
  FTM.parsers['.xlsx'] = parseSpreadsheet;
  FTM.parsers['.xls'] = parseSpreadsheet;
  FTM.parsers['.pdf'] = parsePdf;
})();
