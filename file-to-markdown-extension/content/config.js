// ===========================================================================
// content/config.js — Configuration state and persistence (v3.0)
// ===========================================================================

window.FTM = window.FTM || {};

FTM.config = {
  enabled: true, smartMode: true, autoConvert: false,
  autoDismissSeconds: FTM.CONSTANTS.TOAST_COUNTDOWN_DEFAULT_SEC,
  domainBlacklist: [], domainWhitelist: [], customAiHosts: [],
  categories: { documents: true, pdf: true, spreadsheets: true, code: true, markup: true, presentations: true, images: true },
  yamlFrontmatter: true, csvStreamThreshold: FTM.CONSTANTS.CSV_STREAM_THRESHOLD_MB_DEFAULT,
  stripTrailingWhitespace: true, enforceHeadingHierarchy: false,
  regexPipeline: [], conversionHistory: [], maxConversions: FTM.CONSTANTS.MAX_HISTORY_ENTRIES
};

FTM.loadConfig = function () {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(null, (items) => {
        if (items) {
          FTM.config = { ...FTM.config, ...items };
          if (items.categories) FTM.config.categories = { ...FTM.config.categories, ...items.categories };
          FTM.config.regexPipeline = FTM.sanitizeRegexPipeline(FTM.config.regexPipeline || []);
        }
        resolve(FTM.config);
      });
    } else {
      resolve(FTM.config);
    }
  });
};

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONFIG_UPDATE' && message.config && typeof message.config === 'object') {
      FTM.config = { ...FTM.config, ...message.config };
      if (message.config && message.config.categories) FTM.config.categories = { ...FTM.config.categories, ...message.config.categories };
      FTM.config.regexPipeline = FTM.sanitizeRegexPipeline(FTM.config.regexPipeline || []);
      FTM._aiHostsSet = null;
    }
  });
}
