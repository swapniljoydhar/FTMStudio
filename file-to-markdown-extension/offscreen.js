// ===========================================================================
// offscreen.js — Transport endpoint for the offscreen parser document
// ===========================================================================
// Accepts one session per connected port, reassembles the chunked payload
// incrementally (decode each base64 chunk as it arrives, write into a bounded
// Uint8Array), and dispatches to the parser registry.
//
// Memory profile:
//   OLD: collect all base64 strings → decode all at once.
//        Peak ≈ file.size × 2.67  (base64 strings + decoded bytes).
//   NEW: decode each chunk on arrival → bounded offset write → reclaim strings.
//        Peak is bounded by the declared decoded buffer plus parser overhead.
// ===========================================================================

'use strict';

(() => {
  const FTM = self.FTM;
  const sessions = new Set();
  let activeParses = 0;

  class Session {
    constructor(port) {
      this.port = port;
      this.reset();
    }

    reset() {
      this.meta = null;
      this.buffer = null;   // Uint8Array — preallocated at BEGIN
      this.received = 0;    // chunks received so far
      this.offset = 0;
    }

    handle(message) {
      if (FTM.messages && !FTM.messages.fromContent(message)) { this.fail('Invalid conversion message'); return; }
      if (message.type === FTM.MSG.BEGIN) this.begin(message.data || {});
      else if (message.type === FTM.MSG.CHUNK) this.chunk(message.data || {});
      else if (message.type === FTM.MSG.ERROR) this.fail(message.data.error);
      else if (message.type === FTM.MSG.END) this.end();
    }

    begin(data) {
      if (!data.fileName || !data.extension || !Number.isInteger(data.totalChunks)) {
        this.fail('Invalid request: missing required fields');
        return;
      }
      this.reset();
      this.meta = data;
      this.buffer = new Uint8Array(data.size);
    }

    chunk(data) {
      if (!this.meta || typeof data.base64 !== 'string') { this.fail('Unexpected chunk'); return; }
      if (data.index !== this.received + 1 || this.received >= this.meta.totalChunks) {
        this.fail('Invalid chunk sequence'); return;
      }
      try {
        const decoded = FTM.text.fromBase64(data.base64);
        if (this.offset + decoded.length > this.buffer.length) { this.fail('Transfer exceeds declared size'); return; }
        this.buffer.set(decoded, this.offset);
        this.offset += decoded.length;
        this.received++;
      } catch (_) { this.fail('Invalid chunk encoding'); }
    }

    end() {
      if (!this.meta || this.received !== this.meta.totalChunks || this.offset !== this.meta.size) {
        this.fail('Incomplete transfer'); return;
      }
      const meta = this.meta;
      const bytes = this.buffer;
      this.reset();
      activeParses++;
      FTM.parse(meta, bytes)
        .then((markdown) => this.send({ type: FTM.MSG.RESULT, data: { markdown, fileName: meta.fileName } }))
        .catch((err) => this.fail(err && err.message ? err.message : String(err)))
        .finally(() => {
          activeParses--;
          if (sessions.size === 0 && activeParses === 0) FTM.libs.release();
        });
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
    if (port.name !== FTM.PORT.OFFSCREEN || (FTM.messages && !FTM.messages.isTrustedPort(port))) return;
    const session = new Session(port);
    sessions.add(session);
    port.onMessage.addListener((message) => session.handle(message));
    port.onDisconnect.addListener(() => {
      sessions.delete(session);
      if (sessions.size === 0 && activeParses === 0) FTM.libs.release();
    });
  });

  FTM.Session = Session;
})();
