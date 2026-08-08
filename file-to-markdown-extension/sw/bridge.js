// Session-aware relay between a content Port and an internal offscreen Port.
'use strict';
(() => {
  const FTM = (self.FTM = self.FTM || {});
  const KEEPALIVE_MS = 10000;

  class Bridge {
    constructor(port) {
      this.port = port;
      this.offscreenPort = null;
      this.queue = [];
      this.sessionId = null;
      this.closed = false;
      this.retained = false;
      this.keepaliveTimer = null;
    }

    start() {
      FTM.offscreen.retain();
      this.retained = true;
      this.port.onMessage.addListener((msg) => this.fromContent(msg));
      this.port.onDisconnect.addListener(() => {
        manager.remove(this.port.name);
        this.close();
      });
      this.open();
    }

    async open() {
      try { await FTM.offscreen.ensure(); }
      catch (_) { this.fail('Offscreen unavailable'); return; }
      if (this.closed) return;
      try { this.offscreenPort = chrome.runtime.connect({ name: FTM.PORT.OFFSCREEN }); }
      catch (_) { this.fail('Offscreen connection failed'); return; }
      this.offscreenPort.onMessage.addListener((msg) => this.fromOffscreen(msg));
      this.offscreenPort.onDisconnect.addListener(() => this.close());
      this.flush();
    }

    fromContent(msg) {
      if (this.closed || !FTM.messages || !FTM.messages.fromContent(msg))
        return this.fail('Invalid conversion message');
      const id = msg.data.sessionId;
      if (msg.type === FTM.MSG.BEGIN) {
        if (this.sessionId) return this.fail('Duplicate conversion begin');
        this.sessionId = id;
      } else if (!this.sessionId || id !== this.sessionId) {
        return this.fail('Stale conversion message');
      }
      this.toOffscreen(msg);
    }

    fromOffscreen(msg) {
      if (this.closed || !FTM.messages || !FTM.messages.fromOffscreen(msg)
        || !this.sessionId || msg.data.sessionId !== this.sessionId) return;
      const terminal = msg.type === FTM.MSG.RESULT || msg.type === FTM.MSG.ERROR;
      if (terminal) this.stopKeepalive();
      this.toContent(msg);
      if (terminal) this.close();
    }

    toOffscreen(msg) {
      if (!this.offscreenPort) {
        if (this.queue.length >= FTM.CONSTANTS.QUEUED_MESSAGE_LIMIT)
          return this.fail('Transfer queue overflow');
        this.queue.push(msg);
        return;
      }
      try {
        this.offscreenPort.postMessage(msg);
        if (msg.type === FTM.MSG.END) this.startKeepalive();
      } catch (_) { this.fail('Offscreen port error'); }
    }

    flush() {
      const queued = this.queue;
      this.queue = [];
      for (const msg of queued) this.toOffscreen(msg);
    }

    toContent(msg) {
      try { this.port.postMessage(msg); } catch (_) {}
    }

    startKeepalive() {
      if (this.keepaliveTimer) return;
      this.keepaliveTimer = setInterval(() => {
        try { this.port.postMessage({ type: '__keepalive__' }); } catch (_) {}
      }, KEEPALIVE_MS);
    }

    stopKeepalive() {
      if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
    }

    fail(error) {
      if (this.closed) return;
      if (this.sessionId)
        this.toContent({ type: FTM.MSG.ERROR, data: { sessionId: this.sessionId, error } });
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
      if (this.retained) { this.retained = false; FTM.offscreen.release(); }
    }
  }

  // Port cleanup on disconnect
  function cleanupPort(port) {
    if (!port) return;
    try { port.disconnect(); } catch (_) {}
  }

  class BridgeManager {
    constructor() {
      this.ports = new Map();
    }

    add(port) {
      this.ports.set(port.name, port);
    }

    remove(name) {
      this.ports.delete(name);
    }

    get(name) {
      return this.ports.get(name);
    }
  }

  const manager = new BridgeManager();

  FTM.Bridge = Bridge;
  FTM.BridgeManager = BridgeManager;
})();
