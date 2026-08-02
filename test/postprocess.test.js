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
  const yaml = FTM.postprocess.frontmatter({ name: 'a: "b" {c}\\d', size: 1234 }, 'Hello world test content');
  assert.match(yaml, /^---\n/);
  assert.match(yaml, /original_file: "a: \\"b\\" \{c\}\\\\d"\n/);
  assert.match(yaml, /original_size: 1234\n/);
  assert.match(yaml, /word_count: 4\n/);
  assert.match(yaml, /token_estimate: \d+/);
  assert.match(yaml, /content_hash: "[0-9a-f]+"/);
  assert.match(yaml, /recommended_chunk_level: "h1"/);
  assert.match(yaml, /\n---\n$/);
});

test('frontmatter computes correct word count and token estimate', () => {
  const FTM = fresh();
  const body = 'The quick brown fox jumps over the lazy dog';
  const yaml = FTM.postprocess.frontmatter({ name: 'test.md', size: 100 }, body);
  assert.match(yaml, /word_count: 9\n/);
  assert.match(yaml, /token_estimate: 11\n/);
});

test('frontmatter recommends chunk level from headings', () => {
  const FTM = fresh();
  const body = '## Section\nContent here';
  const yaml = FTM.postprocess.frontmatter({ name: 'test.md', size: 100 }, body);
  assert.match(yaml, /recommended_chunk_level: "h2"\n/);
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
  assert.equal(FTM.postprocess.enforceHeadingHierarchy('# A\n### B\n'), '# A\n## B\n');
  assert.equal(FTM.postprocess.enforceHeadingHierarchy('no headings'), 'no headings');
});

test('stripCoverArtifacts removes license notices and boilerplate', () => {
  const FTM = fresh();
  const text = 'Licensed to Acme Corp\nAll rights reserved\n\n# Actual Title\nContent here.';
  const result = FTM.postprocess.stripCoverArtifacts(text);
  assert.ok(!result.includes('Licensed to'));
  assert.ok(!result.includes('All rights reserved'));
  assert.ok(result.includes('# Actual Title'));
  assert.ok(result.includes('Content here'));
});

test('stripCoverArtifacts removes empty headings', () => {
  const FTM = fresh();
  const text = '# \n## ***\n# Real Title\nContent.';
  const result = FTM.postprocess.stripCoverArtifacts(text);
  assert.ok(!result.startsWith('# \n')); // not an empty heading
  assert.ok(result.includes('# Real Title'));
});

test('stripTOC removes table of contents with dot leaders', () => {
  const FTM = fresh();
  const withTOC = 'Introduction ................ 1\nMethod ..................... 5\nResults ................... 12\n';
  assert.equal(FTM.postprocess.stripTOC(withTOC).trim(), '');
  const withHeading = '# Paper\n\n## Table of Contents\nChapter 1 .............. 3\nChapter 2 .............. 7\n\n# Chapter 1\nContent here.\n';
  const stripped = FTM.postprocess.stripTOC(withHeading);
  assert.ok(!stripped.includes('..............'));
  assert.ok(stripped.includes('# Chapter 1'));
  assert.ok(stripped.includes('Content here'));
});

test('heading hierarchy prevents skipped levels', () => {
  const FTM = fresh({ enforceHeadingHierarchy: true });
  // h1 → h3 (skip h2) should become h1 → h2
  assert.equal(FTM.postprocess.enforceHeadingHierarchy('# A\n### B\n'), '# A\n## B\n');
  // h1 → h4 should become h1 → h2
  assert.equal(FTM.postprocess.enforceHeadingHierarchy('# A\n#### B\n'), '# A\n## B\n');
  // h2 → h3 → h5 should become h1 → h2 → h3
  assert.equal(FTM.postprocess.enforceHeadingHierarchy('## A\n### B\n##### C\n'), '# A\n## B\n### C\n');
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
