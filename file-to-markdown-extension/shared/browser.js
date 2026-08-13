// shared/browser.js — minimal cross-browser WebExtensions adapter
// ===========================================================================

'use strict';

(() => {
  const root = globalThis;
  const api = root.browser || root.chrome;
  if (!api) throw new Error('WebExtensions API is unavailable.');

  function call(method, context, args) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };
      const fail = (error) => { if (!settled) { settled = true; reject(error); } };
      const callback = (value) => {
        const lastError = api.runtime && api.runtime.lastError;
        if (lastError) fail(new Error(lastError.message)); else done(value);
      };
      try {
        const result = method.apply(context, [...args, callback]);
        if (result && typeof result.then === 'function') result.then(done, fail);
        else if (result !== undefined) done(result);
      } catch (error) {
        try {
          const result = method.apply(context, args);
          if (result && typeof result.then === 'function') result.then(done, fail);
          else if (result !== undefined) done(result); else fail(error);
        } catch (retryError) { fail(retryError); }
      }
    });
  }

  const storageLocal = api.storage && api.storage.local;
  const storage = storageLocal ? {
    get(keys) { return call(storageLocal.get, storageLocal, [keys]); },
    set(value) { return call(storageLocal.set, storageLocal, [value]); },
    remove(keys) { return call(storageLocal.remove, storageLocal, [keys]); }
  } : null;

  root.FTM_BROWSER = {
    api,
    runtime: api.runtime,
    storage,
    getURL(path) { return api.runtime.getURL(path); },
    call
  };
})();
