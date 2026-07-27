// ===========================================================================
// content/binary.js — Binary file processing via offscreen document (v3.0)
// ===========================================================================

window.FTM = window.FTM || {};

let pendingConversions = 0;
let offscreenCloseTimer = null;
let offscreenWasOpened = false;

FTM.decrementPending = function () {
  pendingConversions = Math.max(0, pendingConversions - 1);
  if (pendingConversions <= 0 && offscreenWasOpened) {
    if (offscreenCloseTimer) clearTimeout(offscreenCloseTimer);
    offscreenCloseTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'CLOSE_OFFSCREEN' });
      offscreenCloseTimer = null;
      offscreenWasOpened = false;
    }, 30000);
  }
  return pendingConversions <= 0;
};

FTM.processBinaryFile = async function (file) {
  let port = null;
  let settled = false;
  let timer = null;

  pendingConversions++;
  if (offscreenCloseTimer) { clearTimeout(offscreenCloseTimer); offscreenCloseTimer = null; }

  try {
    const ext = FTM.getExtension(file.name).toLowerCase();
    if (file.size > FTM.CONSTANTS.MAX_FILE_SIZE_BYTES) throw new Error('File too large: ' + FTM.formatBytes(file.size) + '. Max 50MB.');
    if (file.size === 0) throw new Error('File is empty: ' + file.name);

    await new Promise((res, rej) => {
      chrome.runtime.sendMessage({ type: 'CREATE_OFFSCREEN' }, (r) => {
        if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
        else { offscreenWasOpened = true; res(r); }
      });
    });

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength === 0) throw new Error('Empty buffer: ' + file.name);

    port = chrome.runtime.connect({ name: 'ftm' });

    return await new Promise((resolve, reject) => {
      port.onDisconnect.addListener(() => {
        if (!settled) { settled = true; clearTimeout(timer); FTM.decrementPending(); reject(new Error('Port disconnected')); }
      });

      timer = setTimeout(() => {
        if (!settled) { settled = true; try { port.disconnect(); } catch (_) {} FTM.decrementPending(); reject(new Error('Timeout (60s)')); }
      }, FTM.CONSTANTS.CONVERSION_TIMEOUT_MS);

      port.onMessage.addListener(function onMsg(msg) {
        if (settled) return;
        if (msg.type === 'PROCESS_RESULT' || msg.type === 'ERROR') {
          settled = true; clearTimeout(timer); try { port.disconnect(); } catch (_) {} FTM.decrementPending();
          if (msg.type === 'ERROR' || (msg.data && msg.data.error)) reject(new Error(msg.data ? msg.data.error : 'Unknown error'));
          else resolve(msg.data.markdown || '');
        }
      });

      port.postMessage({ type: 'PROCESS_BINARY_FILE', data: { fileName: file.name, extension: ext, arrayBuffer } }, [arrayBuffer]);
    });
  } catch (err) {
    if (!settled) { settled = true; if (port) try { port.disconnect(); } catch (_) {} FTM.decrementPending(); }
    throw err;
  }
};
