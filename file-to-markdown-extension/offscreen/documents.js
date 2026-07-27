// ===========================================================================
// offscreen/documents.js — DOCX, PDF and spreadsheet parsers
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const T = FTM.text;

  async function parseDocx(bytes, meta) {
    const mammoth = await FTM.libs.get('mammoth');
    const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer }, {
      convertImage: mammoth.images.imgElement((img) => img.read('base64').then(() => ({ src: '', alt: '[Image]' })))
    });
    const html = (result.value || '').replace(/<img\s+[^>]*alt="([^"]*)"[^>]*>/gi, '$1');
    const turndown = await FTM.libs.turndown();
    const markdown = turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
    return '# ' + T.plain(T.stem(meta.fileName)) + '\n\n' + markdown;
  }

  function headerIndex(rows) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].some((cell) => cell !== '' && cell != null)) return i;
    }
    return 0;
  }

  // Rows wider than the header are no longer truncated, and the SheetJS-owned
  // row arrays are not mutated while being iterated.
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

  function pdfLines(items) {
    const lines = [];
    let currentY = null;
    let line = '';
    for (const item of items) {
      if (currentY !== null && Math.abs(item.y - currentY) > 3) {
        if (line.trim()) lines.push(line.trim());
        line = '';
      }
      line += (line && !line.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str;
      currentY = item.y;
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  function positioned(textContent) {
    return textContent.items
      .filter((item) => item && item.str && item.str.trim())
      .map((item) => {
        const tr = Array.isArray(item.transform) && item.transform.length >= 6 ? item.transform : [1, 0, 0, 1, 0, 0];
        return { str: item.str, x: tr[4], y: Math.round(tr[5]) };
      })
      .sort((a, b) => (Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x));
  }

  function isHeadingLine(line) {
    return line.length >= 3 && line.length <= 50 && line === line.toUpperCase() &&
      /[A-Z]{3,}/.test(line) && !/^\d+$/.test(line) && !line.endsWith('.') && !line.endsWith(',');
  }

  async function pdfPage(pdf, pageNum, parts) {
    try {
      const page = await pdf.getPage(pageNum);
      const lines = pdfLines(positioned(await page.getTextContent()));
      for (const line of lines) parts.push(isHeadingLine(line) ? '## ' + line + '\n\n' : line + '\n\n');
    } catch (_) {
      parts.push('*[Page ' + pageNum + ' could not be extracted]*\n\n');
    }
  }

  async function parsePdf(bytes, meta) {
    const pdfjs = await FTM.libs.pdf();
    if (!bytes.length) throw new Error('PDF file is empty.');
    const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, isOffscreenCanvasSupported: false }).promise;
    const parts = ['# ' + T.plain(T.stem(meta.fileName)) + '\n\n', '*' + pdf.numPages + ' page' + (pdf.numPages !== 1 ? 's' : '') + ' extracted*\n\n'];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (pdf.numPages > 1) parts.push('\n---\n\n**Page ' + pageNum + '**\n\n');
      await pdfPage(pdf, pageNum, parts);
      if (pageNum % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    await pdf.destroy();
    return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  FTM.parsers = FTM.parsers || {};
  FTM.parsers['.docx'] = parseDocx;
  FTM.parsers['.xlsx'] = parseSpreadsheet;
  FTM.parsers['.xls'] = parseSpreadsheet;
  FTM.parsers['.pdf'] = parsePdf;
})();
