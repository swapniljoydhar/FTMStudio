'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadShared } = require('./harness');

test('defaults expose the durable manual-workspace keys', () => {
  const { FTM } = loadShared();
  const config = FTM.configUtils.defaults({});
  for (const key of ['enabled', 'yamlFrontmatter', 'stripTrailingWhitespace', 'enforceHeadingHierarchy', 'categories', 'regexPipeline', 'maxConversions']) assert.ok(key in config, 'missing ' + key);
  assert.equal(config.categories.documents, true);
});

test('merge rejects prototype-polluting keys from storage', () => {
  const { FTM, run } = loadShared();
  const poisoned = JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1, "enabled": false}');
  const config = FTM.configUtils.merge(FTM.DEFAULT_CONFIG, poisoned);
  assert.equal(config.enabled, false);
  assert.equal(run('({}).polluted === undefined'), true);
  assert.notEqual(config.constructor, 1);
});

test('merge deep-merges categories without dropping unspecified ones', () => {
  const { FTM } = loadShared();
  const config = FTM.configUtils.merge(FTM.DEFAULT_CONFIG, { categories: { pdf: false } });
  assert.equal(config.categories.pdf, false);
  assert.equal(config.categories.documents, true);
});

test('sanitizeRules bounds patterns, replacements, flags, and rule count', () => {
  const { FTM } = loadShared();
  const rules = FTM.configUtils.sanitizeRules([
    { pattern: 'a', flags: 'gxyz!' }, { pattern: '', flags: 'g' }, { pattern: 42 }, null,
    { pattern: 'b', replacement: 'c', enabled: false }, { pattern: 'x'.repeat(513) }
  ]);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].flags, 'gy');
  assert.equal(rules[1].enabled, false);
});

test('domainList strips schemes and rejects malformed entries', () => {
  const { FTM } = loadShared();
  const domains = FTM.configUtils.domainList(['https://Notes.Example.COM/path', 'bad_domain', '.example.com', 'ok.example.org']);
  assert.deepEqual(domains, ['notes.example.com', 'ok.example.org']);
});

test('manual format policy excludes images and unsupported archives', () => {
  const { FTM } = loadShared();
  assert.ok(FTM.MANUAL_EXTENSIONS.has('.pdf'));
  assert.ok(FTM.MANUAL_EXTENSIONS.has('.docx'));
  assert.ok(!FTM.MANUAL_EXTENSIONS.has('.png'));
  assert.ok(!FTM.MANUAL_EXTENSIONS.has('.epub'));
  assert.ok(FTM.CONSTANTS.MAX_QUEUE_FILES > 0);
});
