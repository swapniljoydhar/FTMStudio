// ===========================================================================
// content/postprocess.js — YAML frontmatter, regex pipeline, heading hierarchy
// ===========================================================================

window.FTM = window.FTM || {};

FTM.injectYamlFrontmatter = function (markdown, file) {
  const now = new Date();
  const yaml = [
    '---',
    'original_file: "' + FTM.escapeYamlString(file.name) + '"',
    'original_size: "' + file.size + '"',
    'original_size_human: "' + FTM.formatBytes(file.size) + '"',
    'converted: "' + now.toISOString() + '"',
    'converted_date: "' + now.toISOString().split('T')[0] + '"',
    'format: "markdown"',
    '---',
    ''
  ].join('\n');

  let clean = markdown;
  const fm = clean.match(/^---\n[\s\S]*?\n---\n?/);
  if (fm) clean = clean.substring(fm[0].length);
  return yaml + clean;
};

FTM.escapeYamlString = function (str) {
  return str
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/:/g, '\\:')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    .replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
};

FTM.applyRegexPipeline = function (text) {
  if (FTM.config.stripTrailingWhitespace !== false) {
    text = text.replace(/[ \t]+$/gm, '');
  }
  text = text.replace(/\n{4,}/g, '\n\n\n');

  if (FTM.config.enforceHeadingHierarchy) {
    text = FTM.enforceHeadingHierarchy(text);
  }

  const rules = FTM.config.regexPipeline;
  if (rules && rules.length > 0) {
    if (text.length > 2 * 1024 * 1024) {
      console.warn('[FTM] Text too long for regex pipeline (' + text.length + ' chars). Skipping.');
      return text;
    }
    for (const rule of rules) {
      if (!rule || !rule.enabled || !rule.pattern) continue;
      try {
        if (!FTM.isRegexSafe(rule.pattern)) {
          console.warn('[FTM] Regex rejected (ReDoS):', rule.pattern);
          continue;
        }
        text = text.replace(new RegExp(rule.pattern, rule.flags || 'g'), rule.replacement || '');
      } catch (err) {
        console.warn('[FTM] Regex failed:', rule.pattern, err.message);
      }
    }
  }
  return text;
};

FTM.isRegexSafe = function (pattern) {
  try {
    const regex = new RegExp(pattern, 'g');
    const tests = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!',
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx!',
      'ababababababababababababababab!',
    ];
    for (const t of tests) {
      const s = performance.now();
      regex.test(t);
      if (performance.now() - s > 50) return false;
    }
    // Heuristic: detect nested quantifiers (e.g., (a+)+, (a*)*, (.*)*)
    // These are dangerous when the match fails
    const hasNestedQuantifier = /(\([^)]*[+*]\)[+*]|\(\.[*]\)[+*]|[+*]{2,})/.test(pattern);
    if (hasNestedQuantifier) {
      try {
        const failRegex = new RegExp(pattern, 'g');
        const s = performance.now();
        failRegex.test('aaaa!');
        if (performance.now() - s > 50) return false;
      } catch {}
    }
    return true;
  } catch {
    return false;
  }
};

FTM.enforceHeadingHierarchy = function (text) {
  const all = text.match(/^(#{1,6})\s/gm);
  if (!all || all.length === 0) return text;
  let min = 6;
  for (const h of all) { const l = h.match(/^#+/)[0].length; if (l < min) min = l; }
  if (min === 1) return text;
  const shift = 1 - min;
  return text.replace(/^(#{1,6})\s/gm, (_, hashes) => {
    const n = hashes.length + shift;
    if (n < 1) return '# ';
    if (n > 6) return '###### ';
    return '#'.repeat(n) + ' ';
  });
};

FTM.sanitizeRegexPipeline = function (rules) {
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
};
