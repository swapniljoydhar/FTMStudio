// ===========================================================================
// content/router.js — Extension → converter dispatch (open/closed principle)
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  FTM.router = {
    needsOffscreen(ext) {
      return FTM.OFFSCREEN_EXTENSIONS.has(ext);
    },

    resolve(ext) {
      const C = FTM.converters;
      if (this.needsOffscreen(ext)) return (file) => C.offscreen(file, ext);
      if (FTM.RTF_EXTENSION.has(ext)) return (file) => C.rtf(file);
      if (FTM.IMAGE_EXTENSIONS.has(ext)) return (file) => C.image(file);
      return (file) => C.text(file, ext);
    },

    convert(file, ext) {
      return this.resolve(ext)(file);
    }
  };
})();
