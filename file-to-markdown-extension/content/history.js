// ===========================================================================
// content/history.js — Conversion history persistence
// ===========================================================================
// Writes merge with whatever is already stored, so two tabs converting at the
// same time no longer overwrite each other's history.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  FTM.history = {
    pending: [],
    timer: null,

    entry(fileName, fileSize, extension, outputSize) {
      return {
        file: fileName,
        size: fileSize,
        extension,
        timestamp: new Date().toISOString(),
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

    async persist() {
      const batch = this.pending;
      if (!batch.length) return;
      this.pending = [];
      try {
        const stored = await chrome.storage.local.get('conversionHistory');
        const merged = FTM.text.mergeHistory(stored && stored.conversionHistory, batch, this.max());
        await chrome.storage.local.set({ conversionHistory: merged });
      } catch (_) {
        this.pending = batch.concat(this.pending);
      }
    },

    flush() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      return this.persist();
    }
  };
})();
