// shared/messages.js — Strict schemas for extension port messages.
'use strict';
(() => {
  const FTM = (self.FTM = self.FTM || {});
  const isObject = (value) => value !== null && typeof value === 'object';
  const validExtension = (value) => typeof value === 'string' && FTM.EXTENSION_MAP[value] !== undefined;
  const validType = (message, type) => isObject(message) && message.type === type;
  const validBegin = (message) => {
    const data = message && message.data;
    return validType(message, FTM.MSG.BEGIN) && isObject(data) && typeof data.fileName === 'string'
      && data.fileName.length > 0 && data.fileName.length <= 255 && validExtension(data.extension)
      && Number.isInteger(data.size) && data.size >= 0 && data.size <= FTM.CONSTANTS.MAX_FILE_SIZE_BYTES
      && Number.isInteger(data.totalChunks) && data.totalChunks >= 0
      && data.totalChunks <= Math.ceil(FTM.CONSTANTS.MAX_FILE_SIZE_BYTES / FTM.CONSTANTS.TRANSFER_CHUNK_BYTES);
  };
  const validChunk = (message) => {
    const data = message && message.data;
    return validType(message, FTM.MSG.CHUNK) && isObject(data) && typeof data.base64 === 'string'
      && data.base64.length > 0 && data.base64.length <= Math.ceil(FTM.CONSTANTS.TRANSFER_CHUNK_BYTES * 4 / 3) + 16
      && /^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)
      && Number.isInteger(data.index) && data.index >= 1;
  };
  const validError = (message) => validType(message, FTM.MSG.ERROR) && isObject(message.data)
    && typeof message.data.error === 'string' && message.data.error.length <= 1024;
  FTM.messages = {
    isTrustedPort(port) { return !!(port && port.sender && port.sender.id === chrome.runtime.id); },
    fromContent(message) { return validBegin(message) || validChunk(message) || validError(message) || validType(message, FTM.MSG.END); },
    fromOffscreen(message) {
      if (validError(message)) return true;
      return validType(message, FTM.MSG.RESULT) && isObject(message.data)
      && typeof message.data.markdown === 'string' && message.data.markdown.length <= FTM.CONSTANTS.MAX_FILE_SIZE_BYTES * 4;
    }
  };
})();
