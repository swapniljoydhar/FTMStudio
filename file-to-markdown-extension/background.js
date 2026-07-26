// ===========================================================================
// background.js — Background Service Worker (v1.0.1)
// ===========================================================================
//
// MANIFEST V3 SERVICE WORKER
//
// ARCHITECTURE:
//   The background acts as a thin relay between content scripts and the
//   offscreen document. It does NOT hold file data in memory.
//
//   Port routing is simplified:
//     content/ modules → background (port 'ftm') → offscreen (forward)
//     offscreen → background → content/ modules
//
//   NO dual-port listening in the offscreen. The offscreen listens ONLY
//   for 'ftm-offscreen-internal'. The content listens for 'ftm'.
//   The background bridges them.
//
// FIXES:
//   1. Fixed web_accessible_resources (was missing — caused library load failures)
//   2. Simplified port routing — no ambiguous dual-name listening
//   3. Proper PDF.js worker path handling via web_accessible_resources
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. OFFSCREEN DOCUMENT LIFECYCLE
// ---------------------------------------------------------------------------

let offscreenCreated = false;
let offscreenCreating = null; // Promise-based mutex to prevent concurrent creation

async function createOffscreen() {
  if (offscreenCreated) return;

  // If another call is already creating the offscreen, wait for it
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = (async () => {
    try {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });

      if (existingContexts.length > 0) {
        offscreenCreated = true;
        return;
      }

      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_SCRAPING'],
        justification: 'Parsing binary file formats (.docx, .xlsx, .epub, .pdf, .pptx) to Markdown using local parser libraries.'
      });

      offscreenCreated = true;
      console.log('[FTM] Offscreen document created');

    } catch (err) {
      console.warn('[FTM] Offscreen create failed, attempting recovery:', err.message);
      try {
        await chrome.offscreen.closeDocument();
        offscreenCreated = false;
        // Retry once
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['DOM_SCRAPING'],
          justification: 'Parsing binary file formats (.docx, .xlsx, .epub, .pdf, .pptx) to Markdown using local parser libraries.'
        });
        offscreenCreated = true;
      } catch (err2) {
        console.error('[FTM] Offscreen recovery failed:', err2.message);
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
  if (!offscreenCreated) return;

  try {
    await chrome.offscreen.closeDocument();
    offscreenCreated = false;
    console.log('[FTM] Offscreen document closed');
  } catch (err) {
    console.warn('[FTM] Offscreen close failed:', err.message);
    offscreenCreated = false;
  }
}

// ---------------------------------------------------------------------------
// 2. PORT-BASED MESSAGE ROUTING (Transferable Objects)
// ---------------------------------------------------------------------------
//
// SIMPLIFIED ROUTING:
//   Content script opens port named 'ftm'.
//   Background receives it, creates offscreen, opens internal port
//   named 'ftm-offscreen-internal' to the offscreen document.
//   Messages flow: content ↔ background ↔ offscreen.
//
//   The offscreen document ONLY listens for 'ftm-offscreen-internal'.
//   No dual-name ambiguity. No PORT_READY message.
// ---------------------------------------------------------------------------

let activePortPairs = 0;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ftm') return;

  const pendingMessages = [];
  let offscreenPort = null;
  let ready = false;
  activePortPairs++;

  // Synchronously listen for messages to prevent dropped messages during async offscreen creation
  port.onMessage.addListener((message) => {
    if (ready && offscreenPort) {
      try {
        offscreenPort.postMessage(message);
      } catch (err) {
        console.error('[FTM] Failed to forward message to offscreen:', err.message);
        port.postMessage({ type: 'ERROR', data: { error: 'Offscreen communication failed' } });
      }
    } else {
      pendingMessages.push(message);
    }
  });

  createOffscreen().then(() => {
    offscreenPort = chrome.runtime.connect({ name: 'ftm-offscreen-internal' });

    offscreenPort.onMessage.addListener((message) => {
      try {
        port.postMessage(message);
      } catch (err) {
        console.error('[FTM] Failed to forward message to content:', err.message);
      }
    });

    port.onDisconnect.addListener(() => {
      try { offscreenPort.disconnect(); } catch (_) {}
      offscreenPort = null;
      activePortPairs = Math.max(0, activePortPairs - 1);
      // Close offscreen when last port pair disconnects
      if (activePortPairs <= 0) {
        closeOffscreen();
      }
    });
    
    offscreenPort.onDisconnect.addListener(() => {
      try { port.disconnect(); } catch (_) {}
      offscreenPort = null;
      ready = false;
      activePortPairs = Math.max(0, activePortPairs - 1);
      if (activePortPairs <= 0) {
        closeOffscreen();
      }
    });

    ready = true;
    // Flush buffered messages
    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift();
      try {
        offscreenPort.postMessage(msg);
      } catch (err) {
        console.error('[FTM] Failed to send buffered message:', err.message);
        port.postMessage({ type: 'ERROR', data: { error: 'Buffered message failed' } });
      }
    }

  }).catch((err) => {
    console.error('[FTM] Offscreen creation failed:', err.message);
    port.postMessage({ type: 'ERROR', data: { error: err.message } });
    try { port.disconnect(); } catch (_) {}
  });
});

// ---------------------------------------------------------------------------
// 3. LEGACY MESSAGE HANDLING (non-port messages)
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

  if (message.type === 'KEEP_ALIVE') {
    // No-op
  }
});

// ---------------------------------------------------------------------------
// 4. CONFIG SYNC — broadcast updates to all content scripts
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          const updatedConfig = {};
          for (const key in changes) {
            updatedConfig[key] = changes[key].newValue;
          }
          chrome.tabs.sendMessage(tab.id, {
            type: 'CONFIG_UPDATE',
            config: updatedConfig
          }).catch(() => { /* Tab may not have content script */ });
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 5. INSTALLATION / UPGRADE HANDLING
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  enabled: true,
  smartMode: true,
  autoDismissSeconds: 10,
  domainBlacklist: [],
  domainWhitelist: [],
  customAiHosts: [],
  categories: {
    documents: true,
    pdf: true,
    spreadsheets: true,
    code: true,
    markup: true,
    presentations: true
  },
  yamlFrontmatter: true,
  csvStreamThreshold: 5,
  stripTrailingWhitespace: true,
  enforceHeadingHierarchy: false,
  regexPipeline: [],
  conversionHistory: [],
  maxConversions: 50
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[FTM] Extension installed — setting default config');
    chrome.storage.local.set(DEFAULT_CONFIG);
  }

  if (details.reason === 'update') {
    console.log('[FTM] Extension updated to v' + chrome.runtime.getManifest().version);
    // Merge new default keys into existing config (preserves user values)
    chrome.storage.local.get(null, (items) => {
      const merged = { ...DEFAULT_CONFIG };
      for (const key of Object.keys(items)) {
        if (items[key] !== undefined && items[key] !== null) {
          merged[key] = items[key];
        }
      }
      // Deep-merge categories
      if (items.categories) {
        merged.categories = { ...DEFAULT_CONFIG.categories, ...items.categories };
      }
      chrome.storage.local.set(merged);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. CLEANUP ON SHUTDOWN
// ---------------------------------------------------------------------------

chrome.runtime.onSuspend.addListener(() => {
  closeOffscreen();
});

console.log('[FTM] Background service worker started (v1.0.1)');
