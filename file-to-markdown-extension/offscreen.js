// ===========================================================================
// offscreen.js — Ephemeral Binary File Parser (v7)
// ===========================================================================
//
// EXECUTES INSIDE THE OFFSCREEN DOCUMENT.
//
// Supported formats:
//   - .docx   (mammoth.js → HTML → Turndown.js + GFM → Markdown)
//   - .xlsx/.xls (SheetJS xlsx.mini → sheets → Markdown tables)
//   - .epub   (JSZip → container.xml → XHTML → Turndown.js + GFM → Markdown)
//   - .pptx   (JSZip → slide XML → Markdown)
//   - .pdf    (PDF.js → text extraction → structured Markdown)
//
// V7 CHANGES:
//   - SRI hashes REMOVED (incompatible with chrome-extension:// scheme)
//   - Turndown plugin-gfm added for proper GFM table/strikethrough support
//   - Mammoth image stripping (no base64 bloat)
//   - Graceful degradation when parsers fail
//   - Aggressive cleanup on port disconnect AND message
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

  // ---------------------------------------------------------------------------
  // 1. DYNAMIC SCRIPT LOADING
  // V7 FIX: No SRI hashes — chrome-extension:// doesn't support crossOrigin
  // ---------------------------------------------------------------------------

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (document.querySelector('script[src$="' + src + '"]')) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(src);

      let timeoutId = null;

      script.onload = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      };

      script.onerror = () => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(new Error('Library load failed: ' + src));
      };

      timeoutId = setTimeout(() => {
        reject(new Error('Load timeout: ' + src));
      }, 15000);

      document.head.appendChild(script);
    });
  }

  // ---------------------------------------------------------------------------
  // 2. TURNDOWN SETUP (with GFM plugin)
  // ---------------------------------------------------------------------------
  function createTurndown() {
    if (!Turndown) {
      throw new Error('Turndown.js not loaded');
    }

    const converter = new Turndown({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**',
      bulletListMarker: '-',
      preformattedCode: true
    });

    // V7: Official GFM plugin for tables + strikethrough + task lists
    if (turndownPluginGfm && converter.use) {
      converter.use(turndownPluginGfm.gfm);
    }

    // Strip images (Mammoth converts to base64 — too bloated)
    converter.addRule('noImages', {
      filter: ['img'],
      replacement: function() { return '\n![Image omitted]\n'; }
    });

    return converter;
  }

  // ---------------------------------------------------------------------------
  // 3. DOCX PROCESSING (mammoth.js → HTML → Turndown → Markdown)
  // ---------------------------------------------------------------------------
  async function processDocx(arrayBuffer, fileName) {
    if (!mammoth) await loadMammoth();

    // Mammoth image stripping — empty src to prevent base64 bloat
    const options = {
      convertImage: mammoth.images.imgElement(function(image) {
        return image.read('base64').then(function() {
          return { src: '', alt: '[Image]' };
        });
      })
    };

    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer }, options);
    const html = result.value || '';

    // Strip any remaining img tags (defense in depth)
    const cleanHtml = html.replace(/<img\s+[^>]*>/gi, '');

    const turndown = createTurndown();
    let markdown = turndown.turndown(cleanHtml);

    // Remove any image markdown references
    markdown = markdown.replace(/!\[.*?\]\(.*?\)/g, '');
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

    return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n' + markdown;
  }

  // ---------------------------------------------------------------------------
  // 4. EPUB PROCESSING (JSZip → container.xml → XHTML → Turndown)
  // ---------------------------------------------------------------------------

  async function processEpub(arrayBuffer, fileName) {
    if (!JSZip) await loadJSZip();

    const title = fileName.replace(/\.[^.]+$/, '');
    let markdown = '# ' + title + '\n\n';

    try {
      const zip = await JSZip.loadAsync(arrayBuffer);

      // Find OPF via container.xml
      let opfPath = null;
      const containerFile = zip.file('META-INF/container.xml');
      if (containerFile) {
        const containerXml = await containerFile.async('text');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'application/xml');
        const rootfiles = containerDoc.querySelectorAll('rootfile');
        if (rootfiles.length > 0) {
          const fullPath = rootfiles[0].getAttribute('full-path');
          if (fullPath) opfPath = fullPath;
        }
      }

      const contentFiles = [];
      let contentOrder = 0;

      if (opfPath) {
        const opfFile = zip.file(opfPath);
        if (opfFile) {
          const opfXml = await opfFile.async('text');
          const parser = new DOMParser();
          const opfDoc = parser.parseFromString(opfXml, 'application/xml');
          const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

          const manifestItems = {};
          opfDoc.querySelectorAll('manifest item').forEach(item => {
            manifestItems[item.getAttribute('id')] = item.getAttribute('href');
          });

          opfDoc.querySelectorAll('spine itemref').forEach(itemRef => {
            const idref = itemRef.getAttribute('idref');
            if (idref && manifestItems[idref]) {
              contentFiles.push({ path: opfDir + manifestItems[idref], content: null, order: contentOrder++ });
            }
          });

          for (const cf of contentFiles) {
            const zipFile = zip.file(cf.path);
            if (zipFile) cf.content = await zipFile.async('text');
          }
        }
      }

      // Fallback: scan for HTML/XHTML files
      if (contentFiles.length === 0) {
        zip.forEach((relativePath, zipEntry) => {
          if ((relativePath.endsWith('.xhtml') || relativePath.endsWith('.html') || relativePath.endsWith('.htm')) &&
              !relativePath.startsWith('META-INF') && !relativePath.includes('toc') &&
              !relativePath.includes('nav') && !relativePath.includes('.opf') && !relativePath.includes('.ncx')) {
            contentFiles.push({ path: relativePath, content: null, order: contentOrder++ });
          }
        });
        contentFiles.sort((a, b) => a.path.localeCompare(b.path));
        for (const cf of contentFiles) {
          const zipFile = zip.file(cf.path);
          if (zipFile) cf.content = await zipFile.async('text');
        }
      }

      const turndown = createTurndown();
      for (const cf of contentFiles) {
        if (!cf.content) continue;
        const parser = new DOMParser();
        const doc = parser.parseFromString(cf.content, 'application/xhtml+xml');
        const body = doc.body || doc.documentElement;
        if (!body) continue;

        const chapterName = cf.path.replace(/\.[^.]+$/, '').replace(/^[^\/]+\//, '')
          .replace(/_/g, ' ').replace(/-/g, ' ').replace(/chapter\s*/i, 'Chapter ');
        if (chapterName && contentFiles.length > 1) {
          markdown += '\n## ' + chapterName + '\n\n';
        }

        let chapterText = turndown.turndown(body.innerHTML || body.textContent || '');
        chapterText = chapterText.replace(/\n{3,}/g, '\n\n').trim();
        if (chapterText) markdown += chapterText + '\n\n';
      }

    } catch (err) {
      console.error('[FTM] EPUB extraction error:', err);
      return '# ' + title + '\n\n[Failed to extract EPUB content: ' + (err.message || 'unknown error') + ']\n';
    }

    return markdown;
  }

  // ---------------------------------------------------------------------------
  // 5. SPREADSHEET PROCESSING (xlsx.mini.min.js — read-only)
  // ---------------------------------------------------------------------------

  async function processSpreadsheet(arrayBuffer, fileName) {
    if (!XLSX) await loadXLSX();

    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let markdown = '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n';

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', blankrows: false });

      if (!jsonData || jsonData.length === 0) continue;
      if (workbook.SheetNames.length > 1) markdown += '## ' + sheetName + '\n\n';

      let headerIdx = 0;
      for (let i = 0; i < jsonData.length; i++) {
        if (jsonData[i] && jsonData[i].some(c => c !== '' && c !== null && c !== undefined)) {
          headerIdx = i;
          break;
        }
      }

      const headers = jsonData[headerIdx];
      if (!headers || headers.length === 0) continue;

      const headerCells = headers.map(h => String(h !== null && h !== undefined ? h : '').replace(/\|/g, '\\|'));
      markdown += '| ' + headerCells.join(' | ') + ' |\n';
      markdown += '| ' + headerCells.map(() => '---').join(' | ') + ' |\n';

      for (let i = headerIdx + 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row) continue;
        while (row.length < headers.length) row.push('');
        const cells = headers.map((_, colIdx) => {
          const val = row[colIdx];
          return String(val !== undefined && val !== null ? val : '').replace(/\|/g, '\\|');
        });
        markdown += '| ' + cells.join(' | ') + ' |\n';
      }
      markdown += '\n';
    }

    // Null workbook reference
    for (const key of Object.keys(workbook)) {
      try { workbook[key] = null; } catch (_) {}
    }

    return markdown;
  }

  // ---------------------------------------------------------------------------
  // 6. PDF PROCESSING (PDF.js → text extraction → Markdown)
  // ---------------------------------------------------------------------------

  async function processPdf(arrayBuffer, fileName) {
    if (!pdfjsLib) await loadPdfJs();

    // Set worker source using web_accessible_resources
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

    // Validate ArrayBuffer
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('The PDF file is empty.');
    }

    const typedArray = new Uint8Array(arrayBuffer);

    let pdf;
    try {
      const loadingTask = pdfjsLib.getDocument({ data: typedArray });
      pdf = await loadingTask.promise;
    } catch (err) {
      throw new Error('Failed to load PDF: ' + (err.message || 'Unknown error'));
    }

    const numPages = pdf.numPages;
    let markdown = '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n';
    markdown += '*' + numPages + ' page' + (numPages !== 1 ? 's' : '') + ' extracted*\n\n';

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (numPages > 1) {
        markdown += '\n---\n\n';
        markdown += '**Page ' + pageNum + '**\n\n';
      }

      let page;
      let textContent;
      try {
        page = await pdf.getPage(pageNum);
        textContent = await page.getTextContent();
      } catch (err) {
        console.warn('[FTM] PDF page ' + pageNum + ' extraction error:', err.message);
        markdown += '*[Page ' + pageNum + ' could not be extracted]*\n\n';
        continue;
      }

      // Sort text items top-to-bottom (Y desc), left-to-right (X asc)
      const items = textContent.items
        .filter(item => item && item.str && item.str.trim())
        .map(item => {
          const tr = Array.isArray(item.transform) && item.transform.length >= 6
            ? item.transform
            : [1, 0, 0, 1, 0, 0];
          return {
            str: item.str,
            x: tr[4],
            y: Math.round(tr[5])
          };
        });

      items.sort((a, b) => {
        if (Math.abs(a.y - b.y) > 3) return b.y - a.y;
        return a.x - b.x;
      });

      // Group into lines
      const lines = [];
      let currentY = null;
      let currentLine = '';

      for (const item of items) {
        if (currentY !== null && Math.abs(item.y - currentY) > 3) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = '';
        }
        currentLine += (currentLine && !currentLine.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str;
        currentY = item.y;
      }
      if (currentLine.trim()) lines.push(currentLine.trim());

      // Build markdown with heading detection
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // Detect headings: short lines followed by body text
        if (line.length < 70 && !line.endsWith('.') && !line.endsWith(',') &&
            i + 1 < lines.length && lines[i + 1].length > 40) {
          markdown += '## ' + line + '\n\n';
        }
        // ALL-CAPS short lines as subheadings
        else if (line.length < 50 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
          markdown += '### ' + line + '\n\n';
        }
        else {
          markdown += line + '\n\n';
        }
      }

      markdown = markdown.replace(/\n{3,}/g, '\n\n');

      // Yield to event loop every 5 pages
      if (pageNum % 5 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    return markdown.trim();
  }

  // ---------------------------------------------------------------------------
  // 7. PPTX PROCESSING (JSZip → slide XML → Markdown)
  // ---------------------------------------------------------------------------

  async function processPptx(arrayBuffer, fileName) {
    if (!JSZip) await loadJSZip();

    const title = fileName.replace(/\.[^.]+$/, '');
    let markdown = '# ' + title + '\n\n';

    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const parser = new DOMParser();

      // Parse presentation.xml to get slide list
      const presFile = zip.file('ppt/presentation.xml');
      if (!presFile) {
        throw new Error('Invalid PPTX: missing presentation.xml');
      }

      const presXml = await presFile.async('text');
      const presDoc = parser.parseFromString(presXml, 'application/xml');

      // Get slide references
      const slideRefs = presDoc.querySelectorAll('p\\:sldIdLst sldId, sldId');
      const slideFiles = [];

      for (const sldRef of slideRefs) {
        const rId = sldRef.getAttribute('r:id');
        if (!rId) continue;

        const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
        if (!relsFile) continue;

        const relsXml = await relsFile.async('text');
        const relsDoc = parser.parseFromString(relsXml, 'application/xml');
        const rels = relsDoc.querySelectorAll('Relationship');
        let targetPath = null;
        for (const rel of rels) {
          if (rel.getAttribute('Id') === rId) {
            targetPath = rel.getAttribute('Target');
            break;
          }
        }

        if (targetPath) {
          const fullPath = targetPath.startsWith('/') ? targetPath.substring(1) : 'ppt/' + targetPath;
          slideFiles.push(fullPath);
        }
      }

      // Fallback: scan directly
      if (slideFiles.length === 0) {
        zip.forEach((relativePath) => {
          if (relativePath.match(/^ppt\/slides\/slide\d+\.xml$/)) {
            slideFiles.push(relativePath);
          }
        });
        slideFiles.sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)/)[1], 10);
          const numB = parseInt(b.match(/slide(\d+)/)[1], 10);
          return numA - numB;
        });
      }

      for (let i = 0; i < slideFiles.length; i++) {
        const slideFile = zip.file(slideFiles[i]);
        if (!slideFile) continue;

        const slideXml = await slideFile.async('text');
        const slideDoc = parser.parseFromString(slideXml, 'application/xml');

        const textElements = slideDoc.querySelectorAll('a\\:t, t');
        const texts = [];
        for (const elem of textElements) {
          const text = elem.textContent.trim();
          if (text) texts.push(text);
        }

        if (texts.length === 0) continue;

        markdown += '## Slide ' + (i + 1) + '\n\n';

        // First text is usually the title
        if (texts.length > 0) {
          markdown += '**' + texts[0] + '**\n\n';
        }

        // Remaining texts as bullet points
        if (texts.length > 1) {
          for (let j = 1; j < texts.length; j++) {
            markdown += '- ' + texts[j] + '\n';
          }
          markdown += '\n';
        }
      }

    } catch (err) {
      console.error('[FTM] PPTX extraction error:', err);
      return '# ' + title + '\n\n[Failed to extract PPTX content: ' + (err.message || 'unknown error') + ']\n';
    }

    return markdown;
  }

  // ===========================================================================
  // LIBRARY LOADING (Lazy, ON DEMAND)
  // ===========================================================================

  async function loadMammoth() {
    if (mammoth) return;
    await loadScript('lib/mammoth.browser.min.js');
    mammoth = window.mammoth;
  }

  async function loadXLSX() {
    if (XLSX) return;
    await loadScript('lib/xlsx.mini.min.js');
    XLSX = window.XLSX;
  }

  async function loadJSZip() {
    if (JSZip) return;
    await loadScript('lib/jszip.min.js');
    JSZip = window.JSZip;
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

  async function loadPdfJs() {
    if (pdfjsLib) return;
    await loadScript('lib/pdf.min.js');
    pdfjsLib = window.pdfjsLib;
  }

  // ===========================================================================
  // PORT MESSAGE HANDLER
  // ===========================================================================

  let port = null;

  chrome.runtime.onConnect.addListener((p) => {
    if (p.name !== 'ftm-offscreen-internal') return;
    port = p;

    port.onMessage.addListener((message) => {
      if (message.type === 'PROCESS_BINARY_FILE') {
        handleProcessRequest(message.data).then((result) => {
          port.postMessage({ type: 'PROCESS_RESULT', data: result });
        }).catch((err) => {
          port.postMessage({ type: 'ERROR', data: { error: err.message || String(err) } });
        });
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      performAggressiveCleanup();
    });
  });

  // ===========================================================================
  // PROCESS REQUEST DISPATCHER
  // ===========================================================================

  async function handleProcessRequest(data) {
    const { fileName, extension, arrayBuffer } = data;

    // Always ensure Turndown + GFM are loaded (needed for DOCX, EPUB)
    await loadTurndown();
    await loadTurndownGfm();

    switch (extension) {
      case '.docx':
        return { markdown: await processDocx(arrayBuffer, fileName), fileName };

      case '.xlsx':
      case '.xls':
        return { markdown: await processSpreadsheet(arrayBuffer, fileName), fileName };

      case '.epub':
        return { markdown: await processEpub(arrayBuffer, fileName), fileName };

      case '.pptx':
        return { markdown: await processPptx(arrayBuffer, fileName), fileName };

      case '.pdf':
        return { markdown: await processPdf(arrayBuffer, fileName), fileName };

      default:
        throw new Error('Unsupported binary format: ' + extension);
    }
  }

  // ===========================================================================
  // AGGRESSIVE MEMORY CLEANUP
  // ===========================================================================

  function performAggressiveCleanup() {
    // Step 1: Nullify ALL global library references
    if (typeof window !== 'undefined') {
      window.mammoth = null;
      window.XLSX = null;
      window.JSZip = null;
      window.TurndownService = null;
      window.pdfjsLib = null;
      window.turndownPluginGfm = null;
    }

    // Step 2: Null module-scoped references
    mammoth = null;
    XLSX = null;
    JSZip = null;
    Turndown = null;
    pdfjsLib = null;
    turndownPluginGfm = null;

    // Step 3: Remove ALL dynamically loaded script tags
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach(s => {
      s.onload = null;
      s.onerror = null;
      s.src = '';
      if (s.parentNode) s.parentNode.removeChild(s);
    });

    // Step 4: Clear DOM content
    if (document.body) {
      document.body.innerHTML = '';
    }

    // Step 5: Break port reference
    port = null;

    // Step 6: Signal completion to background
    try {
      chrome.runtime.sendMessage({ type: 'CLOSE_OFFSCREEN_DONE' });
    } catch (_) {}
  }

  // Cleanup on unload as safety net
  window.addEventListener('beforeunload', performAggressiveCleanup);
  window.addEventListener('pagehide', performAggressiveCleanup);

  // Also handle explicit close message
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CLOSE_OFFSCREEN') {
      performAggressiveCleanup();
    }
  });

})();

console.log('[FTM] Offscreen document initialized (v7.0.0)');
