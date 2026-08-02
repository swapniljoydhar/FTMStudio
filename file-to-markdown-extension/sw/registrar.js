// ===========================================================================
// sw/registrar.js — Dynamic content-script registration
// ===========================================================================
// Smart Mode now gates *injection*, not just activation: on non-AI sites no
// FTM code is loaded at all (previously ~48 KB ran on every page, including
// banking and webmail).
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const SCRIPT_ID = 'ftm-content';
  const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

  FTM.CONTENT_FILES = [
    'shared/constants.js', 'shared/text.js', 'shared/config.js', 'shared/messages.js',
    'content/config.js', 'content/activation.js', 'content/postprocess.js',
    'content/converters.js', 'content/transport.js', 'content/router.js',
    'content/history.js', 'content/toast.js', 'content/intercept.js'
  ];

  FTM.registrar = {
    patternsFor(hosts) {
      const patterns = [];
      for (const host of hosts) {
        if (!HOST_RE.test(host)) continue;
        patterns.push('*://' + host + '/*', '*://*.' + host + '/*');
      }
      return patterns;
    },

    matches(config) {
      if (!config.smartMode) return ['<all_urls>'];
      return this.patternsFor(FTM.configUtils.effectiveHosts(config));
    },

    excludes(config) {
      return this.patternsFor(FTM.configUtils.domainList(config.domainBlacklist));
    },

    spec(matches, excludeMatches) {
      return {
        id: SCRIPT_ID,
        js: FTM.CONTENT_FILES,
        matches,
        excludeMatches,
        runAt: 'document_start',
        world: 'ISOLATED',
        allFrames: false,
        persistAcrossSessions: true
      };
    },

    async unregister() {
      try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch (_) {}
    },

    async sync(config) {
      const cfg = config || FTM.configUtils.defaults(await chrome.storage.local.get(null));
      await this.unregister();
      if (cfg.enabled === false) return { registered: false, patterns: 0 };
      const matches = this.matches(cfg);
      if (matches.length === 0) return { registered: false, patterns: 0 };
      return this.register(matches, this.excludes(cfg));
    },

    // Fails *closed*: if Chrome rejects the generated pattern list the retry
    // narrows it, and never widens to <all_urls>, so a registration error can
    // not silently reintroduce injection on every site.
    async register(matches, excludeMatches) {
      try {
        await chrome.scripting.registerContentScripts([this.spec(matches, excludeMatches)]);
        return { registered: true, patterns: matches.length };
      } catch (_) {
        const narrowed = matches.slice(0, FTM.CONSTANTS.MAX_MATCH_PATTERNS);
        if (narrowed.length === matches.length) return { registered: false, patterns: 0 };
        try {
          await chrome.scripting.registerContentScripts([this.spec(narrowed, excludeMatches)]);
          return { registered: true, patterns: narrowed.length, narrowed: true };
        } catch (err) {
          return { registered: false, patterns: 0, error: err && err.message };
        }
      }
    }
  };
})();
