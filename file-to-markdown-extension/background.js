// ===========================================================================
// background.js — Service Worker (v7)
// ===========================================================================
//
// Responsibilities:
//   1. Offscreen document lifecycle (create on demand, close when done)
//   2. Port routing: content script -> offscreen (forwarding only)
//   3. Config synchronization via storage.onChanged
//
// V7 CHANGES:
//   - Removed "type": "module" dependency (manifest fixed)
//   - Removed redundant DOM_SCRAPING reason (using DOM_PARSER)
//   - Removed duplicate config fan-out (storage.onChanged handles it)
//   - Removed redundant PORT_READY message
//   - Simplified: no isCreatingOffscreen flag race condition
//   - Proper error recovery on offscreen create
// ===========================================================================

(() => {
  'use strict';

  const REASON_OFFSCREEN = 'ftm-binary-processing';
  let offscreenCreated = false;
  let isCreatingOffscreen = false;

  // ---------------------------------------------------------------------------
  // DEFAULT CONFIG
  // ---------------------------------------------------------------------------
  const DEFAULT_CONFIG = {
    enabled: true,
    autoDismissSeconds: 10,
    domainBlacklist: [],
    categories: {
      documents: true,
      pdf: true,
      spreadsheets: true,
      code: true,
      markup: true,
      presentations: true,
      images: true
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
  // INSTALL / UPDATE
  // ---------------------------------------------------------------------------
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      chrome.storage.local.get(null, (items) => {
        if (Object.keys(items).length === 0) {
          chrome.storage.local.set(DEFAULT_CONFIG);
        }
      });
    }
    if (details.reason === 'update') {
      // Merge new v7 defaults for 'images' category
      chrome.storage.local.get('categories', (items) => {
        if (items.categories && items.categories.images === undefined) {
          items.categories.images = true;
          chrome.storage.local.set({ categories: items.categories });
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // OFFSCREEN LIFECYCLE
  // ---------------------------------------------------------------------------
  async function createOffscreen() {
    if (offscreenCreated || isCreatingOffscreen) return;
    isCreatingOffscreen = true;

    try {
      // Check if offscreen already exists (from a previous call)
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });

      if (existingContexts.length > 0) {
        offscreenCreated = true;
        isCreatingOffscreen = false;
        return;
      }

      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_PARSER'],
        justification: REASON_OFFSCREEN
      });

      offscreenCreated = true;
      isCreatingOffscreen = false;

    } catch (err) {
      isCreatingOffscreen = false;

      // If already created, mark it
      if (err.message && err.message.includes('already created')) {
        offscreenCreated = true;
        return;
      }

      // Attempt recovery: close and retry once
      try {
        await chrome.offscreen.closeDocument();
        offscreenCreated = false;
        await createOffscreen();
      } catch (recoveryErr) {
        console.error('[FTM] Offscreen recovery failed:', recoveryErr.message);
        throw recoveryErr;
      }
    }
  }

  async function closeOffscreen() {
    if (!offscreenCreated) return;

    try {
      await chrome.offscreen.closeDocument();
      offscreenCreated = false;
    } catch (err) {
      offscreenCreated = false;
    }
  }

  // ---------------------------------------------------------------------------
  // MESSAGE HANDLER — CREATE / CLOSE OFFSCREEN
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CREATE_OFFSCREEN') {
      createOffscreen().then(() => {
        sendResponse({ type: 'OFFSCREEN_READY' });
      }).catch((err) => {
        sendResponse({ type: 'ERROR', data: { error: err.message } });
      });
      return true;
    }

    if (message.type === 'CLOSE_OFFSCREEN') {
      closeOffscreen().then(() => {
        sendResponse({ type: 'CLOSED' });
      }).catch((err) => {
        sendResponse({ type: 'CLOSE_FAILED', data: { error: err.message } });
      });
      return true;
    }

    if (message.type === 'CLOSE_OFFSCREEN_DONE') {
      offscreenCreated = false;
    }

    return false;
  });

  // ---------------------------------------------------------------------------
  // PORT ROUTING — content script ↔ offscreen document
  // ---------------------------------------------------------------------------
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'ftm') return;

    // Create offscreen if needed, then bridge ports
    createOffscreen().then(() => {
      const offscreenPort = chrome.runtime.connect({ name: 'ftm-offscreen-internal' });
      const pendingMessages = [];

      // content -> offscreen (with buffering for race conditions)
      port.onMessage.addListener((msg) => {
        if (offscreenPort) {
          try { offscreenPort.postMessage(msg); }
          catch (_) { port.postMessage({ type: 'ERROR', data: { error: 'Offscreen port error' } }); }
        } else {
          pendingMessages.push(msg);
        }
      });

      // offscreen -> content
      offscreenPort.onMessage.addListener((msg) => {
        try { port.postMessage(msg); }
        catch (_) {}
      });

      // Flush buffered messages
      while (pendingMessages.length > 0) {
        try { offscreenPort.postMessage(pendingMessages.shift()); }
        catch (_) {}
      }

      // Cleanup on disconnect
      const cleanup = () => {
        try { offscreenPort.disconnect(); } catch (_) {}
        port.onDisconnect.removeListener(cleanup);
        offscreenPort.onDisconnect.removeListener(cleanup);
      };

      port.onDisconnect.addListener(cleanup);
      offscreenPort.onDisconnect.addListener(() => {
        try { port.disconnect(); } catch (_) {}
        cleanup();
      });

    }).catch((err) => {
      port.postMessage({ type: 'ERROR', data: { error: err.message } });
      try { port.disconnect(); } catch (_) {}
    });
  });

  // ---------------------------------------------------------------------------
  // CONFIG SYNC — storage.onChanged broadcasts to all content scripts
  // ---------------------------------------------------------------------------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // Build updated config (excluding conversionHistory which is internal)
    const updated = {};
    for (const [key, change] of Object.entries(changes)) {
      if (key === 'conversionHistory') continue;
      updated[key] = change.newValue;
    }

    if (Object.keys(updated).length === 0) return;

    // Use runtime.sendMessage (broadcast) instead of per-tab
    chrome.runtime.sendMessage({ type: 'CONFIG_UPDATE', config: updated }).catch(() => {
      // No listeners — expected if no content scripts loaded
    });
  });

  // ---------------------------------------------------------------------------
  // SHUTDOWN
  // ---------------------------------------------------------------------------
  chrome.runtime.onSuspend.addListener(() => {
    closeOffscreen();
  });

})();

console.log('[FTM] Background service worker started (v7.0.0)');
