// ===========================================================================
// sw/offscreen-manager.js — Offscreen document lifecycle (reference counted)
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  const DOCUMENT = {
    url: 'offscreen.html',
    reasons: ['DOM_SCRAPING'],
    justification: 'Parsing binary files to Markdown using local parser libraries.'
  };

  FTM.offscreen = {
    ready: false,
    creating: null,
    users: 0,
    idleTimer: null,

    async exists() {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      return contexts.length > 0;
    },

    async create() {
      if (await this.exists()) return;
      await chrome.offscreen.createDocument(DOCUMENT);
    },

    async ensure() {
      if (this.ready) return;
      if (!this.creating) this.creating = this.createOnce();
      try { await this.creating; } finally { this.creating = null; }
    },

    async createOnce() {
      try {
        await this.create();
      } catch (err) {
        await this.close();
        await chrome.offscreen.createDocument(DOCUMENT);
      }
      this.ready = true;
    },

    retain() {
      this.users++;
      if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    },

    // Closing the document is the only thing that truly reclaims the parser
    // heap, so it happens promptly on idle instead of after 30 seconds.
    release() {
      this.users = Math.max(0, this.users - 1);
      if (this.users > 0 || this.idleTimer) return;
      this.idleTimer = setTimeout(() => { this.idleTimer = null; this.close(); }, FTM.CONSTANTS.OFFSCREEN_IDLE_MS);
    },

    async close() {
      if (this.users > 0) return;
      try { await chrome.offscreen.closeDocument(); } catch (_) { /* already closed */ }
      this.ready = false;
    }
  };
})();
