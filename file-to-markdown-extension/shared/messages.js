// shared/messages.js — Strict schemas for extension port messages.
'use strict';
(() => {
  const FTM = (self.FTM = self.FTM || {});
  const isObject = (value) => value !== null && typeof value === 'object';
  const validExtension = (value) => typeof value === 'string' && FTM.EXTENSION_MAP[value] !== undefined;
  const validImageMode = (value) => value === 'embedded' || value === 'placeholder' || value === 'external';
  const validType = (message, type) => isObject(message) && message.type === type;
  const validSessionId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
  const validSession = (message) => isObject(message && message.data) && validSessionId(message.data.sessionId);
  const maxChunks = Math.ceil(FTM.CONSTANTS.MAX_FILE_SIZE_BYTES / FTM.CONSTANTS.TRANSFER_CHUNK_BYTES);
  const validBegin = (message) => {
    const data = message && message.data;
    return validType(message, FTM.MSG.BEGIN) && validSession(message) && typeof data.fileName === 'string'
      && data.fileName.length > 0 && data.fileName.length <= 255 && validExtension(data.extension)
      && Number.isInteger(data.size) && data.size >= 0 && data.size <= FTM.CONSTANTS.MAX_FILE_SIZE_BYTES
      && data.chunkSize === FTM.CONSTANTS.TRANSFER_CHUNK_BYTES
      && Number.isInteger(data.totalChunks) && data.totalChunks === Math.ceil(data.size / data.chunkSize)
      && data.totalChunks <= maxChunks
      && (!data.imageMode || validImageMode(data.imageMode));
  };
  const validChunk = (message) => {
    const data = message && message.data;
    return validType(message, FTM.MSG.CHUNK) && validSession(message) && typeof data.base64 === 'string'
      && data.base64.length > 0 && data.base64.length <= Math.ceil(FTM.CONSTANTS.TRANSFER_CHUNK_BYTES * 4 / 3) + 16
      && /^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)
      && Number.isInteger(data.index) && data.index >= 1;
  };
  const validEnd = (message) => validType(message, FTM.MSG.END) && validSession(message);
  const validCancel = (message) => validType(message, FTM.MSG.CANCEL) && validSession(message);
  const validError = (message) => validType(message, FTM.MSG.ERROR) && validSession(message)
    && typeof message.data.error === 'string' && message.data.error.length <= 1024;
  const validAck = (message) => validType(message, FTM.MSG.ACK) && validSession(message)
    && Number.isInteger(message.data.index) && message.data.index >= 1
    && message.data.index <= maxChunks;
  const validProgress = (message) => validType(message, FTM.MSG.PROGRESS) && validSession(message)
    && typeof message.data.phase === 'string' && /^[a-z][a-z-]{1,63}$/.test(message.data.phase)
    && (message.data.percent === undefined || (Number.isInteger(message.data.percent) && message.data.percent >= 0 && message.data.percent <= 100));
  const validResult = (message) => validType(message, FTM.MSG.RESULT) && validSession(message)
    && typeof message.data.markdown === 'string' && message.data.markdown.length <= FTM.CONSTANTS.MAX_FILE_SIZE_BYTES * 4;
  FTM.messages = {
    isTrustedPort(port) { return !!(port && port.sender && port.sender.id === chrome.runtime.id); },
    validSessionId,
    fromContent(message) { return validBegin(message) || validChunk(message) || validEnd(message) || validCancel(message) || validError(message); },
    fromOffscreen(message) {
      return validError(message) || validAck(message) || validProgress(message) || validResult(message);
    }
  };
})();
