// ===========================================================================
// content/constants.js — Centralized constants and extension maps
// ===========================================================================

window.FTM = window.FTM || {};

FTM.CONSTANTS = {
  SNIFF_THRESHOLD_BYTES: 1024,
  MAX_TEXT_READ_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
  CSV_STREAM_THRESHOLD_MB_DEFAULT: 5,
  MAX_CSV_ROWS: 100000,
  SCRIPT_LOAD_TIMEOUT_MS: 15000,
  CONVERSION_TIMEOUT_MS: 60000,
  TOAST_COUNTDOWN_DEFAULT_SEC: 10,
  MAX_HISTORY_ENTRIES: 50,
  KB: 1024,
  MB: 1024 * 1024
};

FTM.EXTENSION_MAP = {
  '.docx': 'documents', '.txt': 'documents', '.rtf': 'documents', '.md': 'documents',
  '.pdf': 'pdf',
  '.csv': 'spreadsheets', '.xlsx': 'spreadsheets', '.xls': 'spreadsheets',
  '.py': 'code', '.js': 'code', '.cpp': 'code', '.css': 'code', '.json': 'code', '.xml': 'code',
  '.html': 'markup', '.epub': 'markup',
  '.pptx': 'presentations'
};

FTM.TEXT_EXTENSIONS = new Set(['.txt', '.md', '.py', '.js', '.cpp', '.css', '.json', '.xml', '.html', '.csv']);
FTM.BINARY_EXTENSIONS = new Set(['.docx', '.xlsx', '.xls', '.epub', '.pptx', '.pdf']);
FTM.RTF_EXTENSION = new Set(['.rtf']);

FTM.MAGIC_SIGNATURES = [
  { bytes: [0x50, 0x4B, 0x03, 0x04], name: 'ZIP/DOCX/XLSX/PPTX/EPUB' },
  { bytes: [0x25, 0x50, 0x44, 0x46], name: 'PDF' },
  { bytes: [0xD0, 0xCF, 0x11, 0xE0], name: 'OLE2 (legacy DOC/XLS)' },
  { bytes: [0x7B, 0x5C, 0x72, 0x74, 0x66], name: 'RTF' },
  { bytes: [0x1F, 0x8B], name: 'GZIP' },
  { bytes: [0x42, 0x5A, 0x68], name: 'BZIP2' },
];
