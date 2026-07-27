// ===========================================================================
// content/history.js — Conversion history persistence (v3.0)
// ===========================================================================

window.FTM = window.FTM || {};

const conversionHistory = [];
let historyPersistTimer = null;

FTM.recordConversion = function (fileName, fileSize, extension, outputSize) {
  conversionHistory.push({ file: fileName, size: fileSize, extension: extension, timestamp: new Date().toISOString(), outputSize: outputSize || 0 });
  const max = FTM.config.maxConversions || 50;
  while (conversionHistory.length > max) conversionHistory.shift();
  if (historyPersistTimer) clearTimeout(historyPersistTimer);
  historyPersistTimer = setTimeout(() => { chrome.storage.local.set({ conversionHistory: [...conversionHistory] }); historyPersistTimer = null; }, 2000);
};

FTM.flushHistory = function () {
  if (historyPersistTimer) {
    clearTimeout(historyPersistTimer);
    historyPersistTimer = null;
    chrome.storage.local.set({ conversionHistory: [...conversionHistory] });
  }
};
