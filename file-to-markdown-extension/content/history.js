// ===========================================================================
// content/history.js — Conversion history persistence
// ===========================================================================
// FIX: Privacy — filenames are truncated (extension only) before storing.
//   Entries older than 30 days are auto-expired on each persist cycle.
// ===========================================================================

'use strict';
/* global crypto */

(() => {
  const FTM = (self.FTM = self.FTM || {});

  // 30 days in milliseconds.
  const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
  const storage = self.FTM_BROWSER?.storage || {
    get: (key) => self.chrome.storage.local.get(key),
    set: (value) => self.chrome.storage.local.set(value)
  };

  FTM.history = {
    pending: [],
    timer: null,
    _persistMutex: Promise.resolve(),

    entry(fileName, fileSize, extension, outputSize) {
      // Privacy: store only extension + size, not the full filename.
      // uid prevents dedup collisions when multiple entries share a timestamp.
      return {
        file: extension ? '*.' + extension.replace(/^\./, '') : 'unknown',
        size: fileSize,
        extension,
        timestamp: new Date().toISOString(),
        uid: Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(36).padStart(2, '0')).join('').substring(0, 8),
        outputSize: outputSize || 0
      };
    },

    max() {
      return FTM.config.maxConversions || FTM.CONSTANTS.MAX_HISTORY_ENTRIES;
    },

    record(fileName, fileSize, extension, outputSize) {
      this.pending.push(this.entry(fileName, fileSize, extension, outputSize));
      while (this.pending.length > this.max()) this.pending.shift();
      this.schedule();
    },

    schedule() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; this.persist(); }, FTM.CONSTANTS.HISTORY_DEBOUNCE_MS);
    },

    // Remove entries older than 30 days.
    expireOld(entries) {
      const cutoff = Date.now() - EXPIRY_MS;
      return (entries || []).filter((e) => {
        if (!e || !e.timestamp) return false;
        return new Date(e.timestamp).getTime() > cutoff;
      });
    },

    async persist() {
      const batch = this.pending;
      if (!batch.length) return;
      this.pending = [];
      // Serialize writes to prevent race conditions between concurrent tabs.
      this._persistMutex = this._persistMutex.then(async () => {
        try {
          const stored = await storage.get('conversionHistory');
          let merged = FTM.text.mergeHistory(stored && stored.conversionHistory, batch, this.max());
          // Auto-expire old entries.
          merged = this.expireOld(merged);
          await storage.set({ conversionHistory: merged });
        } catch (_) {
          this.pending = batch.concat(this.pending);
        }
      }).catch(() => {});
      return this._persistMutex;
    },

    flush() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      return this.persist();
    }
  };
})();
