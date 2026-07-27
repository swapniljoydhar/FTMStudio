// ===========================================================================
// offscreen.js — Ephemeral Binary File Parser (v3.0)
// ===========================================================================
// Runs inside the offscreen document. Loads parser libraries on demand,
// converts binary files to Markdown, aggressively cleans up after use.
// ===========================================================================

(() => {
  'use strict';

  // Library references (null until loaded)
  let mammoth = null;
  let XLSX = null;
  let JSZip = null;
  let Turndown = null;
  let pdfjsLib = null;
  let turndownPluginGfm = null;
  let port = null;

  // ---------------------------------------------------------------------------
  // 1. DYNAMIC SCRIPT LOADING
  // ---------------------------------------------------------------------------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(src);
      let timeout = null;
      script.onload = () => { if (timeout) clearTimeout(timeout); resolve(); };
      script.onerror = () => { if (timeout) clearTimeout(timeout); reject(new Error('Load failed: ' + src)); };
      timeout = setTimeout(() => reject(new Error('Load timeout: ' + src)), 15000);
      document.head.appendChild(script);
    });
  }

  async function loadTurndown() {
    if (Turndown) return;
    await loadScript('lib/turndown.min.js');
    Turndown = window.TurndownService;
  }

  async function loadTurndownGfm() {
    if (turndownPluginGfm) return;
    await loadScript('lib/turndown-plugin-gfm.min.js');
    turndownPluginGfm = window.turndownPluginGfm;
  }

  async function loadMammoth() {
    if (mammoth) return;
    await loadScript('lib/mammoth.browser.min.js');
    mammoth = window.mammoth;
  }

  async function loadJSZip() {
    if (JSZip) return;
    await loadScript('lib/jszip.min.js');
    JSZip = window.JSZip;
  }

  async function loadXLSX() {
    if (XLSX) return;
    await loadScript('lib/xlsx.mini.min.js');
    XLSX = window.XLSX;
  }

  async function loadPdfJs() {
    if (pdfjsLib) return;
    await loadScript('lib/pdf.min.js');
    pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  }

  // ---------------------------------------------------------------------------
  // 2. TURNDOWN SETUP (with GFM plugin)
  // ---------------------------------------------------------------------------
  function createTurndown() {
    if (!Turndown) throw new Error('Turndown.js not loaded');
    const converter = new Turndown({
      headingStyle: 'atx', codeBlockStyle: 'fenced', fence: '```',
      emDelimiter: '*', strongDelimiter: '**', bulletListMarker: '-',
      preformattedCode: true
    });
    if (turndownPluginGfm) converter.use(turndownPluginGfm.gfm);
    converter.addRule('noImages', {
      filter: ['img'],
      replacement: () => '\n![Image omitted]\n'
    });
    return converter;
  }

  // ---------------------------------------------------------------------------
  // 3. CSV SANITIZER
  // ---------------------------------------------------------------------------
  function sanitizeCell(v) {
    const s = String(v != null ? v : '');
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return safe.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  // ---------------------------------------------------------------------------
  // 4. DOCX PROCESSING
  // ---------------------------------------------------------------------------
  async function processDocx(arrayBuffer, fileName) {
    await loadMammoth();
    const result = await mammoth.convertToHtml({ arrayBuffer }, {
      convertImage: mammoth.images.imgElement((img) => img.read('base64').then(() => ({ src: '', alt: '[Image]' })))
    });
    const cleanHtml = (result.value || '').replace(/<img\s+[^>]*alt="([^"]*)"[^>]*>/gi, '$1');
    const turndown = createTurndown();
    const markdown = turndown.turndown(cleanHtml).replace(/\n{3,}/g, '\n\n').trim();
    return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n' + markdown;
  }

  // ---------------------------------------------------------------------------
  // 5. EPUB PROCESSING
  // ---------------------------------------------------------------------------
  async function processEpub(arrayBuffer, fileName) {
    await loadJSZip();
    const title = fileName.replace(/\.[^.]+$/, '');
    const parts = ['# ' + title + '\n\n'];
    const parser = new DOMParser();
    const turndown = createTurndown();

    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const contentFiles = [];

      const containerFile = zip.file('META-INF/container.xml');
      if (containerFile) {
        const containerXml = await containerFile.async('text');
        const containerDoc = parser.parseFromString(containerXml, 'application/xml');
        const rootfile = containerDoc.querySelector('rootfile');
        if (rootfile) {
          const opfPath = rootfile.getAttribute('full-path');
          if (opfPath) {
            const opfFile = zip.file(opfPath);
            if (opfFile) {
              const opfXml = await opfFile.async('text');
              const opfDoc = parser.parseFromString(opfXml, 'application/xml');
              const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
              const manifest = {};
              opfDoc.querySelectorAll('manifest item').forEach(item => { manifest[item.getAttribute('id')] = item.getAttribute('href'); });
              let order = 0;
              opfDoc.querySelectorAll('spine itemref').forEach(ref => {
                const href = manifest[ref.getAttribute('idref')];
                if (href) contentFiles.push({ path: opfDir + href, order: order++ });
              });
            }
          }
        }
      }

      if (contentFiles.length === 0) {
        zip.forEach((relPath) => {
          if ((relPath.endsWith('.xhtml') || relPath.endsWith('.html')) && !relPath.startsWith('META-INF') && !relPath.includes('toc') && !relPath.includes('nav')) {
            contentFiles.push({ path: relPath, order: contentFiles.length });
          }
        });
        contentFiles.sort((a, b) => a.path.localeCompare(b.path));
      }

      for (const cf of contentFiles) {
        const zipFile = zip.file(cf.path);
        if (!zipFile) continue;
        const content = await zipFile.async('text');
        const doc = parser.parseFromString(content, 'application/xhtml+xml');
        if (doc.querySelector('parsererror')) continue;
        const body = doc.body || doc.documentElement;
        if (!body) continue;

        const chapterName = cf.path.replace(/\.[^.]+$/, '').replace(/^[^\/]+\//, '').replace(/_/g, ' ').replace(/-/g, ' ');
        if (chapterName && contentFiles.length > 1) parts.push('\n## ' + chapterName + '\n\n');

        const chapterText = turndown.turndown(body.innerHTML || body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
        if (chapterText) parts.push(chapterText + '\n\n');
      }
    } catch (err) {
      return '# ' + title + '\n\n[Failed to extract EPUB: ' + err.message + ']\n';
    }
    return parts.join('');
  }

  // ---------------------------------------------------------------------------
  // 6. SPREADSHEET PROCESSING
  // ---------------------------------------------------------------------------
  async function processSpreadsheet(arrayBuffer, fileName) {
    await loadXLSX();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const parts = ['# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n'];

    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
      if (!data || data.length === 0) continue;
      if (workbook.SheetNames.length > 1) parts.push('## ' + sheetName + '\n\n');

      let headerIdx = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] && data[i].some(c => c !== '' && c != null)) { headerIdx = i; break; }
      }

      const headers = data[headerIdx];
      if (!headers || headers.length === 0) continue;

      const hCells = headers.map(sanitizeCell);
      parts.push('| ' + hCells.join(' | ') + ' |\n');
      parts.push('| ' + hCells.map(() => '---').join(' | ') + ' |\n');

      for (let i = headerIdx + 1; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;
        while (row.length < headers.length) row.push('');
        parts.push('| ' + headers.map((_, ci) => sanitizeCell(row[ci])).join(' | ') + ' |\n');
      }
      parts.push('\n');
    }

    for (const key of Object.keys(workbook)) { try { workbook[key] = null; } catch (_) {} }
    return parts.join('');
  }

  // ---------------------------------------------------------------------------
  // 7. PDF PROCESSING
  // ---------------------------------------------------------------------------
  async function processPdf(arrayBuffer, fileName) {
    await loadPdfJs();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('PDF file is empty.');

    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const parts = ['# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n'];
    parts.push('*' + pdf.numPages + ' page' + (pdf.numPages !== 1 ? 's' : '') + ' extracted*\n\n');

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (pdf.numPages > 1) { parts.push('\n---\n\n**Page ' + pageNum + '**\n\n'); }
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const items = textContent.items
          .filter(item => item && item.str && item.str.trim())
          .map(item => {
            const tr = Array.isArray(item.transform) && item.transform.length >= 6 ? item.transform : [1, 0, 0, 1, 0, 0];
            return { str: item.str, x: tr[4], y: Math.round(tr[5]) };
          });
        items.sort((a, b) => Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x);

        const lines = [];
        let curY = null, curLine = '';
        for (const item of items) {
          if (curY !== null && Math.abs(item.y - curY) > 3) {
            if (curLine.trim()) lines.push(curLine.trim());
            curLine = '';
          }
          curLine += (curLine && !curLine.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str;
          curY = item.y;
        }
        if (curLine.trim()) lines.push(curLine.trim());

        for (const line of lines) {
          const isAllCaps = line.length >= 3 && line.length <= 50 && line === line.toUpperCase() && /[A-Z]{3,}/.test(line) && !/^\d+$/.test(line) && !line.endsWith('.') && !line.endsWith(',');
          parts.push(isAllCaps ? '## ' + line + '\n\n' : line + '\n\n');
        }
      } catch (err) {
        parts.push('*[Page ' + pageNum + ' could not be extracted]*\n\n');
      }
      if (pageNum % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------------------------------------------------------------------------
  // 8. PPTX PROCESSING
  // ---------------------------------------------------------------------------
  async function processPptx(arrayBuffer, fileName) {
    await loadJSZip();
    const title = fileName.replace(/\.[^.]+$/, '');
    const parts = ['# ' + title + '\n\n'];
    const parser = new DOMParser();

    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const presFile = zip.file('ppt/presentation.xml');
      if (!presFile) throw new Error('Invalid PPTX: missing presentation.xml');

      const presDoc = parser.parseFromString(await presFile.async('text'), 'application/xml');
      const relsMap = new Map();
      const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
      if (relsFile) {
        const relsDoc = parser.parseFromString(await relsFile.async('text'), 'application/xml');
        relsDoc.querySelectorAll('Relationship').forEach(rel => { relsMap.set(rel.getAttribute('Id'), rel.getAttribute('Target')); });
      }

      const slideFiles = [];
      presDoc.querySelectorAll('sldId').forEach(sldRef => {
        const rId = sldRef.getAttribute('r:id');
        if (rId && relsMap.has(rId)) {
          const target = relsMap.get(rId);
          slideFiles.push(target.startsWith('/') ? target.substring(1) : 'ppt/' + target);
        }
      });

      if (slideFiles.length === 0) {
        zip.forEach((relPath) => { if (relPath.match(/^ppt\/slides\/slide\d+\.xml$/)) slideFiles.push(relPath); });
        slideFiles.sort((a, b) => parseInt(a.match(/slide(\d+)/)[1]) - parseInt(b.match(/slide(\d+)/)[1]));
      }

      for (let i = 0; i < slideFiles.length; i++) {
        const slideFile = zip.file(slideFiles[i]);
        if (!slideFile) continue;
        const slideDoc = parser.parseFromString(await slideFile.async('text'), 'application/xml');
        const texts = [];
        slideDoc.querySelectorAll('t').forEach(el => { const t = el.textContent.trim(); if (t) texts.push(t); });
        if (texts.length === 0) continue;
        parts.push('## Slide ' + (i + 1) + '\n\n');
        parts.push('**' + texts[0] + '**\n\n');
        for (let j = 1; j < texts.length; j++) parts.push('- ' + texts[j] + '\n');
        parts.push('\n');
      }
    } catch (err) {
      return '# ' + title + '\n\n[Failed to extract PPTX: ' + err.message + ']\n';
    }
    return parts.join('');
  }

  // ---------------------------------------------------------------------------
  // 9. RTF PROCESSING
  // ---------------------------------------------------------------------------
  async function processRtf(file, fileName) {
    const reader = new FileReader();
    const text = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read RTF'));
      reader.readAsText(file, 'UTF-8');
    });

    const cleaned = text
      .replace(/\\obj(?=.*?})[\s\S]*?}/g, '')
      .replace(/\\pict[\s\S]*?}/g, '')
      .replace(/\\bin[\s\S]*?}/g, '')
      .replace(/\\u(-?\d+)\??/g, (_, code) => { const n = parseInt(code, 10); return n >= 0 && n <= 65535 ? String.fromCharCode(n) : '?'; })
      .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\par\s*/g, '\n')
      .replace(/\\line\s*/g, '\n')
      .replace(/\\tab\s*/g, '\t')
      .replace(/\\[a-z]+\s?-?\d+;?/g, '')
      .replace(/\\[a-z]+\s?/g, '')
      .replace(/[{}]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n' + cleaned;
  }

  // ---------------------------------------------------------------------------
  // 10. PROCESS REQUEST DISPATCHER
  // ---------------------------------------------------------------------------
  async function handleProcessRequest(data) {
    const { fileName, extension, arrayBuffer } = data;

    await loadTurndown();
    await loadTurndownGfm();

    switch (extension) {
      case '.docx': return { markdown: await processDocx(arrayBuffer, fileName), fileName };
      case '.xlsx':
      case '.xls':  return { markdown: await processSpreadsheet(arrayBuffer, fileName), fileName };
      case '.epub': return { markdown: await processEpub(arrayBuffer, fileName), fileName };
      case '.pptx': return { markdown: await processPptx(arrayBuffer, fileName), fileName };
      case '.pdf':  return { markdown: await processPdf(arrayBuffer, fileName), fileName };
      case '.rtf':  return { markdown: await processRtf(new Blob([arrayBuffer]), fileName), fileName };
      default: throw new Error('Unsupported binary format: ' + extension);
    }
  }

  // ---------------------------------------------------------------------------
  // 11. AGGRESSIVE CLEANUP
  // ---------------------------------------------------------------------------
  function performAggressiveCleanup() {
    if (typeof window !== 'undefined') {
      ['mammoth', 'XLSX', 'JSZip', 'TurndownService', 'pdfjsLib'].forEach(name => {
        try { window[name] = null; } catch (_) {}
      });
    }
    mammoth = null; XLSX = null; JSZip = null; Turndown = null; pdfjsLib = null; turndownPluginGfm = null;
    document.querySelectorAll('script[src]').forEach(s => { s.onload = null; s.onerror = null; s.src = ''; if (s.parentNode) s.parentNode.removeChild(s); });
    if (document.body) document.body.innerHTML = '';
    port = null;
  }

  // ---------------------------------------------------------------------------
  // 12. PORT MESSAGE HANDLER
  // ---------------------------------------------------------------------------
  chrome.runtime.onConnect.addListener((p) => {
    if (p.name !== 'ftm-offscreen-internal') return;

    // Reject if a port is already connected (prevents race condition)
    if (port) {
      try { p.disconnect(); } catch (_) {}
      return;
    }

    port = p;

    port.onMessage.addListener((message) => {
      if (message.type === 'PROCESS_BINARY_FILE') {
        const d = message.data;
        if (!d || !d.fileName || !d.extension || !d.arrayBuffer) {
          try { port.postMessage({ type: 'ERROR', data: { error: 'Invalid request: missing required fields' } }); } catch (_) {}
          return;
        }
        handleProcessRequest(d).then((result) => {
          try { port.postMessage({ type: 'PROCESS_RESULT', data: result }); } catch (_) {}
        }).catch((err) => {
          try { port.postMessage({ type: 'ERROR', data: { error: err.message || String(err) } }); } catch (_) {}
        });
      }
    });

    port.onDisconnect.addListener(() => { port = null; performAggressiveCleanup(); });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CLOSE_OFFSCREEN') performAggressiveCleanup();
  });

  window.addEventListener('beforeunload', performAggressiveCleanup);
  window.addEventListener('pagehide', performAggressiveCleanup);

})();
