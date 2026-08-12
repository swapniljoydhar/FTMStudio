// ESLint flat config. The extension sources are classic scripts sharing a
// single FTM namespace, so no-undef is driven by explicit globals.
const BROWSER = {
  self: 'readonly', window: 'readonly', document: 'readonly', location: 'readonly',
  chrome: 'readonly', console: 'readonly', performance: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  fetch: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly', DataTransfer: 'readonly',
  DragEvent: 'readonly', Event: 'readonly', URL: 'readonly', DOMParser: 'readonly', Image: 'readonly',
  addEventListener: 'readonly', crypto: 'readonly', FTM_BROWSER: 'readonly',
  TextDecoder: 'readonly', TextEncoder: 'readonly', btoa: 'readonly', atob: 'readonly',
  HTMLInputElement: 'readonly', importScripts: 'readonly', confirm: 'readonly', Papa: 'readonly', mammoth: 'readonly',
  XLSX: 'readonly', TurndownService: 'readonly', turndownPluginGfm: 'readonly'
};

const NODE = {
  require: 'readonly', module: 'writable', __dirname: 'readonly', process: 'readonly',
  Buffer: 'readonly', console: 'readonly', performance: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly', Blob: 'readonly'
};

const RULES = {
  'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
  'no-undef': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  'no-implied-eval': 'error',
  'no-eval': 'error',
  'no-new-func': 'error',
  'no-prototype-builtins': 'error',
  'no-console': ['error', { allow: ['warn', 'error'] }]
};

export default [
  { ignores: ['file-to-markdown-extension/lib/**', 'node_modules/**'] },
  {
    files: ['file-to-markdown-extension/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: BROWSER },
    rules: { ...RULES, 'max-lines-per-function': ['error', { max: 25, skipBlankLines: true, skipComments: true }] }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: NODE },
    rules: { ...RULES, 'no-console': 'off' }
  }
];
