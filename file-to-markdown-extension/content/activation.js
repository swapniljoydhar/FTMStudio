// ===========================================================================
// content/activation.js — Host gating and per-file eligibility
// ===========================================================================
// The verdict is computed once per document and cached (it was recomputed,
// with three list walks, on every intercepted event).
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  FTM.activation = {
    verdict: null,
    hosts: null,

    invalidate() {
      this.verdict = null;
      this.hosts = null;
    },

    hostname() {
      try { return String(self.location.hostname).toLowerCase(); } catch (_) { return ''; }
    },

    matchesAny(list) {
      const host = this.hostname();
      if (!host) return false;
      return FTM.configUtils.domainList(list).some((domain) => host === domain || host.endsWith('.' + domain));
    },

    isBlacklisted() {
      return this.matchesAny(FTM.config.domainBlacklist);
    },

    effectiveHosts() {
      if (!this.hosts) this.hosts = FTM.configUtils.effectiveHosts(FTM.config);
      return this.hosts;
    },

    removedHosts() {
      return (FTM.config.customAiHosts || [])
        .filter((entry) => String(entry)[0] === '-')
        .map((entry) => String(entry).substring(1));
    },

    // Explicit "-domain" overrides win over everything, matching the popup UI.
    isSmartMatch() {
      if (this.matchesAny(this.removedHosts())) return false;
      return this.matchesAny([...this.effectiveHosts()]);
    },

    evaluate() {
      try {
        if (this.isBlacklisted()) return false;
        if (!FTM.config.smartMode) return true;
        return this.isSmartMatch();
      } catch (_) {
        return false;
      }
    },

    shouldActivate() {
      if (this.verdict === null) this.verdict = this.evaluate();
      return this.verdict;
    },

    shouldInterceptFile(file) {
      const category = FTM.EXTENSION_MAP[FTM.text.getExtension(file.name).toLowerCase()];
      return !!(category && FTM.config.categories && FTM.config.categories[category]);
    }
  };
})();
