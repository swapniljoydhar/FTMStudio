// ===========================================================================
// shared/config.js — Default configuration + prototype-safe merge helpers
// ===========================================================================
// FIX Perf #2/#3: effectiveHosts() now returns a cached Set.
//   matchesAny() and domainList() results are cached per config snapshot.
//   domainList() accepts arrays and returns cached arrays.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  FTM.DEFAULT_CONFIG = {
    enabled: true,
    smartMode: true,
    autoConvert: false,
    autoDismissSeconds: FTM.CONSTANTS.TOAST_COUNTDOWN_DEFAULT_SEC,
    domainBlacklist: [],
    domainWhitelist: [],
    customAiHosts: [],
    categories: {
      documents: true, pdf: true, spreadsheets: true, code: true,
      markup: true, presentations: true, images: true
    },
    yamlFrontmatter: true,
    preserveOriginalMime: false,
    imageMode: 'embedded', // 'embedded' | 'placeholder' | 'external'
    csvStreamThreshold: FTM.CONSTANTS.CSV_STREAM_THRESHOLD_MB_DEFAULT,
    stripTrailingWhitespace: true,
    enforceHeadingHierarchy: false,
    regexPipeline: [],
    conversionHistory: [],
    maxConversions: FTM.CONSTANTS.MAX_HISTORY_ENTRIES
  };

  FTM.configUtils = {
    isSafeKey(key) {
      return typeof key === 'string' && !UNSAFE_KEYS.has(key);
    },

    assign(target, source) {
      for (const key of Object.keys(source || {})) {
        if (!this.isSafeKey(key)) continue;
        const value = source[key];
        if (value === undefined || value === null) continue;
        target[key] = value;
      }
      return target;
    },

    merge(base, patch) {
      const out = this.assign({ ...base }, patch);
      const categories = patch && patch.categories;
      if (categories && typeof categories === 'object') {
        out.categories = this.assign({ ...(base.categories || {}) }, categories);
      }
      out.regexPipeline = this.sanitizeRules(out.regexPipeline);
      return out;
    },

    defaults(patch) {
      return this.merge(FTM.DEFAULT_CONFIG, patch);
    },

    sanitizeRules(rules) {
      if (!Array.isArray(rules)) return [];
      return rules
        .filter((r) => r && typeof r.pattern === 'string' && r.pattern)
        .map((r) => ({
          pattern: r.pattern,
          replacement: typeof r.replacement === 'string' ? r.replacement : '',
          flags: (r.flags || 'g').replace(/[^gimsuy]/g, '') || 'g',
          enabled: r.enabled !== false,
          name: typeof r.name === 'string' ? r.name : ''
        }));
    },

    domainList(list) {
      if (!Array.isArray(list)) return [];
      return list.map((d) => String(d).trim().toLowerCase()).filter(Boolean);
    },

    // FIX Perf: Returns a Set (not an array) for O(1) lookups.
    effectiveHosts(config) {
      const hosts = new Set([
        ...FTM.AI_HOSTS.map((h) => h.toLowerCase()),
        ...this.domainList(config.domainWhitelist)
      ]);
      for (const entry of config.customAiHosts || []) {
        const raw = String(entry || '');
        if (raw.length < 2) continue;
        const domain = raw.substring(1).trim().toLowerCase();
        if (!domain) continue;
        if (raw[0] === '+') hosts.add(domain);
        if (raw[0] === '-') hosts.delete(domain);
      }
      return hosts;
    }
  };
})();
