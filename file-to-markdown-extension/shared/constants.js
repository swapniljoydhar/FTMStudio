// ===========================================================================
// shared/constants.js — Single source of truth for limits, maps and hosts
// Loaded by: content scripts, background service worker, offscreen document.
// ===========================================================================

'use strict';

(() => {
  const FTM = (self.FTM = self.FTM || {});

  FTM.CONSTANTS = {
    SNIFF_BYTES: 1024,
    MAX_TEXT_READ_SIZE_BYTES: 10 * 1024 * 1024,
    MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
    MAX_OUTPUT_BYTES: 80 * 1024 * 1024,
    MAX_IMAGE_SIZE_BYTES: 4 * 1024 * 1024,
    MAX_PDF_PAGES: 500,
    MAX_OCR_PAGES: 12,
    MAX_SPREADSHEET_CELLS: 500000,
    MAX_QUEUE_FILES: 12,
    MAX_NULL_BYTES: 3,
    CSV_STREAM_THRESHOLD_MB_DEFAULT: 5,
    MAX_CSV_ROWS: 100000,
    SCRIPT_LOAD_TIMEOUT_MS: 15000,
    CONVERSION_TIMEOUT_MS: 60000,
    CONVERSION_NO_PROGRESS_TIMEOUT_MS: 15000,
    TOAST_COUNTDOWN_DEFAULT_SEC: 10,
    MAX_HISTORY_ENTRIES: 50,
    HISTORY_DEBOUNCE_MS: 2000,
    OFFSCREEN_IDLE_MS: 5000,
    TRANSFER_CHUNK_BYTES: 512 * 1024,
    REGEX_CACHE_MAX: 64,
    REGEX_BUDGET_MS: 50,
    MAX_RTF_GROUP_DEPTH: 100,
    MAX_RTF_TOKENS: 1000000,
    MAX_PIPELINE_INPUT_BYTES: 2 * 1024 * 1024,
    QUEUED_MESSAGE_LIMIT: 128,
    MAX_MATCH_PATTERNS: 500,
    MAX_BROADCAST_TABS: 100,
    KB: 1024,
    MB: 1024 * 1024
  };

  FTM.EXTENSION_MAP = {
    '.docx': 'documents', '.txt': 'documents', '.rtf': 'documents', '.md': 'documents',
    '.pdf': 'pdf',
    '.csv': 'spreadsheets', '.xlsx': 'spreadsheets', '.xls': 'spreadsheets',
    '.py': 'code', '.js': 'code', '.cpp': 'code', '.css': 'code', '.json': 'code', '.xml': 'code',
    '.html': 'markup',
    '.svg': 'markup'
  };

  // Manual mode intentionally exposes only formats with predictable local
  // conversion quality. Images are not treated as documents by default because
  // embedding base64 into Markdown multiplies memory and output size.
  FTM.MANUAL_EXTENSIONS = new Set([
    '.pdf', '.docx', '.txt', '.md', '.rtf', '.html', '.csv', '.xlsx', '.xls',
    '.py', '.js', '.cpp', '.css', '.json', '.xml'
  ]);

  FTM.CATEGORIES = ['documents', 'pdf', 'spreadsheets', 'code', 'markup', 'presentations'];

  FTM.TEXT_EXTENSIONS = new Set(['.txt', '.md', '.py', '.js', '.cpp', '.css', '.json', '.xml', '.html', '.svg']);
  FTM.BINARY_EXTENSIONS = new Set(['.docx', '.xlsx', '.xls', '.pdf']);
  FTM.RTF_EXTENSION = new Set(['.rtf']);
  FTM.IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

  // Extensions whose parsing needs a library, so they are handled by the
  // offscreen document instead of the content script.
  FTM.OFFSCREEN_EXTENSIONS = new Set([...FTM.BINARY_EXTENSIONS, '.csv']);

  FTM.MAGIC_SIGNATURES = [
    { bytes: [0x50, 0x4B, 0x03, 0x04], name: 'ZIP/DOCX/XLSX/PPTX/EPUB' },
    { bytes: [0x25, 0x50, 0x44, 0x46], name: 'PDF' },
    { bytes: [0xD0, 0xCF, 0x11, 0xE0], name: 'OLE2 (legacy DOC/XLS)' },
    { bytes: [0x7B, 0x5C, 0x72, 0x74, 0x66], name: 'RTF' },
    { bytes: [0x1F, 0x8B], name: 'GZIP' },
    { bytes: [0x42, 0x5A, 0x68], name: 'BZIP2' }
  ];

})();
