// ===========================================================================
// offscreen.js — Ephemeral Binary File Parser (v2.0)
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
// CHANGES:
//   - Added PDF.js for PDF text extraction
//   - Added PPTX support via JSZip (reuse existing library)
//   - Simplified port: listens ONLY for 'ftm-offscreen-internal'
//   - Proper PDF.js worker path via web_accessible_resources
//   - All libraries lazy-loaded on demand, aggressively nulled on close
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

  // SRI Hashes for library integrity verification
  const SRI_HASHES = {
    'lib/mammoth.browser.min.js': 'sha256-WW71IjnlLY7jzuELLuSnJZar+QDQ5PRoWT+Vbp8YCbA=',
    'lib/xlsx.mini.min.js': 'sha256-MSCruh/Q6gMfJasirJPnJvb2NGfaGmNJuC6C899dd1w=',
    'lib/jszip.min.js': 'sha256-rMfkFFWoB2W1/Zx+4bgHim0WC7vKRVrq6FTeZclH1Z4=',
    'lib/turndown.min.js': 'sha256-/Q4qoHhcE8Ofod3As7GVIOVBtpgBwTaepKq/55E6Deo=',
    'lib/pdf.min.js': 'sha256-W1eZ5vjGgGYyB6xbQu4U7tKkBvp69I9QwVTwwLFWaUY=',
    'lib/pdf.worker.min.js': 'sha256-/qvfMJdw7SS7oxpUZ4Ns3Iz2OccFryfVK1hbBBu4Uns=',
    'lib/papaparse.min.js': 'sha256-uOhwxdKyl3LxDJ+pppPIuJaqyFQO1nAePMYwTGg/69s='
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(src);
      
      // Add Subresource Integrity hash if available
      const sriHash = SRI_HASHES[src];
      if (sriHash) {
        script.integrity = sriHash;
        script.crossOrigin = 'anonymous';
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

    // Table support rule — uses recursive turndown for cell formatting
    turndown.addRule('tables', {
      filter: 'table',
      replacement: function(content, node) {
        if (!content.trim()) return '';

        const rows = [];
        const trs = node.querySelectorAll('tr');
        for (const tr of trs) {
          const cells = [];
          const tds = tr.querySelectorAll('th, td');
          for (const td of tds) {
            // Use recursive turndown to preserve bold/italic/links in cells
            const cellHtml = td.innerHTML || td.textContent || '';
            cells.push(cellHtml.trim() ? turndown.turndown(cellHtml).trim() : '');
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length === 0) return '';

        const maxCols = Math.max(...rows.map(r => r.length));
        const normalized = rows.map(r => {
          while (r.length < maxCols) r.push('');
          return r.map(c => String(c).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' '));
        });

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

    // Strip img src attributes but keep alt text as placeholder
    const cleanHtml = html.replace(/<img\s+[^>]*alt="([^"]*)"[^>]*>/gi, '$1');

    const turndown = createTurndown();
    let markdown = turndown.turndown(cleanHtml);
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
        // Check for XML parse errors — parseFromString doesn't throw
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
          console.warn('[FTM] EPUB chapter XHTML parse error:', cf.path);
          continue;
        }
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

      const sanitizeCell = (v) => {
        const s = String(v !== null && v !== undefined ? v : '');
        const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
        return safe.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      };
      const headerCells = headers.map(sanitizeCell);
      markdown += '| ' + headerCells.join(' | ') + ' |\n';
      markdown += '| ' + headerCells.map(() => '---').join(' | ') + ' |\n';

      for (let i = headerIdx + 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row) continue;
        while (row.length < headers.length) row.push('');
        const cells = headers.map((_, colIdx) => sanitizeCell(row[colIdx]));
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

  // Worker path is set once in handleProcessRequest after library loads

  async function processPdf(arrayBuffer, fileName) {
    if (!pdfjsLib) await loadPdfJs();

    // Validate ArrayBuffer is not empty
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

      // PDF heading detection — conservative approach
      // PDF.js extracts raw text items. All structural information (font size,
      // bold, heading styles) is lost. We can only guess based on layout.
      // Strategy: only promote ALL-CAPS lines that look like section headers.
      // Do NOT try to detect title-cased headings — too many false positives.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        const isAllCaps = line.length >= 3 && line.length <= 50 &&
          line === line.toUpperCase() && /[A-Z]{3,}/.test(line) &&
          !/^\d+$/.test(line) && !line.endsWith('.') && !line.endsWith(',');

        if (isAllCaps) {
          markdown += '## ' + line + '\n\n';
        } else {
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

      // Get slide references — parse relationship file ONCE, cache in Map
      const slideRefs = presDoc.querySelectorAll('p\\:sldIdLst sldId, sldId');
      const slideFiles = [];

      const relsMap = new Map();
      const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
      if (relsFile) {
        const relsXml = await relsFile.async('text');
        const relsDoc = parser.parseFromString(relsXml, 'application/xml');
        relsDoc.querySelectorAll('Relationship').forEach(rel => {
          relsMap.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
        });
      }

      for (const sldRef of slideRefs) {
        const rId = sldRef.getAttribute('r:id');
        if (!rId || !relsMap.has(rId)) continue;

        const targetPath = relsMap.get(rId);
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

  // ---------------------------------------------------------------------------
  // 8. PORT MESSAGE HANDLER
  // ---------------------------------------------------------------------------
  // Listens ONLY for 'ftm-offscreen-internal' — no dual-name ambiguity.
  // ---------------------------------------------------------------------------

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
        if (typeof pdfjsLib === 'undefined') {
          await loadScript('lib/pdf.min.js');
          // Set worker path once after library loads
          pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
        }
        markdown = await processPdf(arrayBuffer, fileName);
        break;

      default:
        throw new Error('Unsupported binary format: ' + extension);
    }
  }

  // ===========================================================================
  // AGGRESSIVE MEMORY CLEANUP
  // ===========================================================================

  function performAggressiveCleanup() {
    // Step 1: Nullify ALL global library references (may be read-only in some contexts)
    if (typeof window !== 'undefined') {
      const globals = ['mammoth', 'XLSX', 'JSZip', 'TurndownService', 'pdfjsLib'];
      for (const name of globals) {
        try { window[name] = null; } catch (_) { /* read-only — ignore */ }
      }
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
