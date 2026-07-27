// ===========================================================================
// offscreen/archives.js — EPUB and PPTX parsers (ZIP based)
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const T = FTM.text;
  const parser = new DOMParser();

  function xml(text, mime) {
    return parser.parseFromString(text, mime || 'application/xml');
  }

  async function readEntry(zip, path) {
    const entry = zip.file(path);
    return entry ? entry.async('text') : null;
  }

  async function opfPath(zip) {
    const container = await readEntry(zip, 'META-INF/container.xml');
    const rootfile = container && xml(container).querySelector('rootfile');
    return rootfile ? rootfile.getAttribute('full-path') : null;
  }

  function spineOrder(opfDoc, opfDir) {
    const manifest = {};
    opfDoc.querySelectorAll('manifest item').forEach((item) => { manifest[item.getAttribute('id')] = item.getAttribute('href'); });
    const files = [];
    opfDoc.querySelectorAll('spine itemref').forEach((ref) => {
      const href = manifest[ref.getAttribute('idref')];
      if (href) files.push(opfDir + href);
    });
    return files;
  }

  async function epubChapters(zip) {
    const path = await opfPath(zip);
    const opf = path ? await readEntry(zip, path) : null;
    if (opf) {
      const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/') + 1) : '';
      const files = spineOrder(xml(opf), dir);
      if (files.length) return files;
    }
    const fallback = [];
    zip.forEach((relPath) => {
      const isDoc = relPath.endsWith('.xhtml') || relPath.endsWith('.html');
      if (isDoc && !relPath.startsWith('META-INF') && !relPath.includes('toc') && !relPath.includes('nav')) fallback.push(relPath);
    });
    return fallback.sort((a, b) => a.localeCompare(b));
  }

  function chapterTitle(path) {
    return path.replace(/\.[^.]+$/, '').replace(/^[^/]+\//, '').replace(/[_-]/g, ' ');
  }

  async function chapterMarkdown(zip, path, turndown) {
    const content = await readEntry(zip, path);
    if (!content) return '';
    const doc = xml(content, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) return '';
    const body = doc.body || doc.documentElement;
    if (!body) return '';
    return turndown.turndown(body.innerHTML || body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function parseEpub(bytes, meta) {
    const JSZip = await FTM.libs.get('jszip');
    const title = T.plain(T.stem(meta.fileName));
    const parts = ['# ' + title + '\n\n'];
    try {
      const zip = await JSZip.loadAsync(bytes);
      const chapters = await epubChapters(zip);
      const turndown = await FTM.libs.turndown();
      for (const path of chapters) {
        const text = await chapterMarkdown(zip, path, turndown);
        if (!text) continue;
        if (chapters.length > 1) parts.push('\n## ' + chapterTitle(path) + '\n\n');
        parts.push(text + '\n\n');
      }
    } catch (err) {
      return '# ' + title + '\n\n[Failed to extract EPUB: ' + err.message + ']\n';
    }
    return parts.join('');
  }

  async function slidePaths(zip) {
    const presentation = await readEntry(zip, 'ppt/presentation.xml');
    if (!presentation) throw new Error('Invalid PPTX: missing presentation.xml');
    const rels = await readEntry(zip, 'ppt/_rels/presentation.xml.rels');
    const relsMap = new Map();
    if (rels) xml(rels).querySelectorAll('Relationship').forEach((rel) => relsMap.set(rel.getAttribute('Id'), rel.getAttribute('Target')));
    const paths = [];
    xml(presentation).querySelectorAll('sldId').forEach((ref) => {
      const target = relsMap.get(ref.getAttribute('r:id'));
      if (target) paths.push(target.startsWith('/') ? target.substring(1) : 'ppt/' + target);
    });
    return paths.length ? paths : orderedSlides(zip);
  }

  function orderedSlides(zip) {
    const paths = [];
    zip.forEach((relPath) => { if (/^ppt\/slides\/slide\d+\.xml$/.test(relPath)) paths.push(relPath); });
    return paths.sort((a, b) => parseInt(a.match(/slide(\d+)/)[1], 10) - parseInt(b.match(/slide(\d+)/)[1], 10));
  }

  async function slideText(zip, path) {
    const content = await readEntry(zip, path);
    if (!content) return [];
    const texts = [];
    xml(content).querySelectorAll('t').forEach((el) => {
      const text = el.textContent.trim();
      if (text) texts.push(text);
    });
    return texts;
  }

  async function parsePptx(bytes, meta) {
    const JSZip = await FTM.libs.get('jszip');
    const title = T.plain(T.stem(meta.fileName));
    const parts = ['# ' + title + '\n\n'];
    try {
      const zip = await JSZip.loadAsync(bytes);
      const slides = await slidePaths(zip);
      for (let i = 0; i < slides.length; i++) {
        const texts = await slideText(zip, slides[i]);
        if (!texts.length) continue;
        parts.push('## Slide ' + (i + 1) + '\n\n', '**' + texts[0] + '**\n\n');
        for (let j = 1; j < texts.length; j++) parts.push('- ' + texts[j] + '\n');
        parts.push('\n');
      }
    } catch (err) {
      return '# ' + title + '\n\n[Failed to extract PPTX: ' + err.message + ']\n';
    }
    return parts.join('');
  }

  FTM.parsers = FTM.parsers || {};
  FTM.parsers['.epub'] = parseEpub;
  FTM.parsers['.pptx'] = parsePptx;
})();
