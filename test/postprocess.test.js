'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent } = require('./harness');

function fresh(config) {
  const { FTM } = loadContent({ hostname: 'chatgpt.com' });
  if (config) FTM.applyConfig(config);
  return FTM;
}

test('frontmatter is valid YAML with quoted, escaped scalars', () => {
  const FTM = fresh();
  const yaml = FTM.postprocess.frontmatter({ name: 'a: "b" {c}\\d', size: 1234 });
  assert.match(yaml, /^---\n/);
  assert.match(yaml, /original_file: "a: \\"b\\" \{c\}\\\\d"\n/);
  assert.match(yaml, /original_size: 1234\n/);
  assert.match(yaml, /\n---\n$/);
});

test('injectFrontmatter replaces an existing block but keeps a leading rule', () => {
  const FTM = fresh();
  const file = { name: 'x.md', size: 10 };
  const replaced = FTM.postprocess.injectFrontmatter('---\ntitle: old\n---\n# Body\n', file);
  assert.equal(replaced.match(/^---$/gm).length, 2);
  assert.match(replaced, /# Body/);
  assert.ok(!replaced.includes('title: old'));

  const rule = FTM.postprocess.injectFrontmatter('---\n\nText\n\n---\n\nMore\n', file);
  assert.match(rule, /\n\nText\n/, 'a horizontal rule must not be eaten as frontmatter');
});

test('normalize strips trailing whitespace and collapses long newline runs', () => {
  const FTM = fresh();
  assert.equal(FTM.postprocess.normalize('a   \nb\t\n'), 'a\nb\n');
  assert.equal(FTM.postprocess.normalize('a\n\n\n\n\n\nb'), 'a\n\n\nb');
  const keep = fresh({ stripTrailingWhitespace: false });
  assert.equal(keep.postprocess.normalize('a   \n'), 'a   \n');
});

test('heading hierarchy shifts the shallowest heading to h1', () => {
  const FTM = fresh({ enforceHeadingHierarchy: true });
  assert.equal(FTM.postprocess.enforceHeadingHierarchy('### A\n#### B\n'), '# A\n## B\n');
  assert.equal(FTM.postprocess.enforceHeadingHierarchy('# A\n### B\n'), '# A\n### B\n');
  assert.equal(FTM.postprocess.enforceHeadingHierarchy('no headings'), 'no headings');
});

test('ReDoS: catastrophic patterns are rejected, benign ones accepted', () => {
  const FTM = fresh();
  for (const pattern of ['(a+)+$', '(a|aa)+$', '(.*)*x', 'a**']) {
    assert.equal(FTM.postprocess.isRegexSafe(pattern, 'g'), false, 'should reject ' + pattern);
  }
  for (const pattern of ['foo', '[*+]', '\\*\\*bold\\*\\*', '^#{1,6}\\s', 'a.*b']) {
    assert.equal(FTM.postprocess.isRegexSafe(pattern, 'g'), true, 'should accept ' + pattern);
  }
});

test('safety cache keys include flags and stay bounded', () => {
  const FTM = fresh();
  assert.equal(FTM.postprocess.isRegexSafe('(a+)+$', 'g'), false);
  assert.equal(FTM.postprocess.isRegexSafe('(a+)+$', 'gi'), false);
  for (let i = 0; i < FTM.CONSTANTS.REGEX_CACHE_MAX * 3; i++) FTM.postprocess.isRegexSafe('p' + i, 'g');
  assert.equal(FTM.postprocess.isRegexSafe('x'.repeat(3), 'g'), true);
});

test('apply runs enabled rules, skips disabled and unsafe ones', () => {
  const FTM = fresh({
    regexPipeline: [
      { pattern: 'foo', replacement: 'bar', flags: 'g', enabled: true },
      { pattern: 'bar', replacement: 'nope', flags: 'g', enabled: false },
      { pattern: '(a+)+$', replacement: 'x', flags: 'g', enabled: true },
      { pattern: '[', replacement: 'x', flags: 'g', enabled: true }
    ]
  });
  assert.equal(FTM.postprocess.apply('foo aaaa'), 'bar aaaa');
});

test('apply skips the pipeline for oversized documents', () => {
  const FTM = fresh({ regexPipeline: [{ pattern: 'a', replacement: 'b', flags: 'g', enabled: true }] });
  const big = 'a'.repeat(FTM.CONSTANTS.MAX_PIPELINE_INPUT_BYTES + 1);
  assert.equal(FTM.postprocess.apply(big), big);
});
