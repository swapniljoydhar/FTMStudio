'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadShared, loadContent } = require('./harness');

test('defaults expose every documented key', () => {
  const { FTM } = loadShared();
  const config = FTM.configUtils.defaults({});
  for (const key of ['enabled', 'smartMode', 'autoConvert', 'autoDismissSeconds', 'categories', 'regexPipeline', 'maxConversions']) {
    assert.ok(key in config, 'missing ' + key);
  }
  assert.equal(config.categories.documents, true);
});

test('merge rejects prototype-polluting keys from storage', () => {
  const { FTM, run } = loadShared();
  const poisoned = JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1, "enabled": false}');
  const config = FTM.configUtils.merge(FTM.DEFAULT_CONFIG, poisoned);
  assert.equal(config.enabled, false);
  assert.equal(run('({}).polluted === undefined'), true, 'Object.prototype was polluted');
  assert.notEqual(config.constructor, 1, 'constructor must not be overwritten');
  assert.equal(({}).polluted, undefined);
});

test('merge deep-merges categories without dropping unspecified ones', () => {
  const { FTM } = loadShared();
  const config = FTM.configUtils.merge(FTM.DEFAULT_CONFIG, { categories: { pdf: false } });
  assert.equal(config.categories.pdf, false);
  assert.equal(config.categories.documents, true);
});

test('sanitizeRules strips invalid flags and non-string patterns', () => {
  const { FTM } = loadShared();
  const rules = FTM.configUtils.sanitizeRules([
    { pattern: 'a', flags: 'gxyz!' },
    { pattern: '', flags: 'g' },
    { pattern: 42 },
    null,
    { pattern: 'b', replacement: 'c', enabled: false }
  ]);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].flags, 'gy');
  assert.equal(rules[1].enabled, false);
});

test('effectiveHosts applies + and - overrides', () => {
  const { FTM } = loadShared();
  const hosts = FTM.configUtils.effectiveHosts(FTM.configUtils.defaults({
    customAiHosts: ['+intranet.corp.example', '-chatgpt.com'],
    domainWhitelist: ['Notes.Example.COM']
  }));
  assert.ok(hosts.has('intranet.corp.example'));
  assert.ok(hosts.has('notes.example.com'));
  assert.ok(!hosts.has('chatgpt.com'));
});

test('activation caches the verdict and invalidates on config change', () => {
  const { FTM } = loadContent({ hostname: 'chatgpt.com' });
  let calls = 0;
  const original = FTM.activation.evaluate.bind(FTM.activation);
  FTM.activation.evaluate = () => { calls++; return original(); };
  assert.equal(FTM.activation.shouldActivate(), true);
  assert.equal(FTM.activation.shouldActivate(), true);
  assert.equal(calls, 1, 'verdict must be computed once per document');
  FTM.applyConfig({ smartMode: true, domainBlacklist: ['chatgpt.com'] });
  assert.equal(FTM.activation.shouldActivate(), false);
  assert.equal(calls, 2);
});

test('smart mode blocks non-AI hosts and honours removals', () => {
  const bank = loadContent({ hostname: 'bank.example.com' }).FTM;
  assert.equal(bank.activation.shouldActivate(), false);
  const ai = loadContent({ hostname: 'claude.ai' }).FTM;
  assert.equal(ai.activation.shouldActivate(), true);
  ai.applyConfig({ customAiHosts: ['-claude.ai'] });
  assert.equal(ai.activation.shouldActivate(), false);
});

test('smart mode off activates everywhere except the blacklist', () => {
  const { FTM } = loadContent({ hostname: 'bank.example.com' });
  FTM.applyConfig({ smartMode: false });
  assert.equal(FTM.activation.shouldActivate(), true);
  FTM.applyConfig({ domainBlacklist: ['example.com'] });
  assert.equal(FTM.activation.shouldActivate(), false, 'subdomains of a blacklisted domain must be blocked');
});

test('file eligibility follows the category toggles', () => {
  const { FTM } = loadContent({ hostname: 'chatgpt.com' });
  assert.equal(FTM.activation.shouldInterceptFile({ name: 'a.PDF' }), true);
  FTM.applyConfig({ categories: { pdf: false } });
  assert.equal(FTM.activation.shouldInterceptFile({ name: 'a.pdf' }), false);
  assert.equal(FTM.activation.shouldInterceptFile({ name: 'a.exe' }), false);
});
