// Explicit session state machine for the internal parser Port.
'use strict';
(() => {
  const FTM = self.FTM;
  const sessions = new Set(); let activeParses = 0;
  class Session {
    constructor(port) { this.port = port; this.state = 'awaiting-begin'; this.meta = null; this.buffer = null; this.received = 0; this.offset = 0; this.cancelled = false; }
    handle(message) {
      if (!FTM.messages || !FTM.messages.fromContent(message)) return this.fail('Invalid conversion message');
      if (this.state === 'terminal') return;
      if (message.type === FTM.MSG.BEGIN) return this.begin(message.data);
      if (!this.meta || message.data.sessionId !== this.meta.sessionId) return this.fail('Mismatched conversion session');
      if (message.type === FTM.MSG.CANCEL || message.type === FTM.MSG.ERROR) return this.cancel();
      if (message.type === FTM.MSG.CHUNK) return this.chunk(message.data);
      if (message.type === FTM.MSG.END) return this.end();
      this.fail('Unexpected conversion message');
    }
    begin(data) {
      if (this.state !== 'awaiting-begin') return this.fail('Duplicate conversion begin');
      this.meta = data; this.buffer = new Uint8Array(data.size); this.state = 'receiving';
      this.progress('transfer-accepted', 0);
    }
    chunk(data) {
      if (this.state !== 'receiving' || data.index !== this.received + 1 || this.received >= this.meta.totalChunks) return this.fail('Invalid chunk sequence');
      try {
        const next = FTM.text.fromBase64Into(data.base64, this.buffer, this.offset);
        if (next > this.buffer.length) return this.fail('Transfer exceeds declared size');
        this.offset = next; this.received++;
        this.send(FTM.MSG.ACK, { index: data.index });
      } catch (_) { this.fail('Invalid chunk encoding'); }
    }
    end() {
      if (this.state !== 'receiving' || this.received !== this.meta.totalChunks || this.offset !== this.meta.size) return this.fail('Incomplete transfer');
      const meta = this.meta; const bytes = this.buffer;
      this.buffer = null; this.state = 'parsing'; activeParses++;
      this.progress('transfer-complete', 100);
      FTM.parse(meta, bytes, (phase, percent) => this.progress(phase, percent)).then((markdown) => {
        if (!this.cancelled && this.state === 'parsing') { this.progress('complete', 100); this.send(FTM.MSG.RESULT, { markdown }); this.terminal(); }
      }).catch((err) => { if (!this.cancelled) this.fail((err && err.message) || 'Parser failed'); }).finally(() => { activeParses--; if (sessions.size === 0 && activeParses === 0) FTM.libs.release(); });
    }
    progress(phase, percent) { if (!this.cancelled && this.state !== 'terminal') this.send(FTM.MSG.PROGRESS, { phase, percent: Math.max(0, Math.min(100, Math.round(percent || 0))) }); }
    cancel() { if (this.state === 'terminal') return; this.cancelled = true; this.buffer = null; this.send(FTM.MSG.ERROR, { error: 'Conversion cancelled' }); this.terminal(); }
    fail(error) { if (this.state === 'terminal') return; this.buffer = null; this.send(FTM.MSG.ERROR, { error: String(error).slice(0, 1024) }); this.terminal(); }
    terminal() { this.state = 'terminal'; }
    send(type, data) { try { this.port.postMessage({ type, data: { sessionId: this.meta && this.meta.sessionId, ...data } }); } catch (_) {} }
  }
  FTM.parse = async function(meta, bytes, progress) { const parser = FTM.parsers[meta.extension]; if (!parser) throw new Error('Unsupported binary format: ' + meta.extension); if (!bytes.length) throw new Error('File is empty'); progress('parser-running', 50); return parser(bytes, meta, progress); };
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== FTM.PORT.OFFSCREEN || !FTM.messages || !FTM.messages.isTrustedPort(port)) return;
    const session = new Session(port); sessions.add(session);
    port.onMessage.addListener((message) => session.handle(message));
    port.onDisconnect.addListener(() => { session.cancelled = true; session.buffer = null; sessions.delete(session); if (sessions.size === 0 && activeParses === 0) FTM.libs.release(); });
  });
  FTM.Session = Session;
})();
