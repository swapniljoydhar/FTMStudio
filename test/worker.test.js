'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, SHARED } = require('./harness');

function fakePort() {
  const port = { sent: [], handlers: {}, postMessage: (m) => port.sent.push(m), disconnect: () => { port.disconnected = true; } };
  port.onMessage = { addListener: (fn) => { port.handlers.message = fn; } };
  port.onDisconnect = { addListener: (fn) => { port.handlers.disconnect = fn; } };
  return port;
}

function swSandbox() {
  const ctx = load([...SHARED, 'sw/offscreen-manager.js', 'sw/bridge.js', 'sw/registrar.js']);
  const created = [];
  ctx.sandbox.chrome.offscreen = {
    createDocument: async (d) => { created.push(d); },
    closeDocument: async () => { created.push('closed'); }
  };
  ctx.sandbox.chrome.runtime.getContexts = async () => [];
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
  const offscreenPort = fakePort();
  ctx.sandbox.chrome.runtime.connect = () => offscreenPort;
  const contentPort = fakePort();
  const bridge = new ctx.FTM.Bridge(contentPort);
  bridge.start();
  // Same task as start(): the offscreen document is still being created.
  contentPort.handlers.message({ type: ctx.FTM.MSG.BEGIN, data: { fileName: 'a.docx' } });
  contentPort.handlers.message({ type: ctx.FTM.MSG.CHUNK, data: { base64: 'AAAA' } });
  assert.equal(offscreenPort.sent.length, 0);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(offscreenPort.sent.map((m) => m.type), [ctx.FTM.MSG.BEGIN, ctx.FTM.MSG.CHUNK], 'early messages must not be dropped');
});

test('bridge rejects a queue flood instead of buffering without bound', () => {
  const ctx = swSandbox();
  ctx.sandbox.chrome.runtime.connect = () => fakePort();
  const contentPort = fakePort();
  const bridge = new ctx.FTM.Bridge(contentPort);
  bridge.start();
  for (let i = 0; i < ctx.FTM.CONSTANTS.QUEUED_MESSAGE_LIMIT + 5; i++) {
    contentPort.handlers.message({ type: ctx.FTM.MSG.CHUNK, data: { base64: 'A' } });
  }
  assert.equal(bridge.closed, true);
  assert.equal(contentPort.sent[0].type, ctx.FTM.MSG.ERROR);
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

test('registrar builds host patterns for smart mode only', () => {
  const { FTM } = swSandbox();
  const config = FTM.configUtils.defaults({ customAiHosts: ['+corp.example'], domainBlacklist: ['bank.example'] });
  const matches = FTM.registrar.matches(config);
  assert.ok(matches.includes('*://corp.example/*'));
  assert.ok(matches.includes('*://*.corp.example/*'));
  assert.ok(!matches.includes('<all_urls>'), 'smart mode must not inject everywhere');
  assert.deepEqual([...FTM.registrar.excludes(config)], ['*://bank.example/*', '*://*.bank.example/*']);
  assert.deepEqual([...FTM.registrar.matches(FTM.configUtils.defaults({ smartMode: false }))], ['<all_urls>']);
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
  const ctx = load([...SHARED, 'offscreen.js']);
  const { FTM } = ctx;
  const seen = [];
  FTM.parsers = { '.docx': async (bytes, meta) => { seen.push([bytes.length, meta.fileName]); return '# done'; } };
  FTM.libs = { release: () => {} };
  const port = fakePort();
  const session = new FTM.Session(port);
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const chunks = FTM.text.encodeChunks(bytes, 2);
  session.handle({ type: FTM.MSG.BEGIN, data: { fileName: 'a.docx', extension: '.docx', size: 5, totalChunks: chunks.length } });
  chunks.forEach((base64, index) => session.handle({ type: FTM.MSG.CHUNK, data: { base64, index: index + 1 } }));
  session.handle({ type: FTM.MSG.END });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([...seen[0]], [5, 'a.docx']);
  assert.equal(port.sent[0].type, FTM.MSG.RESULT);
  assert.equal(port.sent[0].data.markdown, '# done');
});

test('offscreen session reports incomplete and malformed transfers', async () => {
  const { FTM } = load([...SHARED, 'offscreen.js']);
  FTM.parsers = {};
  FTM.libs = { release: () => {} };
  const port = fakePort();
  const session = new FTM.Session(port);
  session.handle({ type: FTM.MSG.CHUNK, data: { base64: 'AA' } });
  assert.match(port.sent[0].data.error, /Unexpected chunk/);
  session.handle({ type: FTM.MSG.BEGIN, data: { fileName: 'a.docx' } });
  assert.match(port.sent[1].data.error, /Invalid request/);
  session.handle({ type: FTM.MSG.BEGIN, data: { fileName: 'a.docx', extension: '.docx', size: 2, totalChunks: 2 } });
  session.handle({ type: FTM.MSG.END });
  assert.match(port.sent[2].data.error, /Incomplete transfer/);
});

test('offscreen session rejects unsupported and empty payloads', async () => {
  const { FTM } = load([...SHARED, 'offscreen.js']);
  FTM.parsers = { '.docx': async () => '# x' };
  await assert.rejects(() => FTM.parse({ extension: '.zip', fileName: 'a.zip' }, new Uint8Array([1])), /Unsupported/);
  await assert.rejects(() => FTM.parse({ extension: '.docx', fileName: 'a.docx' }, new Uint8Array(0)), /empty/);
});
