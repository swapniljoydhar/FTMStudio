// Session-aware relay between a content Port and an internal offscreen Port.
'use strict';
(() => {
  const FTM = (self.FTM = self.FTM || {});
  const KEEPALIVE_MS = 10000;

  class Bridge {
    constructor(port) { this.port = port; this.offscreenPort = null; this.queue = []; this.sessionId = null; this.closed = false; this.retained = false; this.keepaliveTimer = null; }
    start() {
      FTM.offscreen.retain(); this.retained = true;
      this.port.onMessage.addListener((msg) => this.fromContent(msg));
      this.port.onDisconnect.addListener(() => this.close());
      this.open();
    }
    async open() {
      try { await FTM.offscreen.ensure(); }
      catch (_) { this.fail('Offscreen unavailable', 'offscreen-unavailable'); return; }
      if (this.closed) return;
      try { this.offscreenPort = chrome.runtime.connect({ name: FTM.PORT.OFFSCREEN }); }
      catch (_) { this.fail('Offscreen connection failed', 'offscreen-connect'); return; }
      this.offscreenPort.onMessage.addListener((msg) => this.fromOffscreen(msg));
      this.offscreenPort.onDisconnect.addListener(() => this.close());
      this.flush();
    }
    fromContent(msg) {
      if (this.closed || !FTM.messages || !FTM.messages.fromContent(msg)) return this.fail('Invalid conversion message', 'invalid-message');
      const id = msg.data.sessionId;
      if (msg.type === FTM.MSG.BEGIN) {
        if (this.sessionId) return this.fail('Duplicate conversion begin', 'duplicate-begin');
        this.sessionId = id;
        FTM.conversionStatus && FTM.conversionStatus.set(id, 'receiving');
      } else if (!this.sessionId || id !== this.sessionId) return this.fail('Stale conversion message', 'stale-message');
      this.toOffscreen(msg);
    }
    fromOffscreen(msg) {
      if (this.closed || !FTM.messages || !FTM.messages.fromOffscreen(msg) || !this.sessionId || msg.data.sessionId !== this.sessionId) return;
      if (msg.type === FTM.MSG.PROGRESS) FTM.conversionStatus && FTM.conversionStatus.set(this.sessionId, msg.data.phase);
      const terminal = msg.type === FTM.MSG.RESULT || msg.type === FTM.MSG.ERROR;
      if (terminal) { this.stopKeepalive(); FTM.conversionStatus && FTM.conversionStatus.remove(this.sessionId); }
      this.toContent(msg);
      if (terminal) this.close();
    }
    toOffscreen(msg) {
      if (!this.offscreenPort) {
        if (this.queue.length >= FTM.CONSTANTS.QUEUED_MESSAGE_LIMIT) return this.fail('Transfer queue overflow', 'queue-overflow');
        this.queue.push(msg); return;
      }
      try { this.offscreenPort.postMessage(msg); if (msg.type === FTM.MSG.END) this.startKeepalive(); }
      catch (_) { this.fail('Offscreen port error', 'offscreen-port'); }
    }
    flush() { const queued = this.queue; this.queue = []; for (const msg of queued) this.toOffscreen(msg); }
    toContent(msg) { try { this.port.postMessage(msg); } catch (_) {} }
    startKeepalive() { if (this.keepaliveTimer) return; this.keepaliveTimer = setInterval(() => { try { this.port.postMessage({ type: '__keepalive__' }); } catch (_) {} }, KEEPALIVE_MS); }
    stopKeepalive() { if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; } }
    fail(error, code) {
      if (this.closed) return;
      if (this.sessionId) this.toContent({ type: FTM.MSG.ERROR, data: { sessionId: this.sessionId, error } });
      FTM.conversionStatus && FTM.conversionStatus.remove(this.sessionId, code);
      this.close();
    }
    close() {
      if (this.closed) return;
      this.closed = true; this.stopKeepalive(); this.queue = [];
      FTM.conversionStatus && FTM.conversionStatus.remove(this.sessionId);
      try { this.port.disconnect(); } catch (_) {}
      try { if (this.offscreenPort) this.offscreenPort.disconnect(); } catch (_) {}
      this.offscreenPort = null;
      if (this.retained) { this.retained = false; FTM.offscreen.release(); }
    }
  }
  FTM.Bridge = Bridge;
})();
