// background.js — stateless MV3 service worker
// ===========================================================================
// The worker owns only durable configuration bootstrap and the badge. It does
// not keep jobs, files, parser state, ports, timers, tab lists, or registrations
// in memory. The manual converter runs in its own extension page and can be
// reopened after a browser restart without relying on worker state.

'use strict';

importScripts('shared/browser.js', 'shared/constants.js', 'shared/config.js');

const FTM = self.FTM;
const API = self.FTM_BROWSER.api;

async function ensureConfig() {
  if (!FTM_BROWSER.storage) return FTM.configUtils.defaults({});
  const stored = await FTM_BROWSER.storage.get(null);
  const config = FTM.configUtils.defaults(stored || {});
  const needsWrite = !stored || stored.enabled === undefined || stored.schemaVersion !== 4;
  if (needsWrite) await FTM_BROWSER.storage.set({ ...config, schemaVersion: 4 });
  return config;
}

async function updateBadge(enabled) {
  if (!API.action) return;
  try {
    await FTM_BROWSER.call(API.action.setBadgeText, API.action, [{ text: enabled ? '' : 'OFF' }]);
    await FTM_BROWSER.call(API.action.setBadgeBackgroundColor, API.action, [{ color: enabled ? '#22c55e' : '#98a2b3' }]);
    await FTM_BROWSER.call(API.action.setTitle, API.action, [{ title: enabled ? 'FTM Studio — ready' : 'FTM Studio — disabled' }]);
  } catch (_) { /* Badge APIs vary by browser and are non-essential. */ }
}

API.runtime.onInstalled.addListener((details) => ensureConfig().then((config) => updateBadge(config.enabled !== false)).catch(() => {}));
API.runtime.onStartup.addListener(() => ensureConfig().then((config) => updateBadge(config.enabled !== false)).catch(() => {}));

if (API.storage?.onChanged) {
  API.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) updateBadge(changes.enabled.newValue !== false);
  });
}

ensureConfig().then((config) => updateBadge(config.enabled !== false)).catch(() => {});
