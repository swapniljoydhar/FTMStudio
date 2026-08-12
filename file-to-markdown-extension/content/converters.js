// content/converters.js — bounded text, source, JSON, and RTF converters

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});
  const T = FTM.text;

  async function head(file, bytes) { return new Uint8Array(await file.slice(0, bytes).arrayBuffer()); }

  async function assertNotBinary(file) {
    const bytes = await head(file, FTM.CONSTANTS.SNIFF_BYTES);
    const signature = T.magicSignature(bytes);
    if (signature) throw new Error('Detected ' + signature + ' signature in "' + file.name + '"');
    const nulls = T.countNullBytes(bytes);
    if (nulls > FTM.CONSTANTS.MAX_NULL_BYTES) throw new Error('Binary data in "' + file.name + '".');
  }

  function assertSize(file, limit) {
    if (file.size > limit) throw new Error('File too large: ' + T.formatBytes(file.size) + ' (max ' + T.formatBytes(limit) + ').');
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
      const source = await file.text();
      if (ext === '.json') return jsonToMarkdown(source, file.name);
      return '# ' + T.plain(T.stem(file.name)) + '\n\n```' + T.getLanguageTag(ext) + '\n' + source + '\n```';
    },

    async rtf(file) {
      assertSize(file, FTM.CONSTANTS.MAX_TEXT_READ_SIZE_BYTES);
      return '# ' + T.plain(T.stem(file.name)) + '\n\n' + T.rtfToMarkdown(await file.text());
    }
  };
})();
