const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT } = require('./harness');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'lib' && entry.name !== 'icons') out.push(...walk(full));
    } else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const SOURCES = walk(ROOT);

test('every first-party source compiles', () => {
  assert.ok(SOURCES.length >= 12);
  for (const file of SOURCES) {
    const code = fs.readFileSync(file, 'utf8');
    assert.doesNotThrow(() => new vm.Script(code, { filename: file }), path.relative(ROOT, file));
  }
});

test('manifest requests no host, scripting, offscreen, or download access', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
});

test('manual converter loads only existing local scripts in dependency order', () => {
  const html = fs.readFileSync(path.join(ROOT, 'convert.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 10);
  for (const src of scripts) assert.ok(fs.existsSync(path.join(ROOT, src)), 'missing ' + src);
  assert.equal(scripts[0], 'shared/browser.js');
  assert.equal(scripts.at(-1), 'convert.js');
  assert.ok(!/\son[a-z]+\s*=|javascript:/i.test(html));
});

test('popup contains no page-access controls and loads its adapter first', () => {
  const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  assert.match(html, /id="open-converter"/);
  assert.doesNotMatch(html, /site-search|custom-site|request.*permission/i);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(scripts[0], 'shared/browser.js');
  for (const src of scripts) assert.ok(fs.existsSync(path.join(ROOT, src)), 'missing ' + src);
});

test('no first-party source uses unsafe HTML sinks or dynamic code execution', () => {
  for (const file of SOURCES) {
    const code = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file);
    assert.doesNotMatch(code, /\.innerHTML\s*=|insertAdjacentHTML|document\.write\s*\(|new Function\s*\(|eval\s*\(/, relative);
  }
});

test('parser libraries remain pinned and PDF evaluation is disabled', () => {
  const loader = fs.readFileSync(path.join(ROOT, 'offscreen/loader.js'), 'utf8');
  const documents = fs.readFileSync(path.join(ROOT, 'offscreen/documents.js'), 'utf8');
  assert.match(loader, /lib\/pdf\.min\.mjs/);
  assert.match(loader, /lib\/pdf\.worker\.min\.mjs/);
  assert.match(documents, /isEvalSupported:\s*false/);
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/lockfile.json'), 'utf8')).libraries;
  for (const [name, entry] of Object.entries(lock)) {
    assert.ok(fs.existsSync(path.join(ROOT, 'lib', name)), 'lockfile lists missing ' + name);
    assert.match(entry.sha256_hex, /^[0-9a-f]{64}$/);
  }
});
