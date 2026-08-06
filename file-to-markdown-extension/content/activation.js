// ===========================================================================
// content/activation.js — Host gating and per-file eligibility
// ===========================================================================
// FIX Perf #2/#3: matchesAny() now uses Set.has() for O(1) lookups.
//   effectiveHosts() returns a Set (from configUtils), cached on the instance.
//   Removed the [...spread] that allocated a new array on every check.
//   domainList() is called only for blacklist (small list), not for 223 hosts.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  FTM.activation = {
    verdict: null,
    hosts: null,
    _removed: null,

    invalidate() {
      this.verdict = null;
      this.hosts = null;
      this._removed = null;
    },

    hostname() {
      try { return String(self.location.hostname).toLowerCase(); } catch (_) { return ''; }
    },

    // FIX: Accept either an array or a Set. Use .has() for Sets, .some() for arrays.
    matchesAny(list) {
      const host = this.hostname();
      if (!host) return false;
      if (list instanceof Set) {
        // O(1) lookup for Sets
        if (list.has(host)) return true;
        // Suffix matching: check if host is a subdomain of any entry
        let dot = host.indexOf('.');
        while (dot !== -1) {
          if (list.has(host.substring(dot + 1))) return true;
          dot = host.indexOf('.', dot + 1);
        }
        return false;
      }
      // Fallback for arrays (blacklist, etc.)
      const domains = FTM.configUtils.domainList(list);
      return domains.some((domain) => host === domain || host.endsWith('.' + domain));
    },

    isBlacklisted() {
      return this.matchesAny(FTM.config.domainBlacklist);
    },

    effectiveHosts() {
      if (!this.hosts) this.hosts = FTM.configUtils.effectiveHosts(FTM.config);
      return this.hosts;
    },

    removedHosts() {
      if (!this._removed) {
        this._removed = new Set(
          (FTM.config.customAiHosts || [])
            .filter((entry) => String(entry)[0] === '-')
            .map((entry) => String(entry).substring(1))
        );
      }
      return this._removed;
    },

    isSmartMatch() {
      if (this.matchesAny(this.removedHosts())) return false;
      return this.matchesAny(this.effectiveHosts());
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
