// ===========================================================================
// background.js — Service worker entry point
// ===========================================================================
// FIX #3 (Medium): onInstalled listener now returns the Promise so Chrome
//   keeps the service worker alive until seedConfig + sync complete.
// FIX #4 (Medium): registrar.sync() is serialized via a mutex to prevent
//   concurrent unregister/register races from onStartup + onInstalled.
// FIX #6 (Perf): broadcast() reuses the config from relevantChanges()
//   instead of doing a redundant chrome.storage.local.get(null).
// ===========================================================================

'use strict';

importScripts(
  'shared/constants.js',
  'shared/text.js',
  'shared/config.js',
  'shared/messages.js',
  'sw/offscreen-manager.js',
  'sw/bridge.js',
  'sw/registrar.js'
);

const FTM = self.FTM;

// Keys that change which pages must be instrumented.
const REGISTRATION_KEYS = ['enabled', 'smartMode', 'domainWhitelist', 'domainBlacklist', 'customAiHosts'];

// FIX #4: Simple async mutex to serialize registrar.sync() calls.
let syncMutex = Promise.resolve();
let configCache = null;
let broadcastTimer = null;
let pendingBroadcast = {};

function serializedSync(config) {
  syncMutex = syncMutex.then(() => FTM.registrar.sync(config)).catch(() => {});
  return syncMutex;
}

async function seedConfig(reason) {
  const stored = reason === 'install' ? {} : await chrome.storage.local.get(null);
  configCache = FTM.configUtils.defaults(stored);
  try {
    await chrome.storage.local.set(configCache);
  } catch (err) {
    console.error('[FTM Studio] Config initialization failed:', err?.name || 'UnknownError');
    throw err;
  }
}

// FIX #3: Return the Promise chain so the service worker stays alive.
chrome.runtime.onInstalled.addListener((details) => {
  return seedConfig(details.reason).then(() => serializedSync(configCache));
});

chrome.runtime.onStartup.addListener(() => serializedSync());

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== FTM.PORT.CONTENT || (FTM.messages && !FTM.messages.isTrustedPort(port))) return;
  new FTM.Bridge(port).start();
});

function relevantChanges(changes) {
  const updated = {};
  for (const [key, change] of Object.entries(changes)) {
    if (key === 'conversionHistory' || change.newValue === undefined) continue;
    updated[key] = change.newValue;
  }
  return updated;
}

// FIX #6: Build config from the relevant changes instead of re-reading storage.
async function broadcast(updated) {
  configCache = FTM.configUtils.defaults(FTM.configUtils.merge(configCache || {}, updated));
  const config = configCache;
  const patterns = FTM.registrar.matches(config);
  const query = patterns.includes('<all_urls>') ? {} : { url: patterns.slice(0, FTM.CONSTANTS.MAX_MATCH_PATTERNS) };
  let tabs;
  try { tabs = await chrome.tabs.query(query); } catch (_) { tabs = []; }
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: FTM.MSG.CONFIG_UPDATE, config: updated }).catch(() => {});
  }
}

function queueBroadcast(updated) {
  Object.assign(pendingBroadcast, updated);
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    const patch = pendingBroadcast;
    pendingBroadcast = {};
    broadcastTimer = null;
    broadcast(patch);
  }, 0);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const updated = relevantChanges(changes);
  if (Object.keys(updated).length === 0) return;
  queueBroadcast(updated);
  if (REGISTRATION_KEYS.some((key) => key in updated)) {
    configCache = FTM.configUtils.defaults(FTM.configUtils.merge(configCache || {}, updated));
    serializedSync(configCache);
  }
});

// ── Toolbar badge: green dot when ON, gray when OFF ────────────────
function updateBadge(enabled) {
  try {
    chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: enabled ? '#22c55e' : '#9ca3af' });
    chrome.action.setTitle({ title: enabled ? 'FTM Studio — Active' : 'FTM Studio — Disabled' });
  } catch (_) { /* action API may not be available */ }
}

// Update badge on startup and config changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('enabled' in changes)) return;
  updateBadge(changes.enabled.newValue !== false);
});

// Set initial badge on install/startup.
chrome.storage.local.get('enabled', (result) => {
  if (chrome.runtime.lastError) {
    updateBadge(true);
    return;
  }
  updateBadge(result.enabled !== false);
});
