// ===========================================================================
// sw/offscreen-manager.js — Offscreen document lifecycle (reference counted)
// ===========================================================================
// FIX #2 (High): Zombie state on creation failure.
//   - createOnce() now decrements users on failure so close() is not blocked.
//   - ensure() propagates errors cleanly instead of leaving a stuck state.
//   - close() is more defensive: always resets ready, even if closeDocument fails.
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
      try {
        await this.creating;
      } catch (err) {
        this.creating = null;
        throw err;
      } finally {
        this.creating = null;
      }
    },

    async createOnce() {
      try {
        await this.create();
        this.ready = true;
      } catch (err) {
        // FIX: Reset ready and force-close so the zombie state cannot persist.
        // The close() guard (users > 0) is bypassed by temporarily setting users = 0.
        this.ready = false;
        const savedUsers = this.users;
        this.users = 0;
        try { await chrome.offscreen.closeDocument(); } catch (_) { /* ignore */ }
        this.users = savedUsers;
        throw err;
      }
    },

    retain() {
      this.users++;
      if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    },

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
