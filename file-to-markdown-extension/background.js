// ===========================================================================
// background.js — Background Service Worker (v3.0)
// ===========================================================================
// Thin relay: content scripts ↔ offscreen document.
// Manages offscreen lifecycle, port bridging, config sync.
// ===========================================================================

(async () => {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. DEFAULT CONFIG — single source of truth
  // ---------------------------------------------------------------------------
  const DEFAULT_CONFIG = {
    enabled: true,
    smartMode: true,
    autoConvert: false,
    autoDismissSeconds: 10,
    domainBlacklist: [],
    domainWhitelist: [],
    customAiHosts: [],
    categories: {
      documents: true, pdf: true, spreadsheets: true, code: true,
      markup: true, presentations: true, images: true
    },
    yamlFrontmatter: true,
    csvStreamThreshold: 5,
    stripTrailingWhitespace: true,
    enforceHeadingHierarchy: false,
    regexPipeline: [],
    conversionHistory: [],
    maxConversions: 50
  };

  // ---------------------------------------------------------------------------
  // 2. OFFSCREEN LIFECYCLE
  // ---------------------------------------------------------------------------
  let offscreenReady = false;
  let offscreenCreating = null;

  async function ensureOffscreen() {
    if (offscreenReady) return;
    if (offscreenCreating) return offscreenCreating;

    offscreenCreating = (async () => {
      try {
        const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        if (ctx.length > 0) { offscreenReady = true; return; }

        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['DOM_SCRAPING'],
          justification: 'Parsing binary files to Markdown using local parser libraries.'
        });
        offscreenReady = true;
      } catch (err) {
        try {
          await chrome.offscreen.closeDocument();
          await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DOM_SCRAPING'],
            justification: 'Parsing binary files to Markdown using local parser libraries.'
          });
          offscreenReady = true;
        } catch (err2) {
          offscreenReady = false;
          throw err2;
        }
      }
    })();

    try {
      await offscreenCreating;
    } finally {
      offscreenCreating = null;
    }
  }

  async function closeOffscreen() {
    try {
      await chrome.offscreen.closeDocument();
    } catch (_) {}
    offscreenReady = false;
  }

  // ---------------------------------------------------------------------------
  // 3. INSTALL / UPDATE
  // ---------------------------------------------------------------------------
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      chrome.storage.local.set(DEFAULT_CONFIG);
      return;
    }
    if (details.reason === 'update') {
      chrome.storage.local.get(null, (items) => {
        const merged = { ...DEFAULT_CONFIG };
        for (const key of Object.keys(items)) {
          if (items[key] !== undefined && items[key] !== null) merged[key] = items[key];
        }
        if (items.categories) merged.categories = { ...DEFAULT_CONFIG.categories, ...items.categories };
        chrome.storage.local.set(merged);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. PORT BRIDGING — content ↔ offscreen
  // ---------------------------------------------------------------------------
  let activePortPairs = 0;

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'ftm') return;
    activePortPairs++;

    let offscreenPort = null;
    const pending = [];
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { port.disconnect(); } catch (_) {}
      try { if (offscreenPort) offscreenPort.disconnect(); } catch (_) {}
      offscreenPort = null;
      activePortPairs = Math.max(0, activePortPairs - 1);
      if (activePortPairs <= 0) closeOffscreen();
    };

    port.onDisconnect.addListener(cleanup);

    ensureOffscreen().then(() => {
      if (cleaned) return;
      offscreenPort = chrome.runtime.connect({ name: 'ftm-offscreen-internal' });

      port.onMessage.addListener((msg) => {
        if (offscreenPort) {
          try { offscreenPort.postMessage(msg); }
          catch (_) { port.postMessage({ type: 'ERROR', data: { error: 'Offscreen port error' } }); }
        } else {
          if (pending.length < 10) pending.push(msg);
        }
      });

      offscreenPort.onMessage.addListener((msg) => {
        try { port.postMessage(msg); } catch (_) {}
      });

      while (pending.length > 0) {
        try { offscreenPort.postMessage(pending.shift()); } catch (_) {}
      }

      offscreenPort.onDisconnect.addListener(cleanup);

    }).catch((err) => {
      if (cleaned) return;
      try { port.postMessage({ type: 'ERROR', data: { error: err.message } }); } catch (_) {}
      cleanup();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. MESSAGE HANDLER — CREATE/CLOSE OFFSCREEN
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CREATE_OFFSCREEN') {
      ensureOffscreen().then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ error: err.message }));
      return true;
    }
    if (message.type === 'CLOSE_OFFSCREEN') {
      closeOffscreen().then(() => sendResponse({ type: 'CLOSED' })).catch((err) => sendResponse({ type: 'CLOSE_FAILED', error: err.message }));
      return true;
    }
  });

  // ---------------------------------------------------------------------------
  // 6. CONFIG SYNC — broadcast to all tabs
  // ---------------------------------------------------------------------------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const updated = {};
    for (const [key, change] of Object.entries(changes)) {
      if (key === 'conversionHistory') continue;
      if (change.newValue === undefined) continue;
      updated[key] = change.newValue;
    }
    if (Object.keys(updated).length === 0) return;

    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATE', config: updated }).catch(() => {});
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. SHUTDOWN
  // ---------------------------------------------------------------------------
  chrome.runtime.onSuspend.addListener(() => { closeOffscreen(); });

})();
