'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadShared } = require('./harness');

const { FTM } = loadShared();
const T = FTM.text;

test('getExtension / stem / formatBytes', () => {
  assert.equal(T.getExtension('report.final.PDF'), '.PDF');
  assert.equal(T.getExtension('noext'), '');
  assert.equal(T.stem('a.b.docx'), 'a.b');
  assert.equal(T.formatBytes(512), '512 B');
  assert.equal(T.formatBytes(2048), '2.0 KB');
  assert.equal(T.formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('CSV formula injection: leading whitespace, tab and CR are guarded', () => {
  for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', ' =cmd', '\t=cmd', '\r=cmd', '   \t@evil', '|calc']) {
    assert.equal(T.sanitizeCsvCell(value)[0], '`', 'expected backtick for ' + JSON.stringify(value));
  }
  assert.equal(T.sanitizeCsvCell('safe'), 'safe');
  assert.equal(T.sanitizeCsvCell(null), '');
});

test('escapeCell escapes pipes and backslashes and flattens newlines in one pass', () => {
  assert.equal(T.escapeCell('a|b'), 'a\\|b');
  assert.equal(T.escapeCell('a\\b'), 'a\\\\b');
  assert.equal(T.escapeCell('a\r\nb'), 'a b');
});

test('markdownTable pads short rows and never spreads arguments', () => {
  const md = T.markdownTable([['a', 'b'], ['1']], '# T');
  assert.equal(md, '# T\n\n| a | b |\n| --- | --- |\n| 1 |  |');
});

test('markdownTable survives 200k rows (old Math.max spread threw RangeError)', () => {
  const rows = Array.from({ length: 200000 }, (_, i) => [String(i), 'x']);
  const md = T.markdownTable(rows, '# Big');
  assert.equal(md.split('\n').length, 200000 + 3);
});

test('markdownTable handles an empty input', () => {
  assert.equal(T.markdownTable([], '# T'), '# T\n\n*No data*');
});

test('yamlString emits only legal double-quoted escapes', () => {
  assert.equal(T.yamlString('a:b'), '"a:b"');
  assert.equal(T.yamlString('say "hi"'), '"say \\"hi\\""');
  assert.equal(T.yamlString('a\nb\tc'), '"a\\nb\\tc"');
  assert.equal(T.yamlString('drop\u0007bell'), '"drop\\x07bell"');
  assert.match(T.yamlString('{braces}'), /^"\{braces\}"$/);
});

test('plain() strips control characters used to inject extra lines', () => {
  assert.equal(T.plain('evil\nname'), 'evil name');
  assert.equal(T.plain('  spaced  '), 'spaced');
});

test('chunk codec round-trips binary payloads', () => {
  const bytes = new Uint8Array(300000).map((_, i) => i % 256);
  const chunks = T.encodeChunks(bytes, 65536);
  assert.ok(chunks.length > 1);
  assert.deepEqual([...T.decodeChunks(chunks)], [...bytes]);
  assert.deepEqual([...T.decodeChunks(T.encodeChunks(new Uint8Array(0)))], []);
});

test('mergeHistory unions concurrent writers and caps the total', () => {
  const stored = [{ timestamp: '1', file: 'a' }, { timestamp: '2', file: 'b' }];
  const local = [{ timestamp: '3', file: 'c' }, { timestamp: '2', file: 'b' }];
  const names = (list) => [...list].map((e) => e.file);
  assert.deepEqual(names(T.mergeHistory(stored, local, 50)), ['a', 'b', 'c']);
  assert.deepEqual(names(T.mergeHistory(stored, local, 2)), ['b', 'c']);
});

test('magic signature and null-byte detection', () => {
  assert.equal(T.magicSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46])), 'PDF');
  assert.equal(T.magicSignature(new Uint8Array([1, 2, 3])), null);
  assert.equal(T.countNullBytes(new Uint8Array([0, 1, 0])), 2);
});

test('rtfToMarkdown decodes escapes and drops control words', () => {
  const md = T.rtfToMarkdown('{\\rtf1\\ansi Hello\\par World\\u8212? end}');
  assert.match(md, /Hello\nWorld/);
  assert.match(md, /\u2014/);
});

test('rtfToMarkdown handles nested groups with formatting', () => {
  const md = T.rtfToMarkdown('{\\rtf1 {\\b bold} and {\\i italic} text}');
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\*italic\*/);
  assert.match(md, /and/);
});

test('rtfToMarkdown rejects excessive nesting instead of growing the stack', () => {
  const { FTM } = loadShared();
  const nested = '{'.repeat(FTM.CONSTANTS.MAX_RTF_GROUP_DEPTH + 1) + 'x' + '}'.repeat(FTM.CONSTANTS.MAX_RTF_GROUP_DEPTH + 1);
  assert.throws(() => FTM.text.rtfToMarkdown(nested), /depth limit/i);
});

test('rtfToMarkdown rejects excessive token counts', () => {
  const { FTM } = loadShared();
  assert.throws(() => FTM.text.rtfToMarkdown('x'.repeat(FTM.CONSTANTS.MAX_RTF_TOKENS + 1)), /token limit/i);
});

test('rtfToMarkdown skips non-content groups', () => {
  const md = T.rtfToMarkdown('{\\rtf1\\fonttbl{\\f0 Times;}{\\f1 Arial;}Hello\\par World}');
  assert.match(md, /Hello\nWorld/);
  assert.ok(!md.includes('Times'), 'font table must be stripped');
  assert.ok(!md.includes('Arial'), 'font table must be stripped');
});

test('rtfToMarkdown skips pict and object groups', () => {
  const md = T.rtfToMarkdown('{\\rtf1 text before {\\pict\\pngblip 00FF00FF} text after}');
  assert.match(md, /text before/);
  assert.match(md, /text after/);
  assert.ok(!md.includes('00FF'), 'binary image data must be stripped');
});

test('rtfToMarkdown handles hex escapes with CP1252 smart quotes', () => {
  const md = T.rtfToMarkdown("{\\rtf1 \\\'93Hello\\\'94}");
  assert.match(md, /\u201cHello\u201d/); // left/right double quotes
});

test('rtfToMarkdown handles escaped braces', () => {
  const md = T.rtfToMarkdown('{\\rtf1 \\\{hello\\\} end}');
  assert.match(md, /\{hello\}/);
});

test('decodeHtmlEntities handles double-encoded entities', () => {
  assert.equal(T.decodeHtmlEntities('&amp;amp;'), '&');
  assert.equal(T.decodeHtmlEntities('&amp;lt;'), '<');
  assert.equal(T.decodeHtmlEntities('&amp;quot;hello&amp;quot;'), '"hello"');
  assert.equal(T.decodeHtmlEntities('plain text'), 'plain text');
  assert.equal(T.decodeHtmlEntities('&amp;amp;amp;'), '&'); // triple-encoded → single
});

test('rtfToMarkdown collapses whitespace', () => {
  const md = T.rtfToMarkdown('{\\rtf1   hello    world  }');
  assert.equal(md, 'hello world');
});

test('toBase64 / fromBase64 round-trip binary data', () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
  const b64 = T.toBase64(bytes);
  assert.equal(typeof b64, 'string');
  assert.ok(b64.length > 0);
  const decoded = T.fromBase64(b64);
  assert.deepEqual([...decoded], [...bytes]);
});

test('toBase64 handles empty input', () => {
  const b64 = T.toBase64(new Uint8Array(0));
  assert.equal(b64, '');
  assert.deepEqual([...T.fromBase64(b64)], []);
});

test('fromBase64Into writes into buffer at offset', () => {
  const bytes = new Uint8Array([10, 20, 30]);
  const b64 = T.toBase64(bytes);
  const buffer = new Uint8Array(10);
  const newOffset = T.fromBase64Into(b64, buffer, 3);
  assert.equal(newOffset, 6);
  assert.deepEqual([...buffer.slice(3, 6)], [10, 20, 30]);
  assert.equal(buffer[0], 0, 'bytes before offset must be untouched');
});

test('getLanguageTag returns correct tags for known extensions', () => {
  assert.equal(T.getLanguageTag('.py'), 'python');
  assert.equal(T.getLanguageTag('.js'), 'javascript');
  assert.equal(T.getLanguageTag('.json'), 'json');
  assert.equal(T.getLanguageTag('.md'), 'markdown');
  assert.equal(T.getLanguageTag('.xyz'), '');
});

test('sanitizeAndEscapeCell combines both escaping steps', () => {
  assert.equal(T.sanitizeAndEscapeCell('=cmd'), '`=cmd`');
  assert.equal(T.sanitizeAndEscapeCell('a|b'), 'a\\|b');
  assert.equal(T.sanitizeAndEscapeCell(null), '');
});
