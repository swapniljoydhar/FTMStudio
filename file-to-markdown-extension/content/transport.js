// ===========================================================================
// content/transport.js — Chunked binary transfer to the offscreen parser
// ===========================================================================
// Streams binary files as bounded base64 chunks over chrome.runtime.Port.
//
// Memory profile (vs. old code):
//   OLD: file.arrayBuffer() → full Uint8Array → encodeChunks() → all base64
//        strings → JSON per chunk.  Peak ≈ 3× file size.
//   NEW: file.slice() per 512 KB chunk → base64 → send → GC reclaims slice.
//        Only one chunk lives in memory at a time.  Peak ≈ 0.5 MB + overhead.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  class Transfer {
    constructor(file, extension, options) {
      this.file = file;
      this.extension = extension;
      this.options = options || {};
      this.port = null;
      this.timer = null;
      this.waitingAck = null;
    }

    send(message) {
      this.port.postMessage(message);
    }

    onMessage(message, resolve, reject) {
      if (FTM.messages && !FTM.messages.fromOffscreen(message)) return;
      if (!message || typeof message.type !== 'string') return;
      if (message.type === FTM.MSG.ACK) {
        const ack = this.waitingAck;
        if (!ack || message.data.index !== ack.index) return;
        this.waitingAck = null;
        this.readNextChunk(ack.offset, ack.index, ack.size, ack.chunkSize);
        return;
      }
      if (message.type === FTM.MSG.RESULT) resolve(message.data.markdown);
      else if (message.type === FTM.MSG.ERROR) reject(new Error(message.data.error || 'Conversion failed'));
      else return;
      this.close();
    }

    close() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      try { if (this.port) this.port.disconnect(); } catch (_) {}
      this.port = null;
      this.waitingAck = null;
    }

    // ── Streaming send ──────────────────────────────────────────────────
    // Reads the file in 512 KB slices, converts each to base64, and sends
    // it only after the previous chunk is acknowledged.  This prevents
    // chrome.runtime.Port from queueing multiple cloned base64 payloads.
    sendStreaming() {
      const size = this.file.size;
      const chunkSize = FTM.CONSTANTS.TRANSFER_CHUNK_BYTES;
      const totalChunks = Math.ceil(size / chunkSize);
      this.send({ type: FTM.MSG.BEGIN, data: {
        fileName: this.file.name, extension: this.extension, size, totalChunks, ...this.options
      } });
      this.readNextChunk(0, 0, size, chunkSize);
    }

    readNextChunk(offset, index, size, chunkSize) {
      if (!this.port) return;
      const readNext = () => {
        if (offset >= size) {
          this.send({ type: FTM.MSG.END });
          return;
        }
        const end = Math.min(offset + chunkSize, size);
        const slice = this.file.slice(offset, end);
        offset = end;
        index++;
        slice.arrayBuffer().then((buffer) => {
          if (!this.port) return;
          const bytes = new Uint8Array(buffer);
          const base64 = FTM.text.toBase64(bytes);
          this.waitingAck = { offset, index, size, chunkSize };
          this.send({ type: FTM.MSG.CHUNK, data: { base64, index } });
        }).catch((err) => {
          this.send({ type: FTM.MSG.ERROR, data: { error: 'Read failed: ' + (err.message || err) } });
          this.close();
        });
      };
      readNext();
    }

    async run() {
      // No upfront file.arrayBuffer() — streaming reads one slice at a time.
      return new Promise((resolve, reject) => {
        this.port = chrome.runtime.connect({ name: FTM.PORT.CONTENT });
        this.port.onMessage.addListener((message) => this.onMessage(message, resolve, reject));
        this.port.onDisconnect.addListener(() => { this.close(); reject(new Error('Conversion channel closed')); });
        this.timer = setTimeout(() => { this.close(); reject(new Error('Conversion timed out')); }, FTM.CONSTANTS.CONVERSION_TIMEOUT_MS);
        this.sendStreaming();
      });
    }
  }

  FTM.transport = {
    async convert(file, extension, options) {
      if (file.size > FTM.CONSTANTS.MAX_FILE_SIZE_BYTES) {
        throw new Error('File too large: ' + FTM.text.formatBytes(file.size) + ' (max ' + FTM.text.formatBytes(FTM.CONSTANTS.MAX_FILE_SIZE_BYTES) + ')');
      }
      return new Transfer(file, extension, options).run();
    }
  };

  FTM.Transfer = Transfer;
})();
