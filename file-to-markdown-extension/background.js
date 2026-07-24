// ===========================================================================
// background.js — Background Service Worker (v6)
// ===========================================================================
//
// MANIFEST V3 SERVICE WORKER
//
// V6 ARCHITECTURE:
//   The background acts as a thin relay between content scripts and the
//   offscreen document. It does NOT hold file data in memory.
//
//   Port routing is simplified:
//     content.js → background (port 'ftm') → offscreen (forward)
//     offscreen → background → content.js
//
//   NO dual-port listening in the offscreen. The offscreen listens ONLY
//   for 'ftm-offscreen-internal'. The content listens for 'ftm'.
//   The background bridges them.
//
// V6 FIXES:
//   1. Fixed web_accessible_resources (was missing — caused library load failures)
//   2. Simplified port routing — no ambiguous dual-name listening
//   3. Proper PDF.js worker path handling via web_accessible_resources
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. OFFSCREEN DOCUMENT LIFECYCLE
// ---------------------------------------------------------------------------

let offscreenCreated = false;

async function createOffscreen() {
  if (offscreenCreated) return;

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
      await createOffscreen();
    } catch (err2) {
      console.error('[FTM] Offscreen recovery failed:', err2.message);
      throw err2;
    }
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
// V6 SIMPLIFIED ROUTING:
//   Content script opens port named 'ftm'.
//   Background receives it, creates offscreen, opens internal port
//   named 'ftm-offscreen-internal' to the offscreen document.
//   Messages flow: content ↔ background ↔ offscreen.
//
//   The offscreen document ONLY listens for 'ftm-offscreen-internal'.
//   No dual-name ambiguity. No PORT_READY message.
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ftm') return;

  const pendingMessages = [];
  let offscreenPort = null;
  let ready = false;
  let isCreatingOffscreen = false;

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

  // Mark as creating to prevent duplicate calls
  isCreatingOffscreen = true;
  
  createOffscreen().then(() => {
    isCreatingOffscreen = false;
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
    });
    
    offscreenPort.onDisconnect.addListener(() => {
      try { port.disconnect(); } catch (_) {}
      offscreenPort = null;
      ready = false;
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
    isCreatingOffscreen = false;
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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[FTM] Extension installed — setting default config');
    chrome.storage.local.get(null, (items) => {
      if (Object.keys(items).length === 0) {
        chrome.storage.local.set({
          enabled: true,
          autoDismissSeconds: 10,
          domainBlacklist: [],
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
        });
      }
    });
  }

  if (details.reason === 'update') {
    console.log('[FTM] Extension updated to v' + chrome.runtime.getManifest().version);
  }
});

// ---------------------------------------------------------------------------
// 6. CLEANUP ON SHUTDOWN
// ---------------------------------------------------------------------------

chrome.runtime.onSuspend.addListener(() => {
  closeOffscreen();
});

console.log('[FTM] Background service worker started (v6)');
