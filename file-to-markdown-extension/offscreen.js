// ===========================================================================
// offscreen.js — Transport endpoint for the offscreen parser document
// ===========================================================================
// Accepts one session per connected port (concurrent conversions from several
// tabs used to be rejected, killing each other's in-flight work), reassembles
// the chunked payload and dispatches to the parser registry.
// ===========================================================================

'use strict';

(() => {
  const FTM = self.FTM;
  const sessions = new Set();

  class Session {
    constructor(port) {
      this.port = port;
      this.reset();
    }

    reset() {
      this.meta = null;
      this.chunks = [];
    }

    handle(message) {
      if (!message || typeof message.type !== 'string') return;
      if (message.type === FTM.MSG.BEGIN) this.begin(message.data || {});
      else if (message.type === FTM.MSG.CHUNK) this.chunk(message.data || {});
      else if (message.type === FTM.MSG.END) this.end();
    }

    begin(data) {
      if (!data.fileName || !data.extension || !Number.isInteger(data.totalChunks)) {
        this.fail('Invalid request: missing required fields');
        return;
      }
      this.reset();
      this.meta = data;
    }

    chunk(data) {
      if (!this.meta || typeof data.base64 !== 'string') { this.fail('Unexpected chunk'); return; }
      this.chunks.push(data.base64);
    }

    end() {
      if (!this.meta || this.chunks.length !== this.meta.totalChunks) { this.fail('Incomplete transfer'); return; }
      const meta = this.meta;
      const bytes = FTM.text.decodeChunks(this.chunks);
      this.reset();
      FTM.parse(meta, bytes)
        .then((markdown) => this.send({ type: FTM.MSG.RESULT, data: { markdown, fileName: meta.fileName } }))
        .catch((err) => this.fail(err && err.message ? err.message : String(err)));
    }

    send(message) {
      try { this.port.postMessage(message); } catch (_) { /* port closed */ }
    }

    fail(error) {
      this.send({ type: FTM.MSG.ERROR, data: { error } });
    }
  }

  FTM.parse = async function parse(meta, bytes) {
    const parser = FTM.parsers[meta.extension];
    if (!parser) throw new Error('Unsupported binary format: ' + meta.extension);
    if (!bytes.length) throw new Error('File is empty: ' + meta.fileName);
    return parser(bytes, meta);
  };

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== FTM.PORT.OFFSCREEN) return;
    const session = new Session(port);
    sessions.add(session);
    port.onMessage.addListener((message) => session.handle(message));
    port.onDisconnect.addListener(() => {
      sessions.delete(session);
      if (sessions.size === 0) FTM.libs.release();
    });
  });

  FTM.Session = Session;
})();
