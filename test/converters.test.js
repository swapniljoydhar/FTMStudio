'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, SHARED } = require('./harness');

function loadConverters(options) {
  return load([...SHARED, 'content/config.js', 'content/router.js', 'content/converters.js'], options);
}

// ── converters are registered ─────────────────────────────────────────

test('converters object exists', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  assert.ok(FTM.converters, 'converters should be defined');
  assert.equal(typeof FTM.converters, 'object');
});

test('text converter is a function', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  assert.equal(typeof FTM.converters.text, 'function');
});

test('rtf converter is a function', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  assert.equal(typeof FTM.converters.rtf, 'function');
});

test('image converter is a function', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  assert.equal(typeof FTM.converters.image, 'function');
});

test('offscreen converter is a function', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  assert.equal(typeof FTM.converters.offscreen, 'function');
});

test('csvStreams is a function', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  assert.equal(typeof FTM.converters.csvStreams, 'function');
});

// ── csvStreams threshold logic ─────────────────────────────────────────

test('csvStreams returns false for small files', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  const file = { name: 'small.csv', size: 1024 };
  assert.equal(FTM.converters.csvStreams(file), false);
});

test('csvStreams returns true for large files', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  const mb = FTM.CONSTANTS.CSV_STREAM_THRESHOLD_MB_DEFAULT;
  const file = { name: 'large.csv', size: mb * FTM.CONSTANTS.MB + 1 };
  assert.equal(FTM.converters.csvStreams(file), true);
});

test('csvStreams respects custom csvStreamThreshold config', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  FTM.config.csvStreamThreshold = 1; // 1MB threshold
  const smallFile = { name: 'small.csv', size: 500 * 1024 }; // 500KB
  const largeFile = { name: 'large.csv', size: 2 * FTM.CONSTANTS.MB }; // 2MB
  assert.equal(FTM.converters.csvStreams(smallFile), false);
  assert.equal(FTM.converters.csvStreams(largeFile), true);
});

// ── offscreen delegates to transport ───────────────────────────────────

test('offscreen converter is registered for docx', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  // The offscreen converter exists - it will call transport.convert internally
  assert.equal(typeof FTM.converters.offscreen, 'function');
});

test('converters has dataUrl method', () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  assert.equal(typeof FTM.converters.dataUrl, 'function');
});

// ── text converter rejects binary files ────────────────────────────────

test('text converter throws for oversized text files', async () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  const file = {
    name: 'big.txt',
    size: FTM.CONSTANTS.MAX_TEXT_READ_SIZE_BYTES + 1,
    slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) })
  };
  await assert.rejects(() => FTM.converters.text(file, '.txt'), /File too large/i);
});

// ── rtf converter rejects oversized files ────────────────────────────────

test('rtf converter throws for oversized RTF files', async () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  const file = {
    name: 'big.rtf',
    size: FTM.CONSTANTS.MAX_TEXT_READ_SIZE_BYTES + 1,
    slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) })
  };
  await assert.rejects(() => FTM.converters.rtf(file), /File too large/i);
});

// ── image converter rejects oversized images ────────────────────────────

test('image converter throws for oversized image files', async () => {
  const { FTM } = loadConverters({ hostname: 'chatgpt.com' });
  const file = {
    name: 'big.png',
    size: FTM.CONSTANTS.MAX_IMAGE_SIZE_BYTES + 1,
    slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) })
  };
  await assert.rejects(() => FTM.converters.image(file), /File too large/i);
});
