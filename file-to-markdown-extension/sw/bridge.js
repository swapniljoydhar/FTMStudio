// ===========================================================================
// sw/bridge.js — Content-script port ⇄ offscreen port relay
// ===========================================================================
// The message listener is attached synchronously, before the offscreen
// document is awaited, so messages sent in the same task are queued instead
// of being dropped on the floor (the old code lost every early message and
// its `pending` buffer was unreachable).
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  class Bridge {
    constructor(port) {
      this.port = port;
      this.offscreenPort = null;
      this.queue = [];
      this.closed = false;
    }

    start() {
      FTM.offscreen.retain();
      this.port.onMessage.addListener((msg) => this.toOffscreen(msg));
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
      this.offscreenPort.onMessage.addListener((msg) => this.toContent(msg));
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
      try { this.offscreenPort.postMessage(msg); } catch (_) { this.fail('Offscreen port error'); }
    }

    flush() {
      const queued = this.queue;
      this.queue = [];
      for (const msg of queued) this.toOffscreen(msg);
    }

    toContent(msg) {
      try { this.port.postMessage(msg); } catch (_) { /* content gone */ }
    }

    fail(error) {
      this.toContent({ type: FTM.MSG.ERROR, data: { error } });
      this.close();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.queue = [];
      try { this.port.disconnect(); } catch (_) {}
      try { if (this.offscreenPort) this.offscreenPort.disconnect(); } catch (_) {}
      this.offscreenPort = null;
      FTM.offscreen.release();
    }
  }

  FTM.Bridge = Bridge;
})();
