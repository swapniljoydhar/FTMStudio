// ===========================================================================
// content/history.js — Conversion history persistence (debounced)
// ===========================================================================

window.FTM = window.FTM || {};

const conversionHistory = [];
let historyPersistTimer = null;

FTM.recordConversion = function (fileName, fileSize, extension) {
  conversionHistory.push({
    file: fileName,
    size: fileSize,
    extension: extension,
    timestamp: new Date().toISOString()
  });

  const max = FTM.config.maxConversions || 50;
  while (conversionHistory.length > max) conversionHistory.shift();

  if (historyPersistTimer) clearTimeout(historyPersistTimer);
  historyPersistTimer = setTimeout(() => {
    chrome.storage.local.set({ conversionHistory: [...conversionHistory] });
    historyPersistTimer = null;
  }, 2000);
};
