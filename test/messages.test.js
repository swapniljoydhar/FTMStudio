'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, SHARED } = require('./harness');

function loadMessages(options) {
  return load([...SHARED, 'shared/messages.js'], options);
}

// ── Message type validators ─────────────────────────────────────────────

test('validBegin accepts a well-formed BEGIN message', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.BEGIN,
    data: {
      fileName: 'test.pdf',
      extension: '.pdf',
      size: 1000,
      totalChunks: 1
    }
  };
  assert.equal(FTM.messages.fromContent(msg), true);
});

test('validBegin rejects missing type', () => {
  const { FTM } = loadMessages();
  const msg = {
    data: { fileName: 'test.pdf', extension: '.pdf', size: 1000, totalChunks: 1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validBegin rejects wrong message type', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.RESULT,
    data: { fileName: 'test.pdf', extension: '.pdf', size: 1000, totalChunks: 1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validBegin rejects missing data', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.BEGIN };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validBegin rejects empty filename', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.BEGIN,
    data: { fileName: '', extension: '.pdf', size: 1000, totalChunks: 1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validBegin rejects filename too long', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.BEGIN,
    data: { fileName: 'a'.repeat(256), extension: '.pdf', size: 1000, totalChunks: 1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validBegin rejects invalid extension', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.BEGIN,
    data: { fileName: 'test.xyz', extension: '.xyz', size: 1000, totalChunks: 1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validBegin rejects negative size', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.BEGIN,
    data: { fileName: 'test.pdf', extension: '.pdf', size: -1, totalChunks: 1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validBegin rejects oversized file', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.BEGIN,
    data: { fileName: 'test.pdf', extension: '.pdf', size: FTM.CONSTANTS.MAX_FILE_SIZE_BYTES + 1, totalChunks: 1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validBegin rejects negative totalChunks', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.BEGIN,
    data: { fileName: 'test.pdf', extension: '.pdf', size: 1000, totalChunks: -1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

// ── Chunk validator ─────────────────────────────────────────────────────

test('validChunk accepts a well-formed CHUNK message', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.CHUNK,
    data: { base64: 'SGVsbG8=', index: 1 }
  };
  assert.equal(FTM.messages.fromContent(msg), true);
});

test('validChunk rejects missing base64', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.CHUNK, data: { index: 1 } };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validChunk rejects invalid base64 characters', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.CHUNK,
    data: { base64: 'SGVsbG8!!!', index: 1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validChunk rejects zero index', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.CHUNK,
    data: { base64: 'SGVsbG8=', index: 0 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validChunk rejects negative index', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.CHUNK,
    data: { base64: 'SGVsbG8=', index: -1 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validChunk rejects non-integer index', () => {
  const { FTM } = loadMessages();
  const msg = {
    type: FTM.MSG.CHUNK,
    data: { base64: 'SGVsbG8=', index: 1.5 }
  };
  assert.equal(FTM.messages.fromContent(msg), false);
});

// ── Error validator ────────────────────────────────────────────────────

test('validError accepts a well-formed ERROR message', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.ERROR, data: { error: 'Something went wrong' } };
  assert.equal(FTM.messages.fromContent(msg), true);
});

test('validError rejects missing error field', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.ERROR, data: {} };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validError rejects non-string error', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.ERROR, data: { error: 123 } };
  assert.equal(FTM.messages.fromContent(msg), false);
});

test('validError rejects error message too long', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.ERROR, data: { error: 'x'.repeat(1025) } };
  assert.equal(FTM.messages.fromContent(msg), false);
});

// ── ACK validator ──────────────────────────────────────────────────────

test('ACK is accepted from offscreen (validAck)', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.ACK, data: { index: 1 } };
  // fromOffscreen handles ACK
  assert.equal(FTM.messages.fromOffscreen(msg), true);
});

test('ACK rejects zero index', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.ACK, data: { index: 0 } };
  assert.equal(FTM.messages.fromOffscreen(msg), false);
});

// ── RESULT validator ──────────────────────────────────────────────────

test('RESULT is accepted from offscreen with valid markdown', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.RESULT, data: { markdown: '# Hello World' } };
  assert.equal(FTM.messages.fromOffscreen(msg), true);
});

test('RESULT rejects missing markdown field', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.RESULT, data: {} };
  assert.equal(FTM.messages.fromOffscreen(msg), false);
});

test('RESULT rejects non-string markdown', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.RESULT, data: { markdown: 123 } };
  assert.equal(FTM.messages.fromOffscreen(msg), false);
});

// ── END message ───────────────────────────────────────────────────────

test('END message is accepted from content', () => {
  const { FTM } = loadMessages();
  const msg = { type: FTM.MSG.END };
  assert.equal(FTM.messages.fromContent(msg), true);
});

// ── isTrustedPort ──────────────────────────────────────────────────────

test('isTrustedPort rejects null port', () => {
  const { FTM } = loadMessages();
  assert.equal(FTM.messages.isTrustedPort(null), false);
});

test('isTrustedPort rejects port without sender', () => {
  const { FTM } = loadMessages();
  assert.equal(FTM.messages.isTrustedPort({}), false);
});
