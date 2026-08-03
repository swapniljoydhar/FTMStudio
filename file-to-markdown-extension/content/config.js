// ===========================================================================
// content/config.js — Config state for the isolated world
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  FTM.config = FTM.configUtils.defaults({});

  FTM.applyConfig = function applyConfig(patch) {
    const pipelineChanged = !!(patch && 'regexPipeline' in patch);
    FTM.config = FTM.configUtils.merge(FTM.config, patch || {});
    if (FTM.activation) FTM.activation.invalidate();
    if (pipelineChanged && FTM.postprocess) FTM.postprocess.clearCache();
    return FTM.config;
  };

  FTM.loadConfig = async function loadConfig() {
    if (!self.chrome || !chrome.storage || !chrome.storage.local) return FTM.config;
    return FTM.applyConfig(await chrome.storage.local.get(null));
  };

  if (self.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (!FTM.messages?.isTrustedPort({ sender })) return;
      if (message && message.type === FTM.MSG.CONFIG_UPDATE && message.config) FTM.applyConfig(message.config);
    });
  }
})();
