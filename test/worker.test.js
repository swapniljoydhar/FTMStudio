'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, SHARED } = require('./harness');

const SHARED_WITH_MSG = [...SHARED, 'shared/messages.js'];
const SID = 'a'.repeat(32);

function fakePort() {
  const port = { sent: [], handlers: {}, postMessage: (m) => port.sent.push(m), disconnect: () => { port.disconnected = true; } };
  port.onMessage = { addListener: (fn) => { port.handlers.message = fn; } };
  port.onDisconnect = { addListener: (fn) => { port.handlers.disconnect = fn; } };
  return port;
}

function swSandbox() {
  const ctx = load([...SHARED_WITH_MSG, 'sw/offscreen-manager.js', 'sw/bridge.js', 'sw/registrar.js']);
  const created = [];
  ctx.sandbox.chrome.offscreen = {
    createDocument: async (d) => { created.push(d); },
    closeDocument: async () => { created.push('closed'); }
  };
  ctx.sandbox.chrome.runtime.getContexts = async () => [];
  ctx.sandbox.chrome.permissions = { contains: async () => false };
  ctx.sandbox.chrome.offscreen = ctx.sandbox.chrome.offscreen || {};
  ctx.created = created;
  return ctx;
}

test('offscreen document is created once for concurrent callers', async () => {
  const { FTM, created } = swSandbox();
  await Promise.all([FTM.offscreen.ensure(), FTM.offscreen.ensure(), FTM.offscreen.ensure()]);
  assert.equal(created.length, 1);
  await FTM.offscreen.ensure();
  assert.equal(created.length, 1, 'a ready document must not be recreated');
});

test('offscreen teardown is reference counted', async () => {
  const { FTM } = swSandbox();
  FTM.offscreen.retain();
  FTM.offscreen.retain();
  FTM.offscreen.release();
  assert.equal(FTM.offscreen.users, 1);
  assert.equal(FTM.offscreen.idleTimer, null, 'must not schedule a close while a user remains');
  FTM.offscreen.release();
  assert.notEqual(FTM.offscreen.idleTimer, null);
  clearTimeout(FTM.offscreen.idleTimer);
});

test('bridge queues messages sent before the offscreen port exists', async () => {
  const ctx = swSandbox();
  const { FTM } = ctx;
  const offscreenPort = fakePort();
  ctx.sandbox.chrome.runtime.connect = () => offscreenPort;
  const contentPort = fakePort();
  const bridge = new FTM.Bridge(contentPort);
  bridge.start();
  // Same task as start(): the offscreen document is still being created.
  // Send valid BEGIN and CHUNK messages (sessionId + all required fields).
  const chunkSize = FTM.CONSTANTS.TRANSFER_CHUNK_BYTES;
  contentPort.handlers.message({ type: FTM.MSG.BEGIN, data: { sessionId: SID, fileName: 'a.docx', extension: '.docx', size: 4, chunkSize, totalChunks: Math.ceil(4 / chunkSize) } });
  contentPort.handlers.message({ type: FTM.MSG.CHUNK, data: { sessionId: SID, base64: 'AAAA', index: 1 } });
  assert.equal(offscreenPort.sent.length, 0);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(offscreenPort.sent.map((m) => m.type), [FTM.MSG.BEGIN, FTM.MSG.CHUNK], 'early messages must not be dropped');
});

test('bridge rejects a queue flood instead of buffering without bound', () => {
  const ctx = swSandbox();
  const { FTM } = ctx;
  ctx.sandbox.chrome.runtime.connect = () => fakePort();
  const contentPort = fakePort();
  const bridge = new FTM.Bridge(contentPort);
  bridge.start();
  // Send a valid BEGIN to set sessionId.
  const chunkSize = FTM.CONSTANTS.TRANSFER_CHUNK_BYTES;
  contentPort.handlers.message({ type: FTM.MSG.BEGIN, data: { sessionId: SID, fileName: 'a.docx', extension: '.docx', size: chunkSize * 2, chunkSize, totalChunks: 2 } });
  // Directly fill the queue to the limit (valid messages can't overflow because
  // maxChunks < QUEUED_MESSAGE_LIMIT, so we test the guard by filling manually).
  while (bridge.queue.length < FTM.CONSTANTS.QUEUED_MESSAGE_LIMIT) {
    bridge.queue.push({ type: FTM.MSG.CHUNK, data: { sessionId: SID, base64: 'AQI=', index: bridge.queue.length + 1 } });
  }
  // One more message through the handler should trigger overflow.
  contentPort.handlers.message({ type: FTM.MSG.CHUNK, data: { sessionId: SID, base64: 'AQI=', index: 999 } });
  assert.equal(bridge.closed, true);
  const error = contentPort.sent.find((m) => m.type === FTM.MSG.ERROR);
  assert.ok(error, 'must send error to content port');
  assert.match(error.data.error, /queue overflow/i);
});

test('each content connection gets its own offscreen port', async () => {
  const ctx = swSandbox();
  const ports = [];
  ctx.sandbox.chrome.runtime.connect = () => { const p = fakePort(); ports.push(p); return p; };
  const a = new ctx.FTM.Bridge(fakePort());
  const b = new ctx.FTM.Bridge(fakePort());
  a.start();
  b.start();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ports.length, 2);
  assert.notEqual(a.offscreenPort, b.offscreenPort);
  assert.equal(ctx.FTM.offscreen.users, 2);
});

test('registrar builds host patterns for smart mode only', async () => {
  const { FTM, sandbox } = swSandbox();
  const config = FTM.configUtils.defaults({ customAiHosts: ['+corp.example'], domainBlacklist: ['bank.example'] });
  const matches = await FTM.registrar.matches(config);
  assert.ok(matches.includes('*://corp.example/*'));
  assert.ok(matches.includes('*://*.corp.example/*'));
  assert.ok(!matches.includes('<all_urls>'), 'smart mode must not inject everywhere');
  assert.deepEqual([...FTM.registrar.excludes(config)], ['*://bank.example/*', '*://*.bank.example/*']);
  // Classic Mode requires <all_urls> permission.
  sandbox.chrome.permissions = { contains: async () => true };
  const classicMatches = await FTM.registrar.matches(FTM.configUtils.defaults({ smartMode: false }));
  assert.deepEqual([...classicMatches], ['<all_urls>']);
});

test('registrar rejects malformed hosts and never falls back to <all_urls>', async () => {
  const { FTM, sandbox } = swSandbox();
  assert.deepEqual([...FTM.registrar.patternsFor(['ok.example', 'bad host', '*', 'http://x.example'])], ['*://ok.example/*', '*://*.ok.example/*']);
  sandbox.chrome.scripting.registerContentScripts = async () => { throw new Error('too many patterns'); };
  const result = await FTM.registrar.register(['*://a.example/*'], []);
  assert.equal(result.registered, false);
});

test('registrar registers only isolated-world scripts at document_start', () => {
  const { FTM } = swSandbox();
  const spec = FTM.registrar.spec(['*://a.example/*'], []);
  assert.equal(spec.world, 'ISOLATED');
  assert.equal(spec.runAt, 'document_start');
  assert.equal(spec.allFrames, false);
  assert.deepEqual([...spec.js].slice(0, 3), ['shared/constants.js', 'shared/text.js', 'shared/config.js']);
});

test('registrar unregisters and skips registration when disabled', async () => {
  const { FTM, sandbox } = swSandbox();
  const calls = [];
  sandbox.chrome.scripting.unregisterContentScripts = async (arg) => { calls.push(arg); };
  sandbox.chrome.scripting.registerContentScripts = async () => { calls.push('register'); };
  const result = await FTM.registrar.sync(FTM.configUtils.defaults({ enabled: false }));
  assert.equal(result.registered, false);
  assert.ok(!calls.includes('register'));
});

test('offscreen session reassembles chunks and dispatches to the parser', async () => {
  const ctx = load([...SHARED_WITH_MSG, 'offscreen.js']);
  const { FTM } = ctx;
  const seen = [];
  FTM.parsers = { '.docx': async (bytes, meta) => { seen.push([bytes.length, meta.fileName]); return '# done'; } };
  FTM.libs = { release: () => {} };
  const port = fakePort();
  const session = new FTM.Session(port);
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  // Use default chunk size so totalChunks matches the validator's expectation.
  const chunks = FTM.text.encodeChunks(bytes);
  const chunkSize = FTM.CONSTANTS.TRANSFER_CHUNK_BYTES;
  const totalChunks = Math.ceil(bytes.length / chunkSize);
  session.handle({ type: FTM.MSG.BEGIN, data: { sessionId: SID, fileName: 'a.docx', extension: '.docx', size: bytes.length, chunkSize, totalChunks } });
  chunks.forEach((base64, index) => session.handle({ type: FTM.MSG.CHUNK, data: { sessionId: SID, base64, index: index + 1 } }));
  session.handle({ type: FTM.MSG.END, data: { sessionId: SID } });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...seen[0]], [5, 'a.docx']);
  assert.deepEqual(port.sent.filter((message) => message.type === FTM.MSG.ACK).map((message) => message.data.index), [1]);
  const result = port.sent.find((message) => message.type === FTM.MSG.RESULT);
  assert.ok(result);
  assert.equal(result.data.markdown, '# done');
});

test('offscreen session reports incomplete and malformed transfers', async () => {
  const { FTM } = load([...SHARED_WITH_MSG, 'offscreen.js']);
  FTM.parsers = {};
  FTM.libs = { release: () => {} };
  const chunkSize = FTM.CONSTANTS.TRANSFER_CHUNK_BYTES;

  // Scenario 1: CHUNK before BEGIN — passes message validation but fails session state.
  const port1 = fakePort();
  const s1 = new FTM.Session(port1);
  s1.handle({ type: FTM.MSG.CHUNK, data: { sessionId: SID, base64: 'AQI=', index: 1 } });
  assert.match(port1.sent[0].data.error, /Mismatched conversion session/);

  // Scenario 2: BEGIN without required fields — fails message validation.
  const port2 = fakePort();
  const s2 = new FTM.Session(port2);
  s2.handle({ type: FTM.MSG.BEGIN, data: { sessionId: SID, fileName: 'a.docx' } });
  assert.match(port2.sent[0].data.error, /Invalid conversion message/);

  // Scenario 3: Valid BEGIN then END without sending chunks — incomplete transfer.
  // BEGIN sends a PROGRESS message first, then END sends ERROR.
  const port3 = fakePort();
  const s3 = new FTM.Session(port3);
  s3.handle({ type: FTM.MSG.BEGIN, data: { sessionId: SID, fileName: 'a.docx', extension: '.docx', size: chunkSize, chunkSize, totalChunks: 1 } });
  s3.handle({ type: FTM.MSG.END, data: { sessionId: SID } });
  const error3 = port3.sent.find((m) => m.type === FTM.MSG.ERROR);
  assert.ok(error3, 'must send error for incomplete transfer');
  assert.match(error3.data.error, /Incomplete transfer/);
});

test('offscreen session rejects unsupported and empty payloads', async () => {
  const { FTM } = load([...SHARED_WITH_MSG, 'offscreen.js']);
  FTM.parsers = { '.docx': async () => '# x' };
  await assert.rejects(() => FTM.parse({ extension: '.zip', fileName: 'a.zip' }, new Uint8Array([1])), /Unsupported/);
  await assert.rejects(() => FTM.parse({ extension: '.docx', fileName: 'a.docx' }, new Uint8Array(0)), /empty/);
});
