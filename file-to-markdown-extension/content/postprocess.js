// ===========================================================================
// content/postprocess.js — Frontmatter, regex pipeline, heading hierarchy
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const T = FTM.text;

  // Structural ReDoS detection: unbounded quantifier applied to a group that
  // itself ends in an unbounded quantifier, plus nested/adjacent quantifiers.
  const STRUCTURAL_REDOS = [
    /\((?:[^()\\]|\\.)*[+*]\)\s*[+*{]/,
    /\((?:[^()\\]|\\.)*[+*]\)\{\d+,?\d*\}/,
    /[+*]{2,}/,
    /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)[+*]/
  ];

  const PROBES = [
    'a'.repeat(32) + '!',
    'x'.repeat(32) + '!',
    'ab'.repeat(16) + '!',
    'a'.repeat(16) + 'b'.repeat(16)
  ];

  class SafetyCache {
    constructor(max) { this.max = max; this.map = new Map(); }

    key(pattern, flags) { return flags + '\u0000' + pattern; }

    get(pattern, flags) { return this.map.get(this.key(pattern, flags)); }

    // Bounded LRU: the old cache grew without limit and keyed on the pattern
    // only, so the same source with different flags reused a stale verdict.
    set(pattern, flags, value) {
      const key = this.key(pattern, flags);
      this.map.delete(key);
      this.map.set(key, value);
      if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
      return value;
    }

    clear() { this.map.clear(); }
  }

  const cache = new SafetyCache(FTM.CONSTANTS.REGEX_CACHE_MAX);

  function withinBudget(regex, input) {
    const start = performance.now();
    try { regex.test(input); } catch (_) { return false; }
    return performance.now() - start <= FTM.CONSTANTS.REGEX_BUDGET_MS;
  }

  // Escapes and character classes are removed first so that legitimate
  // patterns such as /[*+]/ or /\*\*/ are not misread as nested quantifiers.
  function skeleton(pattern) {
    return pattern.replace(/\\./g, 'e').replace(/\[(?:[^\]\\]|\\.)*\]/g, 'c');
  }

  function probe(pattern, flags) {
    try {
      if (STRUCTURAL_REDOS.some((re) => re.test(skeleton(pattern)))) return false;
      return PROBES.every((input) => withinBudget(new RegExp(pattern, flags), input));
    } catch (_) {
      return false;
    }
  }

  FTM.postprocess = {
    clearCache() { cache.clear(); },

    isRegexSafe(pattern, flags) {
      const normalized = (flags || 'g').replace(/[^gimsuy]/g, '') || 'g';
      const cached = cache.get(pattern, normalized);
      if (cached !== undefined) return cached;
      return cache.set(pattern, normalized, probe(pattern, normalized));
    },

    frontmatter(file) {
      const now = new Date();
      return [
        '---',
        'original_file: ' + T.yamlString(file.name),
        'original_size: ' + file.size,
        'original_size_human: ' + T.yamlString(T.formatBytes(file.size)),
        'converted: ' + T.yamlString(now.toISOString()),
        'converted_date: ' + T.yamlString(now.toISOString().split('T')[0]),
        'format: "markdown"',
        '---', ''
      ].join('\n');
    },

    // Only a frontmatter block at the very start of the document is replaced,
    // and it must be a well-formed one (the old regex happily ate a leading
    // "---" horizontal rule and everything up to the next one).
    stripFrontmatter(markdown) {
      const match = /^---\r?\n(?:[^\n]*\r?\n)*?---(?:\r?\n|$)/.exec(markdown);
      if (!match || /^---\r?\n\r?\n/.test(markdown)) return markdown;
      return markdown.substring(match[0].length);
    },

    injectFrontmatter(markdown, file) {
      return this.frontmatter(file) + this.stripFrontmatter(markdown);
    },

    normalize(text) {
      const stripped = FTM.config.stripTrailingWhitespace !== false ? text.replace(/[ \t]+$/gm, '') : text;
      return stripped.replace(/\n{4,}/g, '\n\n\n');
    },

    minHeadingDepth(text) {
      let min = 7;
      const re = /^(#{1,6})\s/gm;
      for (let m = re.exec(text); m; m = re.exec(text)) min = Math.min(min, m[1].length);
      return min;
    },

    enforceHeadingHierarchy(text) {
      const min = this.minHeadingDepth(text);
      if (min > 6 || min === 1) return text;
      const shift = 1 - min;
      return text.replace(/^(#{1,6})\s/gm, (_, hashes) =>
        '#'.repeat(Math.min(6, Math.max(1, hashes.length + shift))) + ' ');
    },

    applyRule(text, rule) {
      if (!rule || rule.enabled === false || !rule.pattern) return text;
      const flags = (rule.flags || 'g').replace(/[^gimsuy]/g, '') || 'g';
      if (!this.isRegexSafe(rule.pattern, flags)) return text;
      try { return text.replace(new RegExp(rule.pattern, flags), rule.replacement || ''); }
      catch (_) { return text; }
    },

    apply(markdown) {
      let text = this.normalize(markdown);
      if (FTM.config.enforceHeadingHierarchy) text = this.enforceHeadingHierarchy(text);
      const rules = FTM.config.regexPipeline;
      if (!rules || !rules.length || text.length > FTM.CONSTANTS.MAX_PIPELINE_INPUT_BYTES) return text;
      for (const rule of rules) text = this.applyRule(text, rule);
      return text;
    }
  };
})();
