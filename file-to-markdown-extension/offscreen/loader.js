// ===========================================================================
// offscreen/loader.js — On-demand parser library loading
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  const CLASSIC = {
    turndown: { src: 'lib/turndown.min.js', global: 'TurndownService' },
    turndownGfm: { src: 'lib/turndown-plugin-gfm.min.js', global: 'turndownPluginGfm' },
    mammoth: { src: 'lib/mammoth.browser.min.js', global: 'mammoth' },
    jszip: { src: 'lib/jszip.min.js', global: 'JSZip' },
    xlsx: { src: 'lib/xlsx.mini.min.js', global: 'XLSX' },
    papa: { src: 'lib/papaparse.min.js', global: 'Papa' }
  };

  FTM.libs = {
    loaded: new Map(),
    inFlight: new Map(),

    inject(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = self.FTM_BROWSER.getURL(src);
        const fail = (message) => { script.remove(); reject(new Error(message)); };
        const timeout = setTimeout(() => fail('Load timeout: ' + src), FTM.CONSTANTS.SCRIPT_LOAD_TIMEOUT_MS);
        script.onload = () => { clearTimeout(timeout); resolve(); };
        script.onerror = () => { clearTimeout(timeout); fail('Load failed: ' + src); };
        document.head.appendChild(script);
      });
    },

    async get(name) {
      if (this.loaded.has(name)) return this.loaded.get(name);
      if (this.inFlight.has(name)) return this.inFlight.get(name);
      const entry = CLASSIC[name];
      if (!entry) throw new Error('Unknown library: ' + name);
      const promise = this.loadClassic(name, entry);
      this.inFlight.set(name, promise);
      try { return await promise; } finally { this.inFlight.delete(name); }
    },

    async loadClassic(name, entry) {
      await this.inject(entry.src);
      const lib = self[entry.global];
      if (!lib) throw new Error('Library did not initialise: ' + name);
      this.loaded.set(name, lib);
      return lib;
    },

    // PDF.js 4.x ships as an ES module; `isEvalSupported:false` is applied at
    // getDocument() time (see offscreen/documents.js) to close CVE-2024-4367.
    async pdf() {
      if (this.loaded.has('pdf')) return this.loaded.get('pdf');
      const lib = await import(self.FTM_BROWSER.getURL('lib/pdf.min.mjs'));
      lib.GlobalWorkerOptions.workerSrc = self.FTM_BROWSER.getURL('lib/pdf.worker.min.mjs');
      this.loaded.set('pdf', lib);
      return lib;
    },

    async turndown() {
      const [Service, gfm] = await Promise.all([this.get('turndown'), this.get('turndownGfm')]);
      const converter = new Service({
        headingStyle: 'atx', codeBlockStyle: 'fenced', fence: '```',
        emDelimiter: '*', strongDelimiter: '**', bulletListMarker: '-',
        preformattedCode: true
      });
      if (gfm && gfm.gfm) converter.use(gfm.gfm);
      converter.addRule('noImages', { filter: ['img'], replacement: () => '\n![Image omitted]\n' });
      return converter;
    },

    // Tesseract.js OCR — lazy-loaded only when a scanned PDF is detected.
    // The worker + language data (~3.1 MB) are loaded on first use and cached.
    async tesseract() {
      if (this.loaded.has('tesseract')) return this.loaded.get('tesseract');
      await this.inject('lib/tesseract/tesseract.min.js');
      const Tesseract = self.Tesseract;
      if (!Tesseract) throw new Error('Tesseract.js did not initialise');
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: self.FTM_BROWSER.getURL('lib/tesseract/worker.min.js'),
        langPath: self.FTM_BROWSER.getURL('lib/tesseract/langs'),
        workerBlobURL: false,
        gzip: true
      });
      this.loaded.set('tesseract', worker);
      return worker;
    },

    release() {
      // Terminate Tesseract worker before clearing.
      const tess = this.loaded.get('tesseract');
      if (tess && typeof tess.terminate === 'function') {
        try { tess.terminate(); } catch (_) { /* ignore */ }
      }
      this.loaded.clear();
    }
  };
})();
