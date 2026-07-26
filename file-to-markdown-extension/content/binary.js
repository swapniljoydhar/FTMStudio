// ===========================================================================
// content/binary.js — Binary file processing via offscreen document
// ===========================================================================

window.FTM = window.FTM || {};

let pendingConversions = 0;

FTM.decrementPending = function () {
  pendingConversions = Math.max(0, pendingConversions - 1);
  return pendingConversions <= 0;
};

FTM.processBinaryFile = async function (file) {
  let port = null;
  let settled = false;
  let pendingReject = null;
  let timer = null;

  pendingConversions++;

  try {
    const ext = FTM.getExtension(file.name).toLowerCase();
    if (file.size > FTM.CONSTANTS.MAX_FILE_SIZE_BYTES) {
      throw new Error('File too large: ' + FTM.formatBytes(file.size) + '. Max 50MB.');
    }
    if (file.size === 0) {
      throw new Error('File is empty: ' + file.name);
    }

    // Ensure offscreen exists
    await new Promise((res, rej) => {
      chrome.runtime.sendMessage({ type: 'CREATE_OFFSCREEN' }, (r) => {
        if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
        else res(r);
      });
    });

    let arrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch (readErr) {
      throw new Error('Failed to read file: ' + (readErr.message || 'File read error'));
    }

    if (arrayBuffer.byteLength === 0) {
      throw new Error('File read returned empty buffer: ' + file.name);
    }

    port = chrome.runtime.connect({ name: 'ftm' });

    return await new Promise((resolve, reject) => {
      pendingReject = reject;

      // Handle port disconnect before result arrives
      port.onDisconnect.addListener(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          pendingReject = null;
          FTM.decrementPending();
          reject(new Error('Port disconnected during conversion (service worker may have restarted)'));
        }
      });

      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          pendingReject = null;
          try { port.disconnect(); } catch (_) {}
          FTM.decrementPending();
          reject(new Error('Offscreen processing timed out (60s)'));
        }
      }, FTM.CONSTANTS.CONVERSION_TIMEOUT_MS);

      // CRITICAL FIX: Add message listener BEFORE postMessage to prevent race condition
      port.onMessage.addListener(function onMsg(msg) {
        if (settled) return;
        if (msg.type === 'PROCESS_RESULT' || msg.type === 'ERROR') {
          settled = true;
          clearTimeout(timer);
          pendingReject = null;
          try { port.disconnect(); } catch (_) {}
          FTM.decrementPending();
          if (msg.type === 'ERROR' || (msg.data && msg.data.error)) {
            reject(new Error(msg.data ? msg.data.error : 'Unknown offscreen error'));
          } else {
            resolve(msg.data.markdown || '');
          }
        }
      });

      // Now safe to send message after listener is established
      port.postMessage(
        { type: 'PROCESS_BINARY_FILE', data: { fileName: file.name, extension: ext, arrayBuffer } },
        [arrayBuffer]
      );
    });

  } catch (err) {
    if (!settled) {
      settled = true;
      if (port) try { port.disconnect(); } catch (_) {}
      FTM.decrementPending();
    }
    throw err;
  }
};
