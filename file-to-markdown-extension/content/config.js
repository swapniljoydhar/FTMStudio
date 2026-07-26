// ===========================================================================
// content/config.js — Configuration state and persistence
// ===========================================================================

window.FTM = window.FTM || {};

FTM.config = {
  enabled: true,
  autoDismissSeconds: FTM.CONSTANTS.TOAST_COUNTDOWN_DEFAULT_SEC,
  domainBlacklist: [],
  categories: { documents: true, pdf: true, spreadsheets: true, code: true, markup: true, presentations: true },
  yamlFrontmatter: true,
  csvStreamThreshold: FTM.CONSTANTS.CSV_STREAM_THRESHOLD_MB_DEFAULT,
  stripTrailingWhitespace: true,
  enforceHeadingHierarchy: false,
  regexPipeline: [],
  conversionHistory: [],
  maxConversions: FTM.CONSTANTS.MAX_HISTORY_ENTRIES
};

FTM.loadConfig = function () {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(null, (items) => {
        if (items) {
          FTM.config = { ...FTM.config, ...items };
          if (items.categories) {
            FTM.config.categories = { ...FTM.config.categories, ...items.categories };
          }
          FTM.config.regexPipeline = FTM.sanitizeRegexPipeline(FTM.config.regexPipeline || []);
        }
        resolve(FTM.config);
      });
    } else {
      resolve(FTM.config);
    }
  });
};

// Listen for config updates from background
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONFIG_UPDATE') {
      FTM.config = { ...FTM.config, ...message.config };
      if (message.config && message.config.categories) {
        FTM.config.categories = { ...FTM.config.categories, ...message.config.categories };
      }
      FTM.config.regexPipeline = FTM.sanitizeRegexPipeline(FTM.config.regexPipeline || []);
    }
  });
}
