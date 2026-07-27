// ===========================================================================
// content/transport.js — Chunked binary transfer to the offscreen parser
// ===========================================================================
// chrome.runtime ports serialise messages as JSON: an ArrayBuffer arrives as
// {} and the transfer-list argument is ignored (unlike Worker.postMessage).
// Bytes therefore travel as bounded base64 chunks with an explicit
// BEGIN/CHUNK/END framing and a hard timeout.
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
    }

    send(message) {
      this.port.postMessage(message);
    }

    frames(bytes) {
      const chunks = FTM.text.encodeChunks(bytes);
      return [
        { type: FTM.MSG.BEGIN, data: { fileName: this.file.name, extension: this.extension, size: bytes.length, totalChunks: chunks.length, ...this.options } },
        ...chunks.map((base64) => ({ type: FTM.MSG.CHUNK, data: { base64 } })),
        { type: FTM.MSG.END }
      ];
    }

    onMessage(message, resolve, reject) {
      if (!message || typeof message.type !== 'string') return;
      if (message.type === FTM.MSG.RESULT) resolve(message.data.markdown);
      else if (message.type === FTM.MSG.ERROR) reject(new Error(message.data.error || 'Conversion failed'));
      else return;
      this.close();
    }

    close() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      try { if (this.port) this.port.disconnect(); } catch (_) {}
      this.port = null;
    }

    async run() {
      const bytes = new Uint8Array(await this.file.arrayBuffer());
      return new Promise((resolve, reject) => {
        this.port = chrome.runtime.connect({ name: FTM.PORT.CONTENT });
        this.port.onMessage.addListener((message) => this.onMessage(message, resolve, reject));
        this.port.onDisconnect.addListener(() => { this.close(); reject(new Error('Conversion channel closed')); });
        this.timer = setTimeout(() => { this.close(); reject(new Error('Conversion timed out')); }, FTM.CONSTANTS.CONVERSION_TIMEOUT_MS);
        for (const frame of this.frames(bytes)) this.send(frame);
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
