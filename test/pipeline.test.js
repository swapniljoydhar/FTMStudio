'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, loadShared } = require('./harness');

test('table writer emits a header, separator, and equal-width rows', () => {
  const { FTM } = load(['shared/constants.js', 'shared/text.js', 'offscreen/tabular.js']);
  const writer = new FTM.TableWriter('# data.csv');
  writer.push(['a', 'b', 'c']); writer.push(['1', '2']); writer.push(['1', '2', '3', 'dropped']);
  const lines = writer.finish().split('\n');
  assert.equal(lines[0], '# data.csv'); assert.equal(lines[2], '| a | b | c |'); assert.equal(lines[3], '| --- | --- | --- |');
  assert.equal(new Set(lines.slice(2).filter(Boolean).map((line) => line.split('|').length)).size, 1);
});

test('table writer sanitises formula-injection cells', () => {
  const { FTM } = load(['shared/constants.js', 'shared/text.js', 'offscreen/tabular.js']);
  const writer = new FTM.TableWriter('# t'); writer.push(['=SUM(A1)', ' @cmd', 'a|b']);
  assert.match(writer.finish(), /`=SUM\(A1\)`/); assert.match(writer.finish(), /a\\\|b/);
});

test('table writer reports truncation instead of throwing', () => {
  const { FTM } = load(['shared/constants.js', 'shared/text.js', 'offscreen/tabular.js']);
  const writer = new FTM.TableWriter('# t', 2); assert.equal(writer.push(['a']), true); assert.equal(writer.push(['b']), true); assert.equal(writer.push(['c']), false); assert.match(writer.finish(), /truncated/i);
});

test('parser registry covers binary formats that remain in manual mode', () => {
  const { FTM } = load(['shared/constants.js', 'shared/text.js', 'offscreen/loader.js', 'offscreen/documents.js', 'offscreen/tabular.js']);
  assert.equal(typeof FTM.parsers['.docx'], 'function');
  assert.equal(typeof FTM.parsers['.xlsx'], 'function');
  assert.equal(typeof FTM.parsers['.xls'], 'function');
  assert.equal(typeof FTM.parsers['.pdf'], 'function');
  assert.equal(typeof FTM.parsers['.csv'], 'function');
});

test('constants keep the extension map, categories, and manual set in sync', () => {
  const { FTM } = loadShared();
  for (const [ext, category] of Object.entries(FTM.EXTENSION_MAP)) assert.ok(FTM.CATEGORIES.includes(category), ext + ' maps to unknown category ' + category);
  for (const ext of FTM.MANUAL_EXTENSIONS) assert.ok(ext in FTM.EXTENSION_MAP, ext + ' is manually accepted but has no category');
});

test('manual size budget is smaller than the maximum output budget', () => {
  const { FTM } = loadShared();
  assert.ok(FTM.CONSTANTS.MAX_FILE_SIZE_BYTES < FTM.CONSTANTS.MAX_OUTPUT_BYTES);
});
