'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, SHARED } = require('./harness');

function loadDocs() {
  return load([...SHARED, 'offscreen/documents.js']);
}

// ── clusterLines ────────────────────────────────────────────────────────

test('clusterLines groups items by Y proximity and sorts by X', () => {
  const { FTM } = loadDocs();
  const { clusterLines } = FTM._pdfLayout;
  // Simulate getTextContent() output: two visual lines.
  const textContent = {
    items: [
      { str: 'Hello', width: 30, transform: [1, 0, 0, 1, 50, 100] },
      { str: 'World', width: 30, transform: [1, 0, 0, 1, 150, 100] },
      { str: 'Second', width: 40, transform: [1, 0, 0, 1, 50, 80] },
      { str: 'Line', width: 25, transform: [1, 0, 0, 1, 150, 80] }
    ]
  };
  const lines = clusterLines(textContent);
  assert.equal(lines.length, 2);
  // Top line (y=100) should be first (descending Y).
  assert.equal(lines[0].length, 2);
  assert.equal(lines[0][0].str, 'Hello');
  assert.equal(lines[0][1].str, 'World');
  // Bottom line (y=80).
  assert.equal(lines[1].length, 2);
  assert.equal(lines[1][0].str, 'Second');
  assert.equal(lines[1][1].str, 'Line');
});

test('clusterLines handles empty input', () => {
  const { FTM } = loadDocs();
  const { clusterLines } = FTM._pdfLayout;
  assert.equal(clusterLines({ items: [] }).length, 0);
  assert.equal(clusterLines({ items: [{ str: '  ', transform: [1, 0, 0, 1, 0, 0] }] }).length, 0);
});

// ── detectTableColumns ──────────────────────────────────────────────────

test('detectTableColumns identifies aligned columns', () => {
  const { FTM } = loadDocs();
  const { detectTableColumns } = FTM._pdfLayout;
  // 4 rows, each with items at roughly x=50 and x=200.
  const lines = [
    [{ str: 'Name', x: 50, y: 100, w: 30 }, { str: 'Value', x: 200, y: 100, w: 30 }],
    [{ str: 'A', x: 50, y: 80, w: 10 }, { str: '100', x: 200, y: 80, w: 20 }],
    [{ str: 'B', x: 50, y: 60, w: 10 }, { str: '200', x: 200, y: 60, w: 20 }],
    [{ str: 'C', x: 50, y: 40, w: 10 }, { str: '300', x: 200, y: 40, w: 20 }]
  ];
  const cols = detectTableColumns(lines);
  assert.ok(cols !== null, 'should detect a table');
  assert.ok(cols.length >= 2, 'should find at least 2 columns');
});

test('detectTableColumns returns null for non-tabular text', () => {
  const { FTM } = loadDocs();
  const { detectTableColumns } = FTM._pdfLayout;
  // 3 rows each with a SINGLE item at varying X — only 1 column, not a table.
  const lines = [
    [{ str: 'This is a paragraph of text that flows', x: 50, y: 100, w: 300 }],
    [{ str: 'continuously and has no column structure', x: 55, y: 80, w: 300 }],
    [{ str: 'at all whatsoever in this document here', x: 48, y: 60, w: 300 }]
  ];
  assert.equal(detectTableColumns(lines), null);
});

test('detectTableColumns returns null for too few rows', () => {
  const { FTM } = loadDocs();
  const { detectTableColumns } = FTM._pdfLayout;
  const lines = [
    [{ str: 'A', x: 50, y: 100, w: 10 }, { str: 'B', x: 200, y: 100, w: 10 }],
    [{ str: 'C', x: 50, y: 80, w: 10 }, { str: 'D', x: 200, y: 80, w: 10 }]
  ];
  assert.equal(detectTableColumns(lines), null);
});

// ── lineToText ──────────────────────────────────────────────────────────

test('lineToText joins items with spaces in linear mode', () => {
  const { FTM } = loadDocs();
  const { lineToText } = FTM._pdfLayout;
  const row = [
    { str: 'Hello', x: 50, y: 100, w: 30 },
    { str: 'World', x: 150, y: 100, w: 30 }
  ];
  assert.equal(lineToText(row, null), 'Hello World');
});

test('lineToText splits into cells when column boundaries are given', () => {
  const { FTM } = loadDocs();
  const { lineToText } = FTM._pdfLayout;
  const row = [
    { str: 'Name', x: 50, y: 100, w: 30 },
    { str: '100', x: 200, y: 100, w: 20 }
  ];
  const cells = lineToText(row, [50, 200]);
  assert.ok(Array.isArray(cells));
  assert.equal(cells[0], 'Name');
  assert.equal(cells[1], '100');
});

// ── cellsToMarkdownTable ────────────────────────────────────────────────

test('cellsToMarkdownTable generates a valid markdown table', () => {
  const { FTM } = loadDocs();
  const { cellsToMarkdownTable } = FTM._pdfLayout;
  const rows = [
    ['Name', 'Value'],
    ['A', '100'],
    ['B', '200']
  ];
  const md = cellsToMarkdownTable(rows);
  assert.match(md, /\| Name \| Value \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| A \| 100 \|/);
  assert.match(md, /\| B \| 200 \|/);
});

test('cellsToMarkdownTable handles empty input', () => {
  const { FTM } = loadDocs();
  const { cellsToMarkdownTable } = FTM._pdfLayout;
  assert.equal(cellsToMarkdownTable([]), '');
});

// ── DOCX image preservation ─────────────────────────────────────────────

test('parseDocx is registered as a parser', () => {
  const { FTM } = loadDocs();
  assert.equal(typeof FTM.parsers['.docx'], 'function');
});

test('parseDocx honours per-conversion image mode', async () => {
  const { FTM } = loadDocs();
  let convertedImage;
  FTM.libs = {
    get: async () => ({
      images: {
        imgElement: (handler) => handler
      },
      convertToHtml: async (_input, options) => {
        convertedImage = await options.convertImage({
          contentType: 'image/png',
          read: async () => 'encoded-image'
        });
        return { value: '<img src="' + convertedImage.src + '">' };
      }
    }),
    turndown: async () => ({ turndown: (html) => html })
  };

  const parse = FTM.parsers['.docx'];
  const embedded = await parse(new Uint8Array([1]), { fileName: 'file.docx', imageMode: 'embedded' });
  assert.match(embedded, /data:image\/png;base64,encoded-image/);

  const placeholder = await parse(new Uint8Array([1]), { fileName: 'file.docx', imageMode: 'placeholder' });
  assert.equal(convertedImage.src, '');
  assert.doesNotMatch(placeholder, /encoded-image/);

  const external = await parse(new Uint8Array([1]), { fileName: 'file.docx', imageMode: 'external' });
  assert.equal(convertedImage.src, '');
  assert.doesNotMatch(external, /encoded-image/);
});

test('parseSpreadsheet is registered for xlsx and xls', () => {
  const { FTM } = loadDocs();
  assert.equal(typeof FTM.parsers['.xlsx'], 'function');
  assert.equal(typeof FTM.parsers['.xls'], 'function');
});

test('parsePdf is registered', () => {
  const { FTM } = loadDocs();
  assert.equal(typeof FTM.parsers['.pdf'], 'function');
});

test('parseSpreadsheet rejects oversized sheets before materializing rows', async () => {
  const { FTM } = loadDocs();
  let materialized = false;
  FTM.libs = {
    get: async () => ({
      read: () => ({ SheetNames: ['Oversized'], Sheets: { Oversized: { '!ref': 'A1:A500001' } } }),
      utils: {
        decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: FTM.CONSTANTS.MAX_SPREADSHEET_CELLS, c: 0 } }),
        sheet_to_json: () => {
          materialized = true;
          return [];
        }
      }
    })
  };

  await assert.rejects(
    FTM.parsers['.xlsx'](new Uint8Array([1]), { fileName: 'oversized.xlsx' }),
    /Spreadsheet exceeds the safe cell limit/
  );
  assert.equal(materialized, false);
});

