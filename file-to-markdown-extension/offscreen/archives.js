// ===========================================================================
// offscreen/archives.js — EPUB and PPTX parsers (ZIP based)
// ===========================================================================
// FIX #1 (High): EPUB chapter HTML is sanitized before passing to Turndown.
//   Event-handler attributes (onerror, onload, etc.) and script-related
//   content are stripped from the parsed DOM before conversion.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const T = FTM.text;
  const parser = new DOMParser();

  // FIX #1: Attributes that can execute JavaScript.
  const DANGEROUS_ATTRS = new Set([
    'onabort', 'onafterprint', 'onbeforeprint', 'onbeforeunload', 'onblur',
    'oncanplay', 'oncanplaythrough', 'onchange', 'onclick', 'oncontextmenu',
    'oncopy', 'oncut', 'ondblclick', 'ondrag', 'ondragend', 'ondragenter',
    'ondragleave', 'ondragover', 'ondragstart', 'ondrop', 'ondurationchange',
    'onemptied', 'onended', 'onerror', 'onfocus', 'onfocusin', 'onfocusout',
    'onhashchange', 'oninput', 'oninvalid', 'onkeydown', 'onkeypress',
    'onkeyup', 'onload', 'onloadeddata', 'onloadedmetadata', 'onloadstart',
    'onmessage', 'onmousedown', 'onmouseenter', 'onmouseleave', 'onmousemove',
    'onmouseout', 'onmouseover', 'onmouseup', 'onmousewheel', 'onoffline',
    'ononline', 'onpagehide', 'onpageshow', 'onpaste', 'onpause', 'onplay',
    'onplaying', 'onpopstate', 'onprogress', 'onratechange', 'onreset',
    'onresize', 'onsearch', 'onseeked', 'onseeking', 'onselect', 'onshow',
    'onstalled', 'onstorage', 'onsubmit', 'onsuspend', 'ontimeupdate',
    'ontoggle', 'onunload', 'onvolumechange', 'onwaiting', 'onwheel'
  ]);

  // FIX #1: Strip dangerous attributes and script content from a DOM tree.
  function sanitizeDocument(doc) {
    const allElements = doc.querySelectorAll('*');
    for (const el of allElements) {
      // Remove event-handler attributes.
      for (const attr of Array.from(el.attributes)) {
        if (DANGEROUS_ATTRS.has(attr.name.toLowerCase()) ||
            attr.name.toLowerCase().startsWith('on')) {
          el.removeAttribute(attr.name);
        }
        // Neutralize javascript: URLs in href/src/action/formaction.
        if (['href', 'src', 'action', 'formaction'].includes(attr.name.toLowerCase())) {
          const val = attr.value.trim().toLowerCase();
          if (val.startsWith('javascript:') || val.startsWith('vbscript:') || val.startsWith('data:')) {
            el.removeAttribute(attr.name);
          }
        }
      }
    }
    // Remove <script> and <style> elements entirely.
    for (const tag of ['script', 'style', 'iframe', 'object', 'embed', 'applet']) {
      for (const el of doc.querySelectorAll(tag)) {
        el.remove();
      }
    }
    return doc;
  }

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

  // Extract the real title from HTML: try <title>, then first <h1>/<h2>.
  function extractChapterTitle(doc) {
    const title = doc.querySelector('title');
    if (title && title.textContent.trim()) return T.plain(title.textContent.trim());
    const heading = doc.querySelector('h1, h2, h3');
    if (heading && heading.textContent.trim()) return T.plain(heading.textContent.trim());
    return null;
  }

  async function chapterMarkdown(zip, path, turndown) {
    const content = await readEntry(zip, path);
    if (!content) return { title: null, text: '' };
    const doc = xml(content, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) return { title: null, text: '' };
    sanitizeDocument(doc);
    const title = extractChapterTitle(doc);
    const body = doc.body || doc.documentElement;
    if (!body) return { title, text: '' };
    const markup = body ? new self.XMLSerializer().serializeToString(body) : '';
    const text = turndown.turndown(markup || (body && body.textContent) || '').replace(/\n{3,}/g, '\n\n').trim();
    return { title, text };
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
        const { title: chTitle, text } = await chapterMarkdown(zip, path, turndown);
        if (!text) continue;
        const heading = chTitle || chapterTitle(path);
        if (chapters.length > 1) parts.push('\n## ' + heading + '\n\n');
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
