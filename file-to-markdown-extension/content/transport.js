// Session-scoped, backpressured transfer to the offscreen parser.
'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  function sessionId() {
    if (self.crypto && typeof self.crypto.randomUUID === 'function') return self.crypto.randomUUID().replace(/-/g, '');
    const bytes = new Uint8Array(16);
    if (self.crypto && self.crypto.getRandomValues) self.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  class Transfer {
    constructor(file, extension, options) {
      this.file = file;
      this.extension = extension;
      this.options = options || {};
      this.sessionId = sessionId();
      this.port = null;
      this.waitingAck = null;
      this.absoluteTimer = null;
      this.progressTimer = null;
      this.settled = false;
      this.resolve = null;
      this.reject = null;
    }

    send(type, data) {
      if (!this.port || this.settled) return false;
      try { this.port.postMessage({ type, data: { sessionId: this.sessionId, ...data } }); return true; }
      catch (_) { this.finish(new Error('Conversion channel closed')); return false; }
    }

    resetNoProgress(stage) {
      if (this.progressTimer) clearTimeout(this.progressTimer);
      this.progressTimer = setTimeout(() => this.finish(new Error('Conversion stalled during ' + stage)), FTM.CONSTANTS.CONVERSION_NO_PROGRESS_TIMEOUT_MS);
    }

    finish(error, markdown) {
      if (this.settled) return;
      this.settled = true;
      if (this.absoluteTimer) clearTimeout(this.absoluteTimer);
      if (this.progressTimer) clearTimeout(this.progressTimer);
      try { if (this.port) this.port.disconnect(); } catch (_) {}
      this.port = null;
      this.waitingAck = null;
      if (error) this.reject(error); else this.resolve(markdown);
    }

    cancel() {
      if (this.settled) return;
      this.send(FTM.MSG.CANCEL, {});
      this.finish(new Error('Conversion cancelled'));
    }

    onMessage(message) {
      if (!FTM.messages || !FTM.messages.fromOffscreen(message) || message.data.sessionId !== this.sessionId || this.settled) return;
      if (message.type === FTM.MSG.ACK) {
        const ack = this.waitingAck;
        if (!ack || message.data.index !== ack.index) return;
        this.waitingAck = null;
        this.resetNoProgress('transfer');
        this.readNextChunk(ack.offset, ack.index, ack.size, ack.chunkSize);
      } else if (message.type === FTM.MSG.PROGRESS) {
        this.resetNoProgress(message.data.phase);
      } else if (message.type === FTM.MSG.RESULT) {
        this.finish(null, message.data.markdown);
      } else if (message.type === FTM.MSG.ERROR) {
        this.finish(new Error(message.data.error || 'Conversion failed'));
      }
    }

    sendStreaming() {
      const size = this.file.size;
      const chunkSize = FTM.CONSTANTS.TRANSFER_CHUNK_BYTES;
      const totalChunks = Math.ceil(size / chunkSize);
      this.send(FTM.MSG.BEGIN, { fileName: this.file.name, extension: this.extension, size, chunkSize, totalChunks, ...this.options });
      this.readNextChunk(0, 0, size, chunkSize);
    }

    readNextChunk(offset, index, size, chunkSize) {
      if (!this.port || this.settled) return;
      if (offset >= size) { this.send(FTM.MSG.END, {}); this.resetNoProgress('parsing'); return; }
      const end = Math.min(offset + chunkSize, size);
      this.file.slice(offset, end).arrayBuffer().then((buffer) => {
        if (!this.port || this.settled) return;
        const nextIndex = index + 1;
        this.waitingAck = { offset: end, index: nextIndex, size, chunkSize };
        this.send(FTM.MSG.CHUNK, { base64: FTM.text.toBase64(new Uint8Array(buffer)), index: nextIndex });
        this.resetNoProgress('transfer');
      }).catch(() => {
        this.send(FTM.MSG.ERROR, { error: 'File read failed' });
        this.finish(new Error('File read failed'));
      });
    }

    run() {
      return new Promise((resolve, reject) => {
        this.resolve = resolve; this.reject = reject;
        this.port = chrome.runtime.connect({ name: FTM.PORT.CONTENT });
        this.port.onMessage.addListener((message) => this.onMessage(message));
        this.port.onDisconnect.addListener(() => this.finish(new Error('Conversion channel closed')));
        this.absoluteTimer = setTimeout(() => this.finish(new Error('Conversion timed out')), FTM.CONSTANTS.CONVERSION_TIMEOUT_MS);
        this.resetNoProgress('connection');
        this.sendStreaming();
      });
    }
  }

  FTM.transport = {
    async convert(file, extension, options) {
      if (file.size > FTM.CONSTANTS.MAX_FILE_SIZE_BYTES) throw new Error('File too large: ' + FTM.text.formatBytes(file.size));
      return new Transfer(file, extension, options).run();
    }
  };
})();
