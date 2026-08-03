'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadArchives } = require('./harness');

// ── Parsers are registered ─────────────────────────────────────────────

test('epub parser is registered', () => {
  const { FTM } = loadArchives();
  assert.equal(typeof FTM.parsers['.epub'], 'function');
});

test('pptx parser is registered', () => {
  const { FTM } = loadArchives();
  assert.equal(typeof FTM.parsers['.pptx'], 'function');
});

// ── epub parser handles errors gracefully ──────────────────────────────

test('parseEpub handles invalid bytes gracefully', async () => {
  const { FTM } = loadArchives();
  FTM.libs = {
    get: async () => async function() { return null; },
    turndown: async () => ({ turndown: () => '' })
  };
  const bytes = new Uint8Array([0, 1, 2, 3]); // invalid ZIP
  const meta = { fileName: 'test.epub' };
  
  // Should not throw, should return error message
  const result = await FTM.parsers['.epub'](bytes, meta);
  assert.ok(typeof result === 'string');
});

// ── pptx parser handles errors gracefully ──────────────────────────────

test('parsePptx handles invalid bytes gracefully', async () => {
  const { FTM } = loadArchives();
  FTM.libs = {
    get: async () => async function() { return null; },
    turndown: async () => ({ turndown: () => '' })
  };
  const bytes = new Uint8Array([0, 1, 2, 3]); // invalid ZIP
  const meta = { fileName: 'test.pptx' };
  
  // Should not throw, should return error message
  const result = await FTM.parsers['.pptx'](bytes, meta);
  assert.ok(typeof result === 'string');
});

// ── epub parser handles empty chapters ─────────────────────────────────

test('parseEpub handles missing chapter content', async () => {
  const { FTM } = loadArchives();
  
  // Mock JSZip that returns no chapters
  const mockZip = {
    file: async () => null,
    forEach: () => {}
  };
  
  FTM.libs = {
    get: async () => async function() { return mockZip; },
    turndown: async () => ({ turndown: () => '' })
  };
  
  const bytes = new Uint8Array([0, 1, 2, 3]);
  const meta = { fileName: 'empty.epub' };
  
  const result = await FTM.parsers['.epub'](bytes, meta);
  assert.ok(typeof result === 'string', 'should return a string');
});

// ── pptx parser handles missing slides ─────────────────────────────────

test('parsePptx handles missing slide content', async () => {
  const { FTM } = loadArchives();
  
  // Mock JSZip that returns no slides
  const mockZip = {
    file: async () => null,
    forEach: () => {}
  };
  
  FTM.libs = {
    get: async () => async function() { return mockZip; },
    turndown: async () => ({ turndown: () => '' })
  };
  
  const bytes = new Uint8Array([0, 1, 2, 3]);
  const meta = { fileName: 'empty.pptx' };
  
  const result = await FTM.parsers['.pptx'](bytes, meta);
  assert.ok(typeof result === 'string', 'should return a string');
});
