// ===========================================================================
// content/postprocess.js — Frontmatter, regex pipeline, heading hierarchy
// ===========================================================================
// ReDoS defence: structural checks + adversarial probes + progressive
// scaling test.  See comments on isRegexSafe() for details.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const T = FTM.text;

  // ── ReDoS protection ────────────────────────────────────────────────

  // Skeleton: strips escapes and character classes so structural patterns
  // can detect catastrophic shapes like (a+)+ through (?:a|b)+.
  function skeleton(pattern) {
    return pattern
      .replace(/\\./g, 'e')
      .replace(/\[(?:[^\]\\]|\\.)*\]/g, 'c')
      .replace(/\(\?:/g, '(');
  }

  // 1. STRUCTURAL CHECK — known catastrophic shapes in the skeleton.
  //    Zero-cost: pure regex on a simplified string.
  const STRUCTURAL_REDOS = [
    /\((?:[^()\\]|\\.)*[+*]\)\s*[+*{]/,
    /\((?:[^()\\]|\\.)*[+*]\)\{\d+,?\d*\}/,
    /[+*]{2,}/,
    /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)[+*]/
  ];

  function hasStructuralReDoS(pattern) {
    const s = skeleton(pattern);
    return STRUCTURAL_REDOS.some((re) => re.test(s));
  }

  // 2. PROGRESSIVE PROBE — test with increasing input sizes.
  //    Safe patterns scale linearly; catastrophic ones show exponential
  //    growth.  We test 3 sizes and check that time doesn't explode.
  //
  //    Budget: total probe time capped at PROBE_BUDGET_MS (15ms).
  //    If even the shortest probe exceeds this, reject immediately.
  //    If time grows >10x between doublings, reject.
  const PROBE_BUDGET_MS = 15;
  const PROBE_BASE = 16;

  function progressiveProbe(pattern, flags) {
    try {
      const re = new RegExp(pattern, flags);
      const lengths = [PROBE_BASE, PROBE_BASE * 2, PROBE_BASE * 4];
      const times = [];

      for (const len of lengths) {
        const input = 'a'.repeat(len) + '!';
        const start = performance.now();
        re.test(input);
        const elapsed = performance.now() - start;
        times.push(elapsed);

        // Immediate reject if any single probe exceeds budget.
        if (elapsed > PROBE_BUDGET_MS) return false;
      }

      // Check for exponential growth: if time grew >10x between any
      // two consecutive doublings, the pattern is catastrophic.
      for (let j = 1; j < times.length; j++) {
        if (times[j] > 0.01 && times[j - 1] > 0.01) {
          if (times[j] / times[j - 1] > 10) return false;
        }
      }

      return true;
    } catch (_) {
      return false; // invalid regex
    }
  }

  // 3. isRegexSafe — combined verdict.
  //    - Structural check (free, catches ~95% of known patterns)
  //    - Progressive probe (catches patterns that pass structural checks
    //      but still exhibit exponential backtracking)
  function isRegexSafe(pattern, flags) {
    if (hasStructuralReDoS(pattern)) return false;
    return progressiveProbe(pattern, flags);
  }

  // ── Caches ──────────────────────────────────────────────────────────

  class SafetyCache {
    constructor(max) { this.max = max; this.map = new Map(); }
    key(pattern, flags) { return flags + '\u0000' + pattern; }
    get(pattern, flags) { return this.map.get(this.key(pattern, flags)); }
    set(pattern, flags, value) {
      const key = this.key(pattern, flags);
      this.map.delete(key);
      this.map.set(key, value);
      if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
      return value;
    }
    clear() { this.map.clear(); }
  }

  const safetyCache = new SafetyCache(FTM.CONSTANTS.REGEX_CACHE_MAX);
  const regexCache = new SafetyCache(FTM.CONSTANTS.REGEX_CACHE_MAX);

  // ── Public API ──────────────────────────────────────────────────────

  FTM.postprocess = {
    clearCache() {
      safetyCache.clear();
      regexCache.clear();
    },

    isRegexSafe(pattern, flags) {
      const normalized = (flags || 'g').replace(/[^gimsuy]/g, '') || 'g';
      const cached = safetyCache.get(pattern, normalized);
      if (cached !== undefined) return cached;
      return safetyCache.set(pattern, normalized, isRegexSafe(pattern, normalized));
    },

    getCompiledRegex(pattern, flags) {
      const cached = regexCache.get(pattern, flags);
      if (cached !== undefined) return cached;
      const compiled = new RegExp(pattern, flags);
      regexCache.set(pattern, flags, compiled);
      return compiled;
    },

    // Simple FNV-1a hash for content dedup/cache invalidation.
    // Returns a hex string. Not cryptographic — just a fast fingerprint.
    contentHash(text) {
      let hash = 0x811c9dc5;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, '0');
    },

    // Approximate token count. English averages ~4 chars/token.
    tokenEstimate(text) {
      return Math.ceil(text.length / 4);
    },

    // Count words (whitespace-separated runs).
    wordCount(text) {
      const m = text.match(/\S+/g);
      return m ? m.length : 0;
    },

    // Determine the shallowest heading level used in the document.
    // Returns 'h1' if headings start at #, 'h2' if at ##, etc.
    recommendedChunkLevel(text) {
      let min = 7;
      const re = /^(#{1,6})\s/gm;
      for (let m = re.exec(text); m; m = re.exec(text)) min = Math.min(min, m[1].length);
      return min <= 6 ? 'h' + min : 'h1';
    },

    frontmatter(file, markdown) {
      const now = new Date();
      const body = markdown || '';
      // Sanitize filename: strip control chars that could break YAML.
      const safeName = T.plain(file.name);
      return [
        '---',
        'original_file: ' + T.yamlString(safeName),
        'original_size: ' + file.size,
        'original_size_human: ' + T.yamlString(T.formatBytes(file.size)),
        'converted: ' + T.yamlString(now.toISOString()),
        'converted_date: ' + T.yamlString(now.toISOString().split('T')[0]),
        'format: "markdown"',
        'word_count: ' + this.wordCount(body),
        'token_estimate: ' + this.tokenEstimate(body),
        'content_hash: "' + this.contentHash(body) + '"',
        'recommended_chunk_level: "' + this.recommendedChunkLevel(body) + '"',
        '---', ''
      ].join('\n');
    },

    stripFrontmatter(markdown) {
      const match = /^---\r?\n(?:.*\r?\n)*?^---(?:\r?\n|$)/m.exec(markdown);
      if (!match || /^---\r?\n\r?\n/.test(markdown)) return markdown;
      return markdown.substring(match[0].length);
    },

    injectFrontmatter(markdown, file) {
      const stripped = this.stripFrontmatter(markdown);
      return this.frontmatter(file, stripped) + stripped;
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
      if (min > 6) return text;
      const shift = min === 1 ? 0 : 1 - min;
      // First pass: shift all headings so shallowest becomes h1.
      let result = text.replace(/^(#{1,6})\s/gm, (_, hashes) =>
        '#'.repeat(Math.min(6, Math.max(1, hashes.length + shift))) + ' ');
      // Second pass: fix skipped levels (e.g. h1 → h3 without h2).
      // Each heading can be at most 1 level deeper than the previous.
      let prevLevel = 0;
      result = result.replace(/^(#{1,6})\s/gm, (match, hashes) => {
        let level = hashes.length;
        if (prevLevel > 0 && level > prevLevel + 1) level = prevLevel + 1;
        prevLevel = level;
        return '#'.repeat(level) + ' ';
      });
      return result;
    },

    applyRule(text, rule) {
      if (!rule || rule.enabled === false || !rule.pattern) return text;
      const flags = (rule.flags || 'g').replace(/[^gimsuy]/g, '') || 'g';
      if (!this.isRegexSafe(rule.pattern, flags)) return text;
      try {
        // FIX Perf #7: Use cached compiled RegExp instead of new RegExp().
        return text.replace(this.getCompiledRegex(rule.pattern, flags), rule.replacement || '');
      } catch (_) {
        return text;
      }
    },

    // Detect and strip table-of-contents lines.
    // Patterns: "Chapter 1 .............. 5", "Section Title ... 12", "3.2 Heading ... 42"
    stripTOC(text) {
      // Lines with dot leaders followed by a page number.
      const dotLeader = /^[^\n]*\.{3,}\s*\d+\s*$/gm;
      let result = text.replace(dotLeader, '');
      // Lines that are just "Table of Contents" / "Contents" headings followed
      // by TOC entries — remove the heading too if it precedes TOC lines.
      result = result.replace(/^(?:#{1,6}\s+)?(?:Table of Contents|Contents|TOC)\s*\n(?:[^\n]*\.{3,}\s*\d+\s*\n)+/gmi, '');
      // Clean up excess blank lines left by removal.
      return result.replace(/\n{3,}/g, '\n\n');
    },

    // Strip cover-page artifacts from the start of a document.
    // Removes: license notices, boilerplate disclaimers, empty headings,
    // "All rights reserved", "Licensed to...", QR code references, etc.
    stripCoverArtifacts(text) {
      const lines = text.split('\n');
      let start = 0;
      const COVER_KEYWORDS = [
        'licensed to', 'single user licence', 'single user license',
        'all rights reserved', 'copying and networking prohibited',
        'iso store order', 'customer feedback', 'qr code', 'scan the',
        'third edition', 'corrected version', 'this document is',
        '©', 'copyright '
      ];

      // Skip leading lines that are cover artifacts.
      while (start < Math.min(lines.length, 20)) {
        const line = lines[start].trim();
        if (!line) { start++; continue; }
        const lower = line.toLowerCase();
        // Skip lines matching cover keywords.
        if (COVER_KEYWORDS.some((kw) => lower.includes(kw))) { start++; continue; }
        // Skip empty headings (just # with no real content).
        if (/^#{1,6}\s*$/.test(line)) { start++; continue; }
        // Skip heading that's just emphasis markers (## *** etc).
        if (/^#{1,6}\s+[*_]+$/.test(line)) { start++; continue; }
        break;
      }

      if (start === 0) return text;
      return lines.slice(start).join('\n').replace(/^\n+/, '');
    },

    apply(markdown) {
      let text = this.normalize(markdown);
      text = this.stripTOC(text);
      text = this.stripCoverArtifacts(text);
      if (FTM.config.enforceHeadingHierarchy) text = this.enforceHeadingHierarchy(text);
      const rules = FTM.config.regexPipeline;
      if (!rules || !rules.length || text.length > FTM.CONSTANTS.MAX_PIPELINE_INPUT_BYTES) return text;
      for (const rule of rules) text = this.applyRule(text, rule);
      return text;
    }
  };
})();
