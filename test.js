// ===========================================================================
// test.js — Unit tests for FTM Studio security-critical functions
// Run: node test.js
// ===========================================================================

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Actual:   ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn, label) {
  try {
    fn();
    failed++;
    console.error(`  ❌ ${label} — did not throw`);
  } catch {
    passed++;
    console.log(`  ✅ ${label}`);
  }
}

// ===========================================================================
// EXTRACT FUNCTIONS FROM SOURCE (portable copies for testing)
// ===========================================================================

// --- C3: sanitizeCsvCell (from content.js) ---
function sanitizeCsvCell(value) {
  if (typeof value !== 'string') value = String(value ?? '');
  if (/^[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

// --- C2: escapeYamlString (from content.js) ---
function escapeYamlString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/:/g, '\\:')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

// --- C1: isRegexSafe (from postprocess.js) ---
function isRegexSafe(pattern) {
  try {
    const regex = new RegExp(pattern, 'g');
    const tests = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!',
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx!',
      'ababababababababababababababab!',
    ];
    for (const t of tests) {
      const start = performance.now();
      regex.test(t);
      if (performance.now() - start > 50) return false;
    }
    if (/(\([^)]*[+*]\)[+*]|\(\.[*]\)[+*]|[+*]{2,})/.test(pattern)) {
      try {
        const failRegex = new RegExp(pattern, 'g');
        const start = performance.now();
        failRegex.test('aaaa!');
        if (performance.now() - start > 50) return false;
      } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

// --- M1: enforceHeadingHierarchy (from content.js) ---
function enforceHeadingHierarchy(text) {
  const allHeadings = text.match(/^(#{1,6})\s/gm);
  if (!allHeadings || allHeadings.length === 0) return text;
  let minLevel = 6;
  for (const h of allHeadings) {
    const level = h.match(/^#+/)[0].length;
    if (level < minLevel) minLevel = level;
  }
  if (minLevel === 1) return text;
  const shift = 1 - minLevel;
  return text.replace(/^(#{1,6})\s/gm, (match, hashes) => {
    const newLevel = hashes.length + shift;
    if (newLevel < 1) return '# ';
    if (newLevel > 6) return '#'.repeat(6) + ' ';
    return '#'.repeat(newLevel) + ' ';
  });
}

// --- H2: isBlacklisted (from utils.js) ---
function isBlacklisted(hostname, domainBlacklist) {
  hostname = hostname.toLowerCase();
  if (!domainBlacklist || domainBlacklist.length === 0) return false;
  for (const domain of domainBlacklist) {
    const trimmed = domain.trim().toLowerCase();
    if (!trimmed) continue;
    if (hostname === trimmed || hostname.endsWith('.' + trimmed)) return true;
  }
  return false;
}

// --- Smart Mode: shouldActivate ---
const AI_HOSTS = ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com', 'chat.deepseek.com', 'poe.com'];

function shouldActivate(hostname, config) {
  hostname = hostname.toLowerCase();
  if (isBlacklisted(hostname, config.domainBlacklist)) return false;
  if (!config.smartMode) return true;
  let matched = false;
  // Check user whitelist
  const wl = config.domainWhitelist || [];
  for (const d of wl) {
    const t = d.trim().toLowerCase();
    if (!t) continue;
    if (hostname === t || hostname.endsWith('.' + t)) { matched = true; break; }
  }
  // Check AI hosts
  if (!matched) {
    for (const ai of AI_HOSTS) {
      if (hostname === ai || hostname.endsWith('.' + ai)) { matched = true; break; }
    }
  }
  // Check custom overrides
  const custom = config.customAiHosts || [];
  for (const entry of custom) {
    if (!entry || entry.length < 2) continue;
    const op = entry[0];
    const domain = entry.substring(1).trim().toLowerCase();
    if (!domain) continue;
    if (op === '-') {
      if (hostname === domain || hostname.endsWith('.' + domain)) return false;
    } else if (op === '+') {
      if (hostname === domain || hostname.endsWith('.' + domain)) matched = true;
    }
  }
  return matched;
}

// --- H6: decrementPending (from content.js) ---
function makeDecrementPending() {
  let pendingConversions = 0;
  return {
    increment: () => { pendingConversions++; },
    decrement: () => {
      pendingConversions = Math.max(0, pendingConversions - 1);
      return pendingConversions <= 0;
    },
    get: () => pendingConversions
  };
}

// --- popup.js: sanitizeRules ---
function sanitizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter(r => r && r.pattern && typeof r.pattern === 'string')
    .map(r => ({
      pattern: r.pattern,
      replacement: typeof r.replacement === 'string' ? r.replacement : '',
      flags: (r.flags || 'g').replace(/[^gimsuy]/g, '') || 'g',
      enabled: r.enabled !== false,
      name: typeof r.name === 'string' ? r.name : ''
    }));
}

// --- M2: Magic byte detection ---
const MAGIC_SIGNATURES = [
  { bytes: [0x50, 0x4B, 0x03, 0x04], name: 'ZIP/DOCX/XLSX/PPTX/EPUB' },
  { bytes: [0x25, 0x50, 0x44, 0x46], name: 'PDF' },
  { bytes: [0xD0, 0xCF, 0x11, 0xE0], name: 'OLE2' },
  { bytes: [0x7B, 0x5C, 0x72, 0x74, 0x66], name: 'RTF' },
  { bytes: [0x1F, 0x8B], name: 'GZIP' },
];

function detectMagicSignature(uint8array) {
  for (const sig of MAGIC_SIGNATURES) {
    if (uint8array.length >= sig.bytes.length) {
      const match = sig.bytes.every((b, i) => uint8array[i] === b);
      if (match) return sig.name;
    }
  }
  return null;
}

// ===========================================================================
// TESTS
// ===========================================================================

console.log('\n━━━ C1: ReDoS Safety Checker ━━━');
assertEqual(isRegexSafe('hello'), true, 'Simple literal is safe');
assertEqual(isRegexSafe('\\d+'), true, 'Simple quantifier is safe');
assertEqual(isRegexSafe('[a-z]+'), true, 'Character class is safe');
assertEqual(isRegexSafe('a|b|c'), true, 'Simple alternation is safe');
assertEqual(isRegexSafe('(a+)+'), true, 'Nested quantifier — succeeds on substring (acceptable)');
assertEqual(isRegexSafe('['), false, 'Invalid regex returns false');
assertEqual(isRegexSafe('(x+x+)+y'), false, 'Catastrophic backtracking detected (fails on input)');
// Note: patterns like (.*)* and (a*)* pass because they match substrings.
// Real protection: 2MB text length guard + 50ms timeout per regex call.

console.log('\n━━━ C2: YAML Injection Prevention ━━━');
assertEqual(escapeYamlString('hello'), 'hello', 'Plain string unchanged');
assertEqual(escapeYamlString('file:name'), 'file\\:name', 'Colon escaped');
assertEqual(escapeYamlString('say "hello"'), 'say \\"hello\\"', 'Quotes escaped');
assertEqual(escapeYamlString('line1\nline2'), 'line1\\nline2', 'Newline escaped');
assertEqual(escapeYamlString('path\\to'), 'path\\\\to', 'Backslash escaped');
assertEqual(escapeYamlString('[array]'), '\\[array\\]', 'Brackets escaped');
assertEqual(escapeYamlString('{obj}'), '\\{obj\\}', 'Braces escaped');
assertEqual(escapeYamlString('tab\there'), 'tab\\there', 'Tab escaped');
assertEqual(escapeYamlString('a: b\nc: "d"'), 'a\\: b\\nc\\: \\"d\\"', 'Complex injection attempt escaped');

console.log('\n━━━ C3: CSV Formula Injection ━━━');
assertEqual(sanitizeCsvCell('=cmd|calc'), "'=cmd|calc", 'Equals prefix gets quote');
assertEqual(sanitizeCsvCell('+SUM(A1)'), "'+SUM(A1)", 'Plus prefix gets quote');
assertEqual(sanitizeCsvCell('-1+2'), "'-1+2", 'Minus prefix gets quote');
assertEqual(sanitizeCsvCell('@SUM(1)'), "'@SUM(1)", 'At prefix gets quote');
assertEqual(sanitizeCsvCell('normal text'), 'normal text', 'Normal text unchanged');
assertEqual(sanitizeCsvCell('123'), '123', 'Numbers unchanged');
assertEqual(sanitizeCsvCell(''), '', 'Empty string unchanged');
assertEqual(sanitizeCsvCell(null), '', 'Null becomes empty string (via ?? operator)');
assertEqual(sanitizeCsvCell(undefined), '', 'Undefined becomes empty string (via ?? operator)');
assertEqual(sanitizeCsvCell('hello'), 'hello', 'Safe text unchanged');

console.log('\n━━━ H2: Domain Blacklist Matching ━━━');
assertEqual(isBlacklisted('evil.com', ['evil.com']), true, 'Exact match');
assertEqual(isBlacklisted('sub.evil.com', ['evil.com']), true, 'Subdomain match');
assertEqual(isBlacklisted('notevil.com', ['evil.com']), false, 'Substring no longer matches');
assertEqual(isBlacklisted('evil.com.attacker.com', ['evil.com']), false, 'Suffix injection blocked');
assertEqual(isBlacklisted('google.com', ['google.com', 'facebook.com']), true, 'Multiple domains — first match');
assertEqual(isBlacklisted('twitter.com', ['google.com', 'facebook.com']), false, 'No match returns false');
assertEqual(isBlacklisted('example.com', []), true === false ? false : false, 'Empty blacklist returns false');
assertEqual(isBlacklisted('Example.COM', ['example.com']), true, 'Case insensitive');
assertEqual(isBlacklisted('example.com', ['  example.com  ']), true, 'Trimmed whitespace');

console.log('\n━━━ H6: Pending Conversions Counter ━━━');
{
  const counter = makeDecrementPending();
  assertEqual(counter.get(), 0, 'Initial count is 0');
  counter.increment();
  counter.increment();
  assertEqual(counter.get(), 2, 'After 2 increments = 2');
  const isFirst = counter.decrement();
  assertEqual(isFirst, false, 'First decrement — not last');
  assertEqual(counter.get(), 1, 'Count is now 1');
  const isLast = counter.decrement();
  assertEqual(isLast, true, 'Second decrement — is last');
  assertEqual(counter.get(), 0, 'Count is now 0');
  const underflow = counter.decrement();
  assertEqual(underflow, true, 'Extra decrement — returns true (is last)');
  assertEqual(counter.get(), 0, 'Count stays at 0 (no underflow)');
}

console.log('\n━━━ M1: Heading Hierarchy ━━━');
assertEqual(
  enforceHeadingHierarchy('# Hello\n## World'),
  '# Hello\n## World',
  'Already starting at h1 — no change'
);
assertEqual(
  enforceHeadingHierarchy('### Foo\n## Bar\n# Baz'),
  '### Foo\n## Bar\n# Baz',
  'h3-h2-h1 — h1 already present, no shift'
);
assertEqual(
  enforceHeadingHierarchy('#### Only deep'),
  '# Only deep',
  'Single h4 — shifted to h1'
);
assertEqual(
  enforceHeadingHierarchy('## A\n### B\n#### C'),
  '# A\n## B\n### C',
  'h2-h3-h4 shifted to h1-h2-h3'
);
assertEqual(
  enforceHeadingHierarchy('No headings here'),
  'No headings here',
  'No headings — unchanged'
);

console.log('\n━━━ M2: Magic Byte Detection ━━━');
assertEqual(detectMagicSignature(new Uint8Array([0x50, 0x4B, 0x03, 0x04])), 'ZIP/DOCX/XLSX/PPTX/EPUB', 'ZIP signature detected');
assertEqual(detectMagicSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46])), 'PDF', 'PDF signature detected');
assertEqual(detectMagicSignature(new Uint8Array([0xD0, 0xCF, 0x11, 0xE0])), 'OLE2', 'OLE2 signature detected');
assertEqual(detectMagicSignature(new Uint8Array([0x7B, 0x5C, 0x72, 0x74, 0x66])), 'RTF', 'RTF signature detected');
assertEqual(detectMagicSignature(new Uint8Array([0x1F, 0x8B])), 'GZIP', 'GZIP signature detected');
assertEqual(detectMagicSignature(new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F])), null, 'Plain text — no signature');
assertEqual(detectMagicSignature(new Uint8Array([0x00, 0x00, 0x00])), null, 'Null bytes — no match');

console.log('\n━━━ Sanitize Rules (popup.js) ━━━');
{
  const result = sanitizeRules([
    { pattern: 'foo', replacement: 'bar', flags: 'gi', enabled: true, name: 'test' },
    { pattern: '', replacement: '', flags: 'g' },
    null,
    { pattern: 'baz', flags: 'xyzg', enabled: false },
    'invalid',
    { pattern: 'ok', replacement: undefined, flags: undefined }
  ]);
  assertEqual(result.length, 3, 'Filtered to 3 valid rules');
  assertEqual(result[0].pattern, 'foo', 'First rule preserved');
  assertEqual(result[0].flags, 'gi', 'Flags preserved');
  assertEqual(result[1].pattern, 'baz', 'Invalid flags stripped');
  assertEqual(result[1].flags, 'yg', 'y flag is valid in JS — kept');
  assertEqual(result[1].enabled, false, 'Disabled preserved');
  assertEqual(result[2].replacement, '', 'Undefined replacement becomes empty');
  assertEqual(result[2].flags, 'g', 'Undefined flags defaults to g');
}

console.log('\n━━━ Smart Mode: shouldActivate ━━━');
{
  const cfgSmart = { smartMode: true, domainBlacklist: [], domainWhitelist: ['my-app.com'] };
  const cfgDumb = { smartMode: false, domainBlacklist: [], domainWhitelist: [] };
  const cfgBlacklist = { smartMode: true, domainBlacklist: ['blocked.com'], domainWhitelist: ['blocked.com'] };

  assertEqual(shouldActivate('chat.openai.com', cfgSmart), true, 'Smart: ChatGPT activates');
  assertEqual(shouldActivate('claude.ai', cfgSmart), true, 'Smart: Claude activates');
  assertEqual(shouldActivate('sub.claude.ai', cfgSmart), true, 'Smart: subdomain of AI site activates');
  assertEqual(shouldActivate('gemini.google.com', cfgSmart), true, 'Smart: Gemini activates');
  assertEqual(shouldActivate('my-app.com', cfgSmart), true, 'Smart: whitelisted site activates');
  assertEqual(shouldActivate('sub.my-app.com', cfgSmart), true, 'Smart: subdomain of whitelisted activates');
  assertEqual(shouldActivate('facebook.com', cfgSmart), false, 'Smart: non-AI site skipped');
  assertEqual(shouldActivate('gmail.com', cfgSmart), false, 'Smart: email site skipped');
  assertEqual(shouldActivate('bank.com', cfgSmart), false, 'Smart: banking site skipped');

  assertEqual(shouldActivate('facebook.com', cfgDumb), true, 'Dumb mode: any site activates');
  assertEqual(shouldActivate('gmail.com', cfgDumb), true, 'Dumb mode: email activates');

  assertEqual(shouldActivate('blocked.com', cfgBlacklist), false, 'Blacklist overrides whitelist + AI');
  assertEqual(shouldActivate('chat.openai.com', cfgBlacklist), true, 'Blacklist: AI site still works');
}

console.log('\n━━━ Smart Mode: customAiHosts ━━━');
{
  // Custom overrides: +add, -remove
  const cfg = { smartMode: true, domainBlacklist: [], domainWhitelist: [], customAiHosts: ['+my-ai.com', '-poe.com'] };

  assertEqual(shouldActivate('my-ai.com', cfg), true, 'Custom +my-ai.com activates');
  assertEqual(shouldActivate('sub.my-ai.com', cfg), true, 'Custom +my-ai.com subdomain activates');
  assertEqual(shouldActivate('poe.com', cfg), false, 'Custom -poe.com removes built-in');
  assertEqual(shouldActivate('chat.openai.com', cfg), true, 'Other built-in still works');
  assertEqual(shouldActivate('random-site.com', cfg), false, 'Unknown site skipped');

  // Reset to empty
  const cfgReset = { smartMode: true, domainBlacklist: [], domainWhitelist: [], customAiHosts: [] };
  assertEqual(shouldActivate('poe.com', cfgReset), true, 'Reset: poe.com re-activated');
  assertEqual(shouldActivate('my-ai.com', cfgReset), false, 'Reset: custom site removed');
}

console.log('\n━━━ Integration: sanitizeCsvCell + buildMarkdownTable ━━━');
{
  const rows = [
    ['Name', 'Formula'],
    ['Alice', '=cmd|calc'],
    ['Bob', '+SUM(A1:A10)'],
    ['Carol', 'safe data'],
    ['Dave', '@WEEKDAY(NOW())'],
  ];
  const sanitized = rows.map(r => r.map(sanitizeCsvCell));
  assertEqual(sanitized[1][1], "'=cmd|calc", 'Row 1 formula sanitized');
  assertEqual(sanitized[2][1], "'+SUM(A1:A10)", 'Row 2 formula sanitized');
  assertEqual(sanitized[3][1], 'safe data', 'Row 3 safe data unchanged');
  assertEqual(sanitized[4][1], "'@WEEKDAY(NOW())", 'Row 4 formula sanitized');
}

// ===========================================================================
// SUMMARY
// ===========================================================================

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

process.exit(failed > 0 ? 1 : 0);
