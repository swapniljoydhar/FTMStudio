// ===========================================================================
// background.js — Service worker entry point
// ===========================================================================
// Responsibilities: offscreen lifecycle, port bridging, config fan-out and
// dynamic content-script registration. All logic lives in shared/ and sw/.
// ===========================================================================

'use strict';

importScripts(
  'shared/constants.js',
  'shared/text.js',
  'shared/config.js',
  'sw/offscreen-manager.js',
  'sw/bridge.js',
  'sw/registrar.js'
);

const FTM = self.FTM;

// Keys that change which pages must be instrumented.
const REGISTRATION_KEYS = ['enabled', 'smartMode', 'domainWhitelist', 'domainBlacklist', 'customAiHosts'];

async function seedConfig(reason) {
  const stored = reason === 'install' ? {} : await chrome.storage.local.get(null);
  await chrome.storage.local.set(FTM.configUtils.defaults(stored));
}

chrome.runtime.onInstalled.addListener((details) => {
  seedConfig(details.reason).then(() => FTM.registrar.sync());
});

chrome.runtime.onStartup.addListener(() => { FTM.registrar.sync(); });

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== FTM.PORT.CONTENT) return;
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

// Only instrumented tabs are messaged; the old code fanned out to every tab
// in the browser on every storage write.
async function targetTabs(config) {
  const patterns = FTM.registrar.matches(config);
  const query = patterns.includes('<all_urls>') ? {} : { url: patterns.slice(0, FTM.CONSTANTS.MAX_MATCH_PATTERNS) };
  try { return await chrome.tabs.query(query); } catch (_) { return []; }
}

async function broadcast(updated) {
  const config = FTM.configUtils.defaults(await chrome.storage.local.get(null));
  for (const tab of await targetTabs(config)) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: FTM.MSG.CONFIG_UPDATE, config: updated }).catch(() => {});
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const updated = relevantChanges(changes);
  if (Object.keys(updated).length === 0) return;
  broadcast(updated);
  if (REGISTRATION_KEYS.some((key) => key in updated)) FTM.registrar.sync();
});

chrome.runtime.onSuspend.addListener(() => { FTM.offscreen.close(); });
