// ===========================================================================
// offscreen.js — Ephemeral Binary File Parser (v1.0.1)
// ===========================================================================
//
// EXECUTES INSIDE THE OFFSCREEN DOCUMENT.
//
// Supported formats:
//   - .docx   (mammoth.js → HTML → Turndown.js → Markdown)
//   - .xlsx/.xls (SheetJS xlsx.mini → sheets → Markdown tables)
//   - .epub   (JSZip → container.xml → XHTML → Turndown.js → Markdown)
//   - .pptx   (JSZip → slide XML → Turndown.js → Markdown)
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

  // ---------------------------------------------------------------------------
  // 1. DYNAMIC SCRIPT LOADING WITH ERROR HANDLING
  // ---------------------------------------------------------------------------

  // SRI Hashes for library integrity verification
  const SRI_HASHES = {
    'lib/mammoth.browser.min.js': 'sha256-596ef52239e52d8ee3cee10b2ee4a72596abf900d0e4f468593f956e9f1809b0',
    'lib/xlsx.mini.min.js': 'sha256-3120abba1fd0ea031f25ab22ac93e726f6f63467da1a6349b82e82f3df5d775c',
    'lib/jszip.min.js': 'sha256-acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e',
    'lib/turndown.min.js': 'sha256-fd0e2aa0785c13c39fa1ddc0b3b19520e541b69801c1369ea4aabfe7913a0dea',
    'lib/pdf.min.js': 'sha256-5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946',
    'lib/pdf.worker.min.js': 'sha256-feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b',
    'lib/papaparse.min.js': 'sha256-b8e870c5d2b29772f10c9fa9a693c8b896aac8540ed6701e3cc6304c683febdb'
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      
      // Add Subresource Integrity hash if available
      const sriHash = SRI_HASHES[src];
      if (sriHash) {
        script.integrity = sriHash;
        script.crossOrigin = 'anonymous';
      }
      
      let timeoutId = null;
      
      script.onload = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      };
      
      script.onerror = () => {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[FTM] Failed to load script:', src);
        reject(new Error('Library load failed: ' + src));
      };
      
      // Add timeout to prevent hanging on slow/blocked loads
      timeoutId = setTimeout(() => {
        script.onerror(new Error('Load timeout: ' + src));
      }, 15000);
      
      document.head.appendChild(script);
    });
  }

  // ---------------------------------------------------------------------------
  // 2. TURNDOWN SETUP (with table rule)
  // ---------------------------------------------------------------------------
  function createTurndown() {
    if (typeof TurndownService === 'undefined') {
      throw new Error('Turndown.js not loaded');
    }

    const turndown = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '_'
    });

    // Table support rule
    turndown.addRule('tables', {
      filter: 'table',
      replacement: function(content, node) {
        if (!content.trim()) return '';

        const rows = [];
        const trs = node.querySelectorAll('tr');
        for (const tr of trs) {
          const cells = [];
          const tds = tr.querySelectorAll('th, td');
          for (const td of tds) cells.push(td.textContent.trim());
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length === 0) return '';

        const maxCols = Math.max(...rows.map(r => r.length));
        const normalized = rows.map(r => {
          while (r.length < maxCols) r.push('');
          return r.map(c => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' '));
        });

        const header = '| ' + normalized[0].join(' | ') + ' |';
        const separator = '| ' + normalized[0].map(() => '---').join(' | ') + ' |';
        const body = normalized.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n');
        return header + '\n' + separator + '\n' + body + '\n';
      }
    });

    return turndown;
  }

  // ---------------------------------------------------------------------------
  // 3. DOCX PROCESSING (mammoth.js → HTML → Turndown → Markdown)
  // ---------------------------------------------------------------------------
  // CAVEAT: Mammoth is semantic, not visual. Complex layouts (multi-column,
  // floating text boxes, OLE objects) are flattened into linear text.
  // Images are stripped to prevent base64 bloat.
  // ---------------------------------------------------------------------------

  async function processDocx(arrayBuffer, fileName) {
    if (typeof mammoth === 'undefined') {
      throw new Error('mammoth.js library not loaded.');
    }

    const options = {
      convertImage: mammoth.images.imgElement(function(image) {
        return image.read('base64').then(function() {
          return { src: '', alt: '[Image]' };
        });
      })
    };

    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer }, options);
    const html = result.value || '';

    // Strip any remaining img tags
    const cleanHtml = html.replace(/<img\s+[^>]*>/gi, '');

    const turndown = createTurndown();
    let markdown = turndown.turndown(cleanHtml);
    markdown = markdown.replace(/!\[.*?\]\(.*?\)/g, '');
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

    return '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n' + markdown;
  }

  // ---------------------------------------------------------------------------
  // 4. EPUB PROCESSING (JSZip → container.xml → XHTML → Turndown)
  // ---------------------------------------------------------------------------

  async function processEpub(arrayBuffer, fileName) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not loaded.');
    }

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

        const chapterName = cf.path.replace(/\.[^.]+$/, '').replace(/^[^\/]+\//, '').replace(/_/g, ' ').replace(/-/g, ' ').replace(/chapter\s*/i, 'Chapter ');
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
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS library not loaded.');
    }

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
        return safe.replace(/\|/g, '\\|');
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

    // Cleanup workbook immediately
    for (const key of Object.keys(workbook)) {
      try { workbook[key] = null; } catch (_) {}
    }

    return markdown;
  }

  // ---------------------------------------------------------------------------
  // 6. PDF PROCESSING (PDF.js → text extraction → Markdown)
  // ---------------------------------------------------------------------------
  // PDF.js extracts text per page. We preserve page breaks with horizontal
  // rules and group consecutive short lines as paragraphs.
  // ---------------------------------------------------------------------------

  // Worker path is set once in handleProcessRequest after library loads

  async function processPdf(arrayBuffer, fileName) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not loaded.');
    }

    // Validate ArrayBuffer is not empty
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('The PDF file is empty, i.e. its size is zero bytes.');
    }

    // Wrap ArrayBuffer in Uint8Array for PDF.js
    const typedArray = new Uint8Array(arrayBuffer);

    let pdf;
    try {
      const loadingTask = pdfjsLib.getDocument({ data: typedArray });
      pdf = await loadingTask.promise;
    } catch (err) {
      console.error('[FTM] PDF.js getDocument error:', err);
      throw new Error('Failed to load PDF: ' + (err.message || 'Unknown error'));
    }

    const numPages = pdf.numPages;

    let markdown = '# ' + fileName.replace(/\.[^.]+$/, '') + '\n\n';
    markdown += `*${numPages} page${numPages !== 1 ? 's' : ''} extracted*\n\n`;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (numPages > 1) {
        markdown += '\n---\n\n';
        markdown += `**Page ${pageNum}**\n\n`;
      }

      let page;
      let textContent;
      try {
        page = await pdf.getPage(pageNum);
        textContent = await page.getTextContent();
      } catch (err) {
        console.warn('[FTM] PDF page ' + pageNum + ' extraction error:', err.message);
        markdown += `*[Page ${pageNum} could not be extracted]*\n\n`;
        continue;
      }

      // Sort text items top-to-bottom (Y desc), left-to-right (X asc)
      // FIX: Validate transform matrix exists before accessing
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

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // Conservative heading detection:
        // 1. ALL-CAPS lines under 40 chars with letters (e.g. "INTRODUCTION", "CHAPTER 1")
        // 2. Short lines (<40 chars) that are title-cased, don't end with punctuation,
        //    AND are followed by a blank line or much longer line
        const isAllCaps = line.length < 40 && line === line.toUpperCase() && /[A-Z]{2,}/.test(line) && !/\d/.test(line);
        const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
        const isTitleLike = line.length < 40 && !line.endsWith('.') && !line.endsWith(',') &&
          !line.endsWith(':') && !line.endsWith(';') &&
          /^[A-Z]/.test(line) && (nextLine === '' || nextLine.length > line.length * 2);

        if (isAllCaps) {
          markdown += '### ' + line + '\n\n';
        } else if (isTitleLike) {
          markdown += '## ' + line + '\n\n';
        } else {
          markdown += line + '\n\n';
        }
      }

      markdown = markdown.replace(/\n{3,}/g, '\n\n');
    }

    markdown += '\n';
    return markdown.trim();
  }

  // ---------------------------------------------------------------------------
  // 7. PPTX PROCESSING (JSZip → slide XML → Turndown → Markdown)
  // ---------------------------------------------------------------------------
  // PPTX files are ZIP archives containing slide XML files.
  // We extract each slide's text content and format as Markdown.
  // ---------------------------------------------------------------------------

  async function processPptx(arrayBuffer, fileName) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not loaded.');
    }

    const title = fileName.replace(/\.[^.]+$/, '');
    let markdown = '# ' + title + '\n\n';

    try {
      const zip = await JSZip.loadAsync(arrayBuffer);

      // Parse presentation.xml to get slide list
      const presFile = zip.file('ppt/presentation.xml');
      if (!presFile) {
        throw new Error('Invalid PPTX: missing presentation.xml');
      }

      const presXml = await presFile.async('text');
      const parser = new DOMParser();
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

      // If no slides found via relationships, scan directly
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

      const turndown = createTurndown();

      for (let i = 0; i < slideFiles.length; i++) {
        const slideFile = zip.file(slideFiles[i]);
        if (!slideFile) continue;

        const slideXml = await slideFile.async('text');
        const slideDoc = parser.parseFromString(slideXml, 'application/xml');

        // Extract all text elements
        const textElements = slideDoc.querySelectorAll('a\\:t, t');
        const texts = [];
        for (const elem of textElements) {
          const text = elem.textContent.trim();
          if (text) texts.push(text);
        }

        if (texts.length === 0) continue;

        markdown += `## Slide ${i + 1}\n\n`;

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

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'ftm-offscreen-internal') return;

    port.onMessage.addListener((message) => {
      if (message.type === 'PROCESS_BINARY_FILE') {
        handleProcessRequest(message.data).then((result) => {
          port.postMessage({ type: 'PROCESS_RESULT', data: result });
        }).catch((err) => {
          port.postMessage({ type: 'ERROR', data: { error: err.message || String(err) } });
        });
      }
    });
  });

  async function handleProcessRequest(data) {
    const { fileName, extension, arrayBuffer } = data;

    let markdown;

    switch (extension) {
      case '.docx':
        if (typeof mammoth === 'undefined') {
          await loadScript('lib/mammoth.browser.min.js');
        }
        if (typeof TurndownService === 'undefined') {
          await loadScript('lib/turndown.min.js');
        }
        markdown = await processDocx(arrayBuffer, fileName);
        break;

      case '.xlsx':
      case '.xls':
        if (typeof XLSX === 'undefined') {
          await loadScript('lib/xlsx.mini.min.js');
        }
        markdown = await processSpreadsheet(arrayBuffer, fileName);
        break;

      case '.epub':
        if (typeof JSZip === 'undefined') {
          await loadScript('lib/jszip.min.js');
        }
        if (typeof TurndownService === 'undefined') {
          await loadScript('lib/turndown.min.js');
        }
        markdown = await processEpub(arrayBuffer, fileName);
        break;

      case '.pptx':
        if (typeof JSZip === 'undefined') {
          await loadScript('lib/jszip.min.js');
        }
        if (typeof TurndownService === 'undefined') {
          await loadScript('lib/turndown.min.js');
        }
        markdown = await processPptx(arrayBuffer, fileName);
        break;

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

    return { markdown, fileName };
  }

  // ---------------------------------------------------------------------------
  // 9. AGGRESSIVE MEMORY CLEANUP
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CLOSE_OFFSCREEN') {
      performAggressiveCleanup();
    }
  });

  function performAggressiveCleanup() {
    // Step 1: Nullify ALL global library references (may be read-only in some contexts)
    if (typeof window !== 'undefined') {
      const globals = ['mammoth', 'XLSX', 'JSZip', 'TurndownService', 'pdfjsLib'];
      for (const name of globals) {
        try { window[name] = null; } catch (_) { /* read-only — ignore */ }
      }
    }

    // Step 2: Remove ALL dynamically loaded script tags
    const scripts = document.querySelectorAll('script[src^="lib/"]');
    scripts.forEach(s => {
      s.onload = null;
      s.onerror = null;
      s.src = '';
      if (s.parentNode) s.parentNode.removeChild(s);
    });

    // Step 3: Clear DOM content
    if (document.body) {
      document.body.innerHTML = '';
    }

    // Step 4: Signal completion
    chrome.runtime.sendMessage({ type: 'CLOSE_OFFSCREEN_DONE' });
  }

})();
