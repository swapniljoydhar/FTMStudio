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

  pendingConversions++;

  try {
    const ext = FTM.getExtension(file.name).toLowerCase();
    if (file.size > FTM.CONSTANTS.MAX_FILE_SIZE_BYTES) {
      throw new Error('File too large: ' + FTM.formatBytes(file.size) + '. Max 50MB.');
    }

    // Ensure offscreen exists
    await new Promise((res, rej) => {
      chrome.runtime.sendMessage({ type: 'CREATE_OFFSCREEN' }, (r) => {
        if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
        else res(r);
      });
    });

    const arrayBuffer = await file.arrayBuffer();
    port = chrome.runtime.connect({ name: 'ftm' });

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { port.disconnect(); } catch (_) {}
          FTM.decrementPending();
          reject(new Error('Offscreen processing timed out (60s)'));
        }
      }, FTM.CONSTANTS.CONVERSION_TIMEOUT_MS);

      port.onMessage.addListener(function onMsg(msg) {
        if (settled) return;
        if (msg.type === 'PROCESS_RESULT' || msg.type === 'ERROR') {
          settled = true;
          clearTimeout(timer);
          try { port.disconnect(); } catch (_) {}
          FTM.decrementPending();
          if (msg.type === 'ERROR' || (msg.data && msg.data.error)) {
            reject(new Error(msg.data ? msg.data.error : 'Unknown offscreen error'));
          } else {
            resolve(msg.data.markdown || '');
          }
        }
      });

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
