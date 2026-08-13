// ===========================================================================
// shared/config.js — Default configuration + prototype-safe merge helpers
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  FTM.DEFAULT_CONFIG = {
    enabled: true,
    categories: {
      documents: true, pdf: true, spreadsheets: true, code: true,
      markup: true, presentations: true, images: true
    },
    yamlFrontmatter: true,
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

    isFormatEnabled(config, extension) {
      if (config && config.enabled === false) return false;
      const category = FTM.EXTENSION_MAP[extension];
      return !category || !config || !config.categories || config.categories[category] !== false;
    },

    sanitizeRules(rules) {
      if (!Array.isArray(rules)) return [];
      return rules
        .slice(0, 64)
        .filter((r) => r && typeof r.pattern === 'string' && r.pattern.length > 0 && r.pattern.length <= 512)
        .map((r) => ({
          pattern: r.pattern,
          replacement: typeof r.replacement === 'string' ? r.replacement.slice(0, 2048) : '',
          flags: (r.flags || 'g').replace(/[^gimsuy]/g, '').slice(0, 8) || 'g',
          enabled: r.enabled !== false,
          name: typeof r.name === 'string' ? r.name.slice(0, 80) : ''
        }));
    },

    domainList(list) {
      if (!Array.isArray(list)) return [];
      return list.slice(0, FTM.CONSTANTS.MAX_MATCH_PATTERNS).map((value) => {
        const raw = String(value).trim().toLowerCase();
        return raw.replace('https://', '').replace('http://', '').split('/')[0];
      }).filter((domain) => {
        if (domain.length < 3 || domain.length > 253 || domain.startsWith('.') || domain.endsWith('.')) return false;
        return domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
      });
    },

  };
})();
