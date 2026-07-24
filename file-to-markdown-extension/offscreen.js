// ===========================================================================
// offscreen.js — Ephemeral Binary File Parser (v6)
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
// V6 CHANGES:
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

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      
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

  async function processPdf(arrayBuffer, fileName) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not loaded.');
    }

    // Set worker source using correct Chrome extension URL format
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

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

        // Detect potential headings: short title lines or ALL-CAPS headers
        if (line.length < 70 && !line.endsWith('.') && !line.endsWith(',') && i + 1 < lines.length && lines[i + 1].length > 40) {
          markdown += '## ' + line + '\n\n';
        } else if (line.length < 50 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
          markdown += '### ' + line + '\n\n';
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

      // Get slide references
      const slideRefs = presDoc.querySelectorAll('p\\:sldIdLst sldId, sldId');
      const slideFiles = [];

      for (const sldRef of slideRefs) {
        const rId = sldRef.getAttribute('r:id');
        if (!rId) continue;

        // Find relationship in presentation.xml.rels
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
  // V6: Listens ONLY for 'ftm-offscreen-internal' — no dual-name ambiguity.
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
    // Step 1: Nullify ALL global library references
    if (typeof window !== 'undefined') {
      window.mammoth = null;
      window.XLSX = null;
      window.JSZip = null;
      window.TurndownService = null;
      window.pdfjsLib = null;
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
