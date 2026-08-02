'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, loadShared, SHARED } = require('./harness');

test('table writer emits a header, a separator and equal-width rows', () => {
  const { FTM } = load([...SHARED, 'offscreen/tabular.js']);
  const writer = new FTM.TableWriter('# data.csv');
  writer.push(['a', 'b', 'c']);
  writer.push(['1', '2']);
  writer.push(['1', '2', '3', 'dropped']);
  const md = writer.finish();
  const lines = md.split('\n');
  assert.equal(lines[0], '# data.csv');
  assert.equal(lines[2], '| a | b | c |');
  assert.equal(lines[3], '| --- | --- | --- |');
  const widths = new Set(lines.slice(2).filter(Boolean).map((l) => l.split('|').length));
  assert.equal(widths.size, 1, 'header and body must have the same column count');
});

test('table writer sanitises formula-injection cells', () => {
  const { FTM } = load([...SHARED, 'offscreen/tabular.js']);
  const writer = new FTM.TableWriter('# t');
  writer.push(['=SUM(A1)', ' @cmd', 'a|b']);
  assert.match(writer.finish(), /\| `=SUM\(A1\)` \| `\s?@cmd` \| a\\\|b \|/);
});

test('table writer reports truncation instead of throwing', () => {
  const { FTM } = load([...SHARED, 'offscreen/tabular.js']);
  const writer = new FTM.TableWriter('# t', 2);
  assert.equal(writer.push(['a']), true);
  assert.equal(writer.push(['b']), true);
  assert.equal(writer.push(['c']), false, 'writer must signal the row cap');
  assert.match(writer.finish(), /truncated/i);
});

test('binary transport frames a file as BEGIN / CHUNK* / END', async () => {
  const { FTM, sandbox } = load([...SHARED, 'content/config.js', 'content/transport.js'], { hostname: 'chatgpt.com' });
  const sent = [];
  const handlers = {};
  sandbox.chrome.runtime.connect = () => ({
    postMessage: (m) => sent.push(m),
    disconnect: () => {},
    onMessage: { addListener: (fn) => { handlers.message = fn; } },
    onDisconnect: { addListener: (fn) => { handlers.disconnect = fn; } }
  });
  const bytes = new Uint8Array(1500000).map((_, i) => i % 251);
  // Mock file with slice() support for streaming transport.
  const file = {
    name: 'a.docx',
    size: bytes.length,
    slice(start, end) {
      const part = bytes.slice(start, end);
      return { arrayBuffer: async () => part.buffer };
    }
  };
  const promise = FTM.transport.convert(file, '.docx');
  // Wait for all async slice reads to complete.
  await new Promise((r) => setTimeout(r, 100));
  handlers.message({ type: FTM.MSG.RESULT, data: { markdown: '# ok' } });
  assert.equal(await promise, '# ok');

  assert.equal(sent[0].type, FTM.MSG.BEGIN);
  assert.equal(sent[0].data.fileName, 'a.docx');
  assert.equal(sent[sent.length - 1].type, FTM.MSG.END);
  const chunks = sent.filter((m) => m.type === FTM.MSG.CHUNK);
  assert.ok(chunks.length > 1, 'large payloads must be chunked');
  const joined = FTM.text.decodeChunks(chunks.map((c) => c.data.base64));
  assert.deepEqual([...joined], [...bytes], 'payload must survive the port round-trip');
});

test('transport rejects oversized files before reading them', async () => {
  const { FTM } = load([...SHARED, 'content/config.js', 'content/transport.js'], { hostname: 'chatgpt.com' });
  const file = { name: 'huge.pdf', size: FTM.CONSTANTS.MAX_FILE_SIZE_BYTES + 1, slice: () => ({ arrayBuffer: async () => { throw new Error('must not read'); } }) };
  await assert.rejects(() => FTM.transport.convert(file, '.pdf'), /too large/i);
});

test('transport surfaces offscreen errors', async () => {
  const { FTM, sandbox } = load([...SHARED, 'content/config.js', 'content/transport.js'], { hostname: 'chatgpt.com' });
  const handlers = {};
  sandbox.chrome.runtime.connect = () => ({
    postMessage: () => {}, disconnect: () => {},
    onMessage: { addListener: (fn) => { handlers.message = fn; } },
    onDisconnect: { addListener: (fn) => { handlers.disconnect = fn; } }
  });
  const data = new Uint8Array([1, 2, 3, 4]);
  const file = {
    name: 'a.pdf', size: 4,
    slice(start, end) { const part = data.slice(start, end); return { arrayBuffer: async () => part.buffer }; }
  };
  const promise = FTM.transport.convert(file, '.pdf');
  await new Promise((r) => setTimeout(r, 50));
  handlers.message({ type: FTM.MSG.ERROR, data: { error: 'encrypted PDF' } });
  await assert.rejects(() => promise, /encrypted PDF/);
});

test('router sends offscreen formats over the port and keeps text local', async () => {
  const { FTM } = load([...SHARED, 'content/config.js', 'content/router.js'], { hostname: 'chatgpt.com' });
  FTM.converters = { text: async () => '# text', rtf: async () => '# rtf', image: async () => '# image', csv: async () => '# csv', offscreen: async () => '# offscreen' };
  assert.equal(FTM.router.needsOffscreen('.docx'), true);
  assert.equal(FTM.router.needsOffscreen('.txt'), false);
  assert.equal(await FTM.router.convert({ name: 'a.docx', size: 1 }, '.docx'), '# offscreen');
  assert.equal(await FTM.router.convert({ name: 'a.txt', size: 1 }, '.txt'), '# text');
  assert.equal(await FTM.router.convert({ name: 'a.rtf', size: 1 }, '.rtf'), '# rtf');
  assert.equal(await FTM.router.convert({ name: 'a.png', size: 1 }, '.png'), '# image');
});

test('constants keep the extension map, categories and offscreen set in sync', () => {
  const { FTM } = loadShared();
  for (const [ext, category] of Object.entries(FTM.EXTENSION_MAP)) {
    assert.ok(FTM.CATEGORIES.includes(category), ext + ' maps to unknown category ' + category);
  }
  for (const ext of FTM.OFFSCREEN_EXTENSIONS) {
    assert.ok(ext in FTM.EXTENSION_MAP, ext + ' is routed offscreen but has no category');
  }
});
