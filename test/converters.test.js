'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, SHARED } = require('./harness');

function loadConverters(options) {
  return load([...SHARED, 'content/converters.js'], options);
}

function file(name, content, size = Buffer.byteLength(content)) {
  return { name, size, text: async () => content, slice: () => ({ arrayBuffer: async () => new TextEncoder().encode(content).buffer }) };
}

test('bounded converter API exposes text and RTF only', () => {
  const { FTM } = loadConverters();
  assert.equal(typeof FTM.converters.text, 'function');
  assert.equal(typeof FTM.converters.rtf, 'function');
  assert.equal(FTM.converters.image, undefined);
  assert.equal(FTM.converters.offscreen, undefined);
});

test('text converter emits fenced source and JSON', async () => {
  const { FTM } = loadConverters();
  assert.match(await FTM.converters.text(file('a.js', 'const x = 1;'), '.js'), /```javascript[\s\S]*const x = 1/);
  assert.match(await FTM.converters.text(file('a.json', '{"ok":true}'), '.json'), /```json[\s\S]*"ok": true/);
});

test('RTF converter returns Markdown', async () => {
  const { FTM } = loadConverters();
  assert.match(await FTM.converters.rtf(file('a.rtf', '{\\rtf1\\b Bold}')), /Bold/);
});

test('text and RTF converters reject oversized files before reading', async () => {
  const { FTM } = loadConverters();
  const huge = { name: 'big.txt', size: FTM.CONSTANTS.MAX_TEXT_READ_SIZE_BYTES + 1, text: async () => { throw new Error('must not read'); }, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
  await assert.rejects(() => FTM.converters.text(huge, '.txt'), /File too large/i);
  await assert.rejects(() => FTM.converters.rtf({ ...huge, name: 'big.rtf' }), /File too large/i);
});

test('text converter rejects binary signatures', async () => {
  const { FTM } = loadConverters();
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  const binary = { name: 'fake.txt', size: FTM.CONSTANTS.SNIFF_BYTES + 1, text: async () => 'not used', slice: () => ({ arrayBuffer: async () => bytes.buffer }) };
  await assert.rejects(() => FTM.converters.text(binary, '.txt'), /signature/i);
});
