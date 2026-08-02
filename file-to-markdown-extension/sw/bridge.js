// ===========================================================================
// sw/bridge.js — Content-script port ⇄ offscreen port relay
// ===========================================================================
// FIX: Keepalive heartbeat prevents Chrome from killing the service worker
//   during long conversions.  MV3 service workers die after 30s idle.
//   While the offscreen document is processing, no messages flow through
//   the bridge — the heartbeat fills that gap.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  const KEEPALIVE_MS = 10000;

  class Bridge {
    constructor(port) {
      this.port = port;
      this.offscreenPort = null;
      this.queue = [];
      this.closed = false;
      this.keepaliveTimer = null;
    }

    start() {
      FTM.offscreen.retain();
      this.port.onMessage.addListener((msg) => {
        if (!FTM.messages || FTM.messages.fromContent(msg)) this.toOffscreen(msg);
        else this.fail('Invalid conversion message');
      });
      this.port.onDisconnect.addListener(() => this.close());
      this.open();
    }

    async open() {
      try {
        await FTM.offscreen.ensure();
      } catch (err) {
        this.fail(err && err.message ? err.message : 'Offscreen unavailable');
        return;
      }
      if (this.closed) return;
      this.offscreenPort = chrome.runtime.connect({ name: FTM.PORT.OFFSCREEN });
      this.offscreenPort.onMessage.addListener((msg) => {
        if (FTM.messages && !FTM.messages.fromOffscreen(msg)) return;
        this.stopKeepalive();
        this.toContent(msg);
      });
      this.offscreenPort.onDisconnect.addListener(() => this.close());
      this.flush();
    }

    toOffscreen(msg) {
      if (this.closed) return;
      if (!this.offscreenPort) {
        if (this.queue.length < FTM.CONSTANTS.QUEUED_MESSAGE_LIMIT) this.queue.push(msg);
        else this.fail('Transfer queue overflow');
        return;
      }
      try {
        this.offscreenPort.postMessage(msg);
        if (msg.type === FTM.MSG.END) this.startKeepalive();
      } catch (_) {
        this.fail('Offscreen port error');
      }
    }

    flush() {
      const queued = this.queue;
      this.queue = [];
      for (const msg of queued) this.toOffscreen(msg);
    }

    toContent(msg) {
      try { this.port.postMessage(msg); } catch (_) { /* content gone */ }
    }

    startKeepalive() {
      this.stopKeepalive();
      this.keepaliveTimer = setInterval(() => {
        if (this.closed) { this.stopKeepalive(); return; }
        try { this.port.postMessage({ type: '__keepalive__' }); } catch (_) {}
      }, KEEPALIVE_MS);
    }

    stopKeepalive() {
      if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
    }

    fail(error) {
      this.stopKeepalive();
      this.toContent({ type: FTM.MSG.ERROR, data: { error } });
      this.close();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.stopKeepalive();
      this.queue = [];
      try { this.port.disconnect(); } catch (_) {}
      try { if (this.offscreenPort) this.offscreenPort.disconnect(); } catch (_) {}
      this.offscreenPort = null;
      FTM.offscreen.release();
    }
  }

  FTM.Bridge = Bridge;
})();
