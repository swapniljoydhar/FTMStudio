// ===========================================================================
// content/converters.js — In-page converters (text, code, JSON, RTF, images)
// ===========================================================================
// Library-dependent formats (DOCX/XLSX/PDF/PPTX/EPUB/CSV) are handled by the
// offscreen document: no third-party parser and no page-world script
// injection happens here any more.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const T = FTM.text;

  async function head(file, bytes) {
    return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
  }

  async function assertNotBinary(file) {
    const bytes = await head(file, FTM.CONSTANTS.SNIFF_BYTES);
    const signature = T.magicSignature(bytes);
    if (signature) throw new Error('Detected ' + signature + ' signature in "' + file.name + '"');
    const nulls = T.countNullBytes(bytes);
    if (nulls > FTM.CONSTANTS.MAX_NULL_BYTES) throw new Error('Binary data in "' + file.name + '" (' + nulls + ' null bytes)');
  }

  function assertSize(file, limit) {
    if (file.size > limit) throw new Error('File too large: ' + T.formatBytes(file.size) + ' (max ' + T.formatBytes(limit) + ')');
  }

  function jsonToMarkdown(text, fileName) {
    const title = '# ' + T.plain(T.stem(fileName)) + '\n\n```json\n';
    try { return title + JSON.stringify(JSON.parse(text), null, 2) + '\n```'; }
    catch (_) { return title + text + '\n```'; }
  }

  FTM.converters = {
    async text(file, ext) {
      assertSize(file, FTM.CONSTANTS.MAX_TEXT_READ_SIZE_BYTES);
      if (file.size > FTM.CONSTANTS.SNIFF_BYTES) await assertNotBinary(file);
      const text = await file.text();
      if (ext === '.json') return jsonToMarkdown(text, file.name);
      return '# ' + T.plain(file.name) + '\n\n```' + T.getLanguageTag(ext) + '\n' + text + '\n```';
    },

    async rtf(file) {
      assertSize(file, FTM.CONSTANTS.MAX_TEXT_READ_SIZE_BYTES);
      return '# ' + T.plain(T.stem(file.name)) + '\n\n' + T.rtfToMarkdown(await file.text());
    },

    // Base64 data URLs cost ~1.37x the file size and are then copied into a
    // Blob and a File, so images are capped well below the generic limit.
    async image(file) {
      assertSize(file, FTM.CONSTANTS.MAX_IMAGE_SIZE_BYTES);
      const dataUrl = await this.dataUrl(file);
      const title = T.plain(T.stem(file.name));
      return '# ' + title + '\n\n![' + title + '](' + dataUrl + ')\n\n*Size: ' + T.formatBytes(file.size) + '*\n';
    },

    dataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image: ' + file.name));
        reader.readAsDataURL(file);
      });
    },

    csvStreams(file) {
      const mb = FTM.config.csvStreamThreshold || FTM.CONSTANTS.CSV_STREAM_THRESHOLD_MB_DEFAULT;
      return file.size >= mb * FTM.CONSTANTS.MB;
    },

    offscreen(file, ext) {
      const options = {
        imageMode: FTM.config.imageMode,
        ...(ext === '.csv' ? { streaming: this.csvStreams(file) } : {})
      };
      return FTM.transport.convert(file, ext, options);
    }
  };
})();
