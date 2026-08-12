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
    if (pipelineChanged && FTM.postprocess) FTM.postprocess.clearCache();
    return FTM.config;
  };

  FTM.loadConfig = async function loadConfig() {
    if (!self.FTM_BROWSER?.storage) return FTM.config;
    return FTM.applyConfig(await FTM_BROWSER.storage.get(null));
  };

})();
