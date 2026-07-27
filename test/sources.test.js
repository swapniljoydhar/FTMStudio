'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load, SHARED, ROOT } = require('./harness');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'lib' && entry.name !== 'icons') out.push(...walk(full)); }
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const SOURCES = walk(ROOT);

test('every first-party source compiles', () => {
  assert.ok(SOURCES.length >= 15);
  for (const file of SOURCES) {
    const code = fs.readFileSync(file, 'utf8');
    assert.doesNotThrow(() => new vm.Script(code, { filename: file }), path.relative(ROOT, file));
  }
});

test('no source references a module deleted in the refactor', () => {
  const dead = ['FTM.processBinaryFile', 'FTM.processCsvFile', 'FTM.readRtfFile', 'FTM.processImageFile', 'FTM.applyRegexPipeline', 'FTM.injectYamlFrontmatter', 'content/utils.js', 'content/binary.js', 'content/constants.js'];
  for (const file of SOURCES) {
    const code = fs.readFileSync(file, 'utf8');
    for (const symbol of dead) assert.ok(!code.includes(symbol), path.relative(ROOT, file) + ' still references ' + symbol);
  }
});

test('the service worker loads without a document', () => {
  const { FTM, sandbox } = load(['background.js'], {});
  assert.ok(FTM.Bridge && FTM.registrar && FTM.offscreen && FTM.text && FTM.configUtils);
  assert.equal(typeof sandbox.FTM.CONSTANTS.MAX_FILE_SIZE_BYTES, 'number');
});

test('manifest only ships files that exist and drops web-accessible parsers', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.ok(fs.existsSync(path.join(ROOT, 'background.js')));
  assert.ok(manifest.permissions.includes('scripting'), 'dynamic registration needs the scripting permission');
  assert.equal(manifest.web_accessible_resources, undefined, 'web-accessible parsers allow extension fingerprinting');
  assert.equal(manifest.content_scripts, undefined, 'content scripts are registered dynamically');
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
});

test('registered content files all exist and are ordered so dependencies load first', () => {
  const { FTM } = load([...SHARED, 'sw/registrar.js']);
  const files = [...FTM.CONTENT_FILES];
  for (const file of files) assert.ok(fs.existsSync(path.join(ROOT, file)), 'missing ' + file);
  assert.ok(files.indexOf('shared/text.js') < files.indexOf('content/postprocess.js'));
  assert.ok(files.indexOf('content/transport.js') < files.indexOf('content/router.js'));
  assert.ok(files.indexOf('content/toast.js') < files.indexOf('content/intercept.js'));
});

test('offscreen and popup documents load their shared dependencies first', () => {
  for (const page of ['offscreen.html', 'popup.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(scripts.length > 1, page + ' loads no scripts');
    for (const src of scripts) assert.ok(fs.existsSync(path.join(ROOT, src)), page + ' references missing ' + src);
    assert.equal(scripts[0], 'shared/constants.js');
    assert.ok(!/\son[a-z]+\s*=|javascript:/i.test(html), page + ' contains an inline handler');
  }
});

test('pdf.js is loaded from the patched 4.x module build with eval disabled', () => {
  const loader = fs.readFileSync(path.join(ROOT, 'offscreen/loader.js'), 'utf8');
  const documents = fs.readFileSync(path.join(ROOT, 'offscreen/documents.js'), 'utf8');
  assert.match(loader, /lib\/pdf\.min\.mjs/);
  assert.match(loader, /lib\/pdf\.worker\.min\.mjs/);
  assert.match(documents, /isEvalSupported:\s*false/);
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/lockfile.json'), 'utf8')).libraries;
  assert.equal(lock['pdf.min.mjs'].version, '4.10.38');
  assert.equal(lock['xlsx.mini.min.js'].version, '0.20.3');
  for (const [name, entry] of Object.entries(lock)) {
    assert.ok(fs.existsSync(path.join(ROOT, 'lib', name)), 'lockfile lists missing ' + name);
    assert.match(entry.sha256_hex, /^[0-9a-f]{64}$/);
  }
});

test('no source logs on load or injects HTML into the page', () => {
  for (const file of SOURCES) {
    const code = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file);
    if (relative !== 'popup.js') assert.ok(!/\.innerHTML\s*=/.test(code), relative + ' assigns innerHTML');
    assert.ok(!/console\.(log|info)\(/.test(code), relative + ' logs on every page');
  }
});
