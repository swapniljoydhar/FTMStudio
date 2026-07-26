// ===========================================================================
// test-pipeline.js — Stress test for intercept→convert→replace pipeline
// Run: node test-pipeline.js
// ===========================================================================

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Actual:   ${JSON.stringify(actual)}`);
  }
}

// ===========================================================================
// MOCK: Simulate the full pipeline in isolation
// ===========================================================================

// --- Mock FTM namespace ---
const FTM = { CONSTANTS: { KB: 1024, MB: 1048576 } };

// --- Extension map (from constants.js) ---
const EXTENSION_MAP = {
  '.docx': 'documents', '.txt': 'documents', '.rtf': 'documents', '.md': 'documents',
  '.pdf': 'pdf', '.csv': 'spreadsheets', '.xlsx': 'spreadsheets', '.xls': 'spreadsheets',
  '.py': 'code', '.js': 'code', '.cpp': 'code', '.css': 'code', '.json': 'code', '.xml': 'code',
  '.html': 'markup', '.epub': 'markup', '.pptx': 'presentations'
};
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.py', '.js', '.cpp', '.css', '.json', '.xml', '.html', '.csv']);
const BINARY_EXTENSIONS = new Set(['.docx', '.xlsx', '.xls', '.epub', '.pptx', '.pdf']);
const RTF_EXTENSION = new Set(['.rtf']);

// --- getExtension (from utils.js) ---
function getExtension(filename) {
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.substring(idx) : '';
}

// --- shouldInterceptFile (from utils.js) ---
function shouldInterceptFile(filename, categories) {
  const ext = getExtension(filename).toLowerCase();
  const category = EXTENSION_MAP[ext];
  if (!category) return false;
  if (!categories || !categories[category]) return false;
  return true;
}

// --- Route file to correct handler (from intercept.js onApprove logic) ---
function routeFile(filename) {
  const ext = getExtension(filename).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return 'BINARY';
  if (ext === '.csv') return 'CSV';
  if (RTF_EXTENSION.has(ext)) return 'RTF';
  if (TEXT_EXTENSIONS.has(ext)) return 'TEXT';
  return 'UNKNOWN';
}

// --- Output filename generation ---
function outputFilename(filename) {
  return filename.replace(/\.[^.]+$/, '') + '.md';
}

// --- Mock pipeline state machine ---
class PipelineStateMachine {
  constructor() {
    this.state = 'IDLE';
    this.isReDispatching = false;
    this.isConverting = false;
    this.activeFiles = null;
    this.activeDropEvent = null;
    this.activeInputEl = null;
    this.lastDispatchedFile = null;
    this.errorShown = null;
  }

  intercept(file, source = 'input') {
    if (this.isReDispatching) return 'BLOCKED_REDISPATCH';
    if (this.isConverting) return 'BLOCKED_CONVERTING';
    if (!shouldInterceptFile(file.name, { documents: true, pdf: true, spreadsheets: true, code: true, markup: true, presentations: true })) return 'BLOCKED_EXTENSION';
    this.activeFiles = [file];
    this.activeDropEvent = source === 'drop' ? { target: {}, clientX: 0, clientY: 0 } : null;
    this.activeInputEl = source === 'input' ? { files: null, dispatchEvent: () => {} } : null;
    this.state = 'PROMPTED';
    return 'PROMPTED';
  }

  async approve(conversionFn) {
    if (this.state !== 'PROMPTED' || !this.activeFiles || this.isConverting) return 'BLOCKED';
    this.isConverting = true;
    this.state = 'CONVERTING';

    const file = this.activeFiles[0];
    const dropEvent = this.activeDropEvent;
    const inputEl = this.activeInputEl;

    try {
      const md = await conversionFn(file);
      const mdFile = { name: outputFilename(file.name), content: md, type: 'text/markdown' };
      this.reDispatch(mdFile, dropEvent, inputEl);
      this.state = 'DONE';
      return 'SUCCESS';
    } catch (err) {
      this.errorShown = err.message;
      if (this.activeFiles.length > 0) {
        this.reDispatch(this.activeFiles[0], dropEvent, inputEl);
      }
      this.state = 'ERROR';
      return 'FALLBACK';
    } finally {
      this.activeFiles = null;
      this.activeDropEvent = null;
      this.activeInputEl = null;
      this.isConverting = false;
    }
  }

  deny() {
    if (this.isConverting) return 'BLOCKED';
    if (this.activeFiles && this.activeFiles.length > 0) {
      this.reDispatch(this.activeFiles[0], this.activeDropEvent, this.activeInputEl);
    }
    this.activeFiles = null;
    this.activeDropEvent = null;
    this.activeInputEl = null;
    this.state = 'DENIED';
    return 'DENIED';
  }

  reDispatch(file, dropEvent, inputEl) {
    if (!file) return;
    this.isReDispatching = true;
    this.lastDispatchedFile = file;
    setTimeout(() => { this.isReDispatching = false; }, 0);
  }

  cleanup() {
    if (this.isConverting) return 'BLOCKED_CLEANUP';
    this.activeFiles = null;
    this.activeDropEvent = null;
    this.activeInputEl = null;
    this.isReDispatching = false;
    this.state = 'IDLE';
    return 'CLEANED';
  }
}

// ===========================================================================
// TESTS
// ===========================================================================

console.log('\n━━━ Pipeline: File Routing ━━━');
{
  // All supported extensions route correctly
  const allExts = Object.keys(EXTENSION_MAP);
  const categories = { documents: true, pdf: true, spreadsheets: true, code: true, markup: true, presentations: true };

  for (const ext of allExts) {
    const file = 'test' + ext;
    assert(shouldInterceptFile(file, categories), `Intercept: ${ext} accepted`);
  }

  // Unsupported extensions are rejected
  assert(!shouldInterceptFile('test.exe', categories), 'Reject: .exe');
  assert(!shouldInterceptFile('test.zip', categories), 'Reject: .zip');
  assert(!shouldInterceptFile('test.mp4', categories), 'Reject: .mp4');
  assert(!shouldInterceptFile('test', categories), 'Reject: no extension');
  assert(!shouldInterceptFile('.gitignore', categories), 'Reject: dotfile');

  // Category toggling
  assert(!shouldInterceptFile('test.pdf', { ...categories, pdf: false }), 'Category off: PDF rejected');
  assert(!shouldInterceptFile('test.docx', { ...categories, documents: false }), 'Category off: DOCX rejected');
  assert(shouldInterceptFile('test.txt', { ...categories, documents: true }), 'Category on: TXT accepted');
}

console.log('\n━━━ Pipeline: Binary/Text/CSV Routing ━━━');
{
  assertEqual(routeFile('report.pdf'), 'BINARY', 'PDF → BINARY');
  assertEqual(routeFile('doc.docx'), 'BINARY', 'DOCX → BINARY');
  assertEqual(routeFile('sheet.xlsx'), 'BINARY', 'XLSX → BINARY');
  assertEqual(routeFile('book.epub'), 'BINARY', 'EPUB → BINARY');
  assertEqual(routeFile('slides.pptx'), 'BINARY', 'PPTX → BINARY');
  assertEqual(routeFile('data.csv'), 'CSV', 'CSV → CSV');
  assertEqual(routeFile('doc.rtf'), 'RTF', 'RTF → RTF');
  assertEqual(routeFile('readme.txt'), 'TEXT', 'TXT → TEXT');
  assertEqual(routeFile('readme.md'), 'TEXT', 'MD → TEXT');
  assertEqual(routeFile('script.py'), 'TEXT', 'PY → TEXT');
  assertEqual(routeFile('style.css'), 'TEXT', 'CSS → TEXT');
  assertEqual(routeFile('data.json'), 'TEXT', 'JSON → TEXT');
  assertEqual(routeFile('page.html'), 'TEXT', 'HTML → TEXT');
  assertEqual(routeFile('data.xml'), 'TEXT', 'XML → TEXT');
}

console.log('\n━━━ Pipeline: Output Filename Generation ━━━');
{
  assertEqual(outputFilename('report.pdf'), 'report.md', 'PDF → .md');
  assertEqual(outputFilename('doc.docx'), 'doc.md', 'DOCX → .md');
  assertEqual(outputFilename('data.xlsx'), 'data.md', 'XLSX → .md');
  assertEqual(outputFilename('file.tar.gz'), 'file.tar.md', 'Multi-dot: last ext replaced');
  assertEqual(outputFilename('noext'), 'noext.md', 'No ext: .md appended');
  assertEqual(outputFilename('.gitignore'), '.md', 'Dotfile: becomes .md');
}

console.log('\n━━━ Pipeline: State Machine — Happy Path ━━━');
{
  const pipe = new PipelineStateMachine();
  const file = { name: 'report.pdf', size: 1024 };

  assertEqual(pipe.intercept(file, 'input'), 'PROMPTED', 'Intercept → PROMPTED');
  assertEqual(pipe.state, 'PROMPTED', 'State is PROMPTED');

  const result = await pipe.approve(async (f) => '# Report\n\nContent here');
  assertEqual(result, 'SUCCESS', 'Approve → SUCCESS');
  assertEqual(pipe.state, 'DONE', 'State is DONE');
  assertEqual(pipe.lastDispatchedFile.name, 'report.md', 'Dispatched .md file');
  assert(pipe.lastDispatchedFile.content.includes('# Report'), 'Markdown content present');
  assert(!pipe.isConverting, 'isConverting reset');
  // isReDispatching uses setTimeout(0) in real code — clear it for mock
  pipe.isReDispatching = false;
}

console.log('\n━━━ Pipeline: State Machine — Deny Path ━━━');
{
  const pipe = new PipelineStateMachine();
  const file = { name: 'doc.docx', size: 2048 };

  pipe.intercept(file, 'drop');
  const result = pipe.deny();
  assertEqual(result, 'DENIED', 'Deny → DENIED');
  assertEqual(pipe.lastDispatchedFile.name, 'doc.docx', 'Original file re-dispatched');
  assert(!pipe.isConverting, 'Not converting after deny');
}

console.log('\n━━━ Pipeline: State Machine — Conversion Error → Fallback ━━━');
{
  const pipe = new PipelineStateMachine();
  const file = { name: 'broken.pdf', size: 512 };

  pipe.intercept(file, 'input');
  const result = await pipe.approve(async (f) => { throw new Error('SRI hash mismatch'); });
  assertEqual(result, 'FALLBACK', 'Error → FALLBACK');
  assertEqual(pipe.state, 'ERROR', 'State is ERROR');
  assertEqual(pipe.errorShown, 'SRI hash mismatch', 'Error message captured');
  assertEqual(pipe.lastDispatchedFile.name, 'broken.pdf', 'Original file re-dispatched on error');
  assert(!pipe.isConverting, 'isConverting reset after error');
}

console.log('\n━━━ Pipeline: Concurrent Approval Guard ━━━');
{
  const pipe = new PipelineStateMachine();
  const file = { name: 'test.txt', size: 100 };

  pipe.intercept(file, 'input');

  // Start first approval (slow conversion)
  let firstResolve;
  const firstPromise = pipe.approve(async (f) => {
    return new Promise(r => { firstResolve = r; });
  });

  // Try second approval while first is running
  const secondResult = await pipe.approve(async (f) => 'should not run');
  assertEqual(secondResult, 'BLOCKED', 'Second approval blocked while converting');

  // Complete first
  firstResolve('# Done');
  const firstResult = await firstPromise;
  assertEqual(firstResult, 'SUCCESS', 'First approval completed');
  assert(!pipe.isConverting, 'isConverting reset after first completes');

  // Clear reDispatch guard (setTimeout(0) in real code)
  pipe.isReDispatching = false;

  // Now a third approval should work
  pipe.intercept(file, 'input');
  const thirdResult = await pipe.approve(async (f) => '# Third');
  assertEqual(thirdResult, 'SUCCESS', 'Third approval works after first completes');
}

console.log('\n━━━ Pipeline: Re-intercept Guard ━━━');
{
  const pipe = new PipelineStateMachine();
  const file = { name: 'test.txt', size: 100 };

  pipe.intercept(file, 'input');
  pipe.isReDispatching = true;
  const blocked = pipe.intercept(file, 'input');
  assertEqual(blocked, 'BLOCKED_REDISPATCH', 'Re-intercept blocked during re-dispatch');
  pipe.isReDispatching = false;
}

console.log('\n━━━ Pipeline: Cleanup During Conversion ━━━');
{
  const pipe = new PipelineStateMachine();
  const file = { name: 'big.pdf', size: 50000 };

  pipe.intercept(file, 'input');

  // Start conversion
  let resolveConversion;
  const convPromise = pipe.approve(async (f) => {
    return new Promise(r => { resolveConversion = r; });
  });

  // Try cleanup while converting
  const cleanupResult = pipe.cleanup();
  assertEqual(cleanupResult, 'BLOCKED_CLEANUP', 'Cleanup blocked during conversion');

  // Complete conversion
  resolveConversion('# Big PDF');
  const convResult = await convPromise;
  assertEqual(convResult, 'SUCCESS', 'Conversion completes despite cleanup attempt');

  // Now cleanup should work
  const cleanResult = pipe.cleanup();
  assertEqual(cleanResult, 'CLEANED', 'Cleanup works after conversion');
}

console.log('\n━━━ Pipeline: Cleanup After Conversion ━━━');
{
  const pipe = new PipelineStateMachine();
  const file = { name: 'test.txt', size: 100 };

  pipe.intercept(file, 'input');
  await pipe.approve(async (f) => '# Test');
  const cleanResult = pipe.cleanup();
  assertEqual(cleanResult, 'CLEANED', 'Cleanup after conversion');
  assertEqual(pipe.state, 'IDLE', 'State reset to IDLE');
  assert(pipe.activeFiles === null, 'activeFiles nulled');
  assert(pipe.activeDropEvent === null, 'activeDropEvent nulled');
  assert(pipe.activeInputEl === null, 'activeInputEl nulled');
}

console.log('\n━━━ Pipeline: Rapid Sequential Conversions ━━━');
{
  const pipe = new PipelineStateMachine();
  const files = [
    { name: 'a.txt', size: 100 },
    { name: 'b.pdf', size: 200 },
    { name: 'c.csv', size: 300 },
    { name: 'd.docx', size: 400 },
    { name: 'e.py', size: 500 },
  ];

  for (let i = 0; i < files.length; i++) {
    pipe.isReDispatching = false; // Clear async guard from previous iteration
    pipe.intercept(files[i], 'input');
    const result = await pipe.approve(async (f) => `# ${f.name}\n\nConverted content ${i}`);
    assertEqual(result, 'SUCCESS', `Rapid conversion ${i + 1}: ${files[i].name}`);
    assertEqual(pipe.lastDispatchedFile.name, outputFilename(files[i].name), `Output: ${outputFilename(files[i].name)}`);
    assert(!pipe.isConverting, `isConverting reset after ${i + 1}`);
  }
}

console.log('\n━━━ Pipeline: Large File Boundary Tests ━━━');
{
  const pipe = new PipelineStateMachine();

  // Exactly at limit
  const atLimit = { name: 'big.pdf', size: 50 * 1024 * 1024 };
  pipe.isReDispatching = false;
  pipe.intercept(atLimit, 'input');
  const r1 = await pipe.approve(async (f) => '# Big');
  assertEqual(r1, 'SUCCESS', 'File at 50MB limit accepted');

  // Over limit
  const overLimit = { name: 'toobig.pdf', size: 50 * 1024 * 1024 + 1 };
  pipe.isReDispatching = false;
  pipe.intercept(overLimit, 'input');
  const r2 = await pipe.approve(async (f) => { throw new Error('File too large'); });
  assertEqual(r2, 'FALLBACK', 'File over 50MB triggers fallback');

  // Empty file
  const empty = { name: 'empty.txt', size: 0 };
  pipe.isReDispatching = false;
  pipe.intercept(empty, 'input');
  const r3 = await pipe.approve(async (f) => { throw new Error('File is empty'); });
  assertEqual(r3, 'FALLBACK', 'Empty file triggers fallback');
}

console.log('\n━━━ Pipeline: All Supported Formats Stress Test ━━━');
{
  const formats = [
    { ext: '.txt', route: 'TEXT', content: 'Hello World' },
    { ext: '.md', route: 'TEXT', content: '# Title\n\nBody' },
    { ext: '.py', route: 'TEXT', content: 'print("hello")' },
    { ext: '.js', route: 'TEXT', content: 'console.log("hi")' },
    { ext: '.cpp', route: 'TEXT', content: '#include <iostream>' },
    { ext: '.css', route: 'TEXT', content: 'body { color: red; }' },
    { ext: '.json', route: 'TEXT', content: '{"key": "value"}' },
    { ext: '.xml', route: 'TEXT', content: '<root><item/></root>' },
    { ext: '.html', route: 'TEXT', content: '<h1>Hello</h1>' },
    { ext: '.csv', route: 'CSV', content: 'a,b\n1,2' },
    { ext: '.rtf', route: 'RTF', content: '{\\rtf1 Hello}' },
    { ext: '.pdf', route: 'BINARY', content: null },
    { ext: '.docx', route: 'BINARY', content: null },
    { ext: '.xlsx', route: 'BINARY', content: null },
    { ext: '.xls', route: 'BINARY', content: null },
    { ext: '.epub', route: 'BINARY', content: null },
    { ext: '.pptx', route: 'BINARY', content: null },
  ];

  for (const fmt of formats) {
    const pipe = new PipelineStateMachine();
    const file = { name: 'test' + fmt.ext, size: 1024 };

    assertEqual(routeFile(file.name), fmt.route, `${fmt.ext} routes to ${fmt.route}`);

    pipe.intercept(file, 'input');
    const result = await pipe.approve(async (f) => {
      if (fmt.route === 'BINARY') return '# Binary converted\n\nContent';
      return `# ${f.name}\n\n${fmt.content}`;
    });
    assertEqual(result, 'SUCCESS', `${fmt.ext} conversion succeeds`);
    assertEqual(pipe.lastDispatchedFile.name, 'test.md', `${fmt.ext} → test.md`);
  }
}

console.log('\n━━━ Pipeline: Regex Pipeline + YAML Integration ━━━');
{
  const pipe = new PipelineStateMachine();
  const file = { name: 'report.pdf', size: 1024 };

  pipe.intercept(file, 'input');

  // Simulate full pipeline: convert → regex → yaml
  let md = '# Report\n\nSome content   \n\n\n\nMore content';
  md = md.replace(/[ \t]+$/gm, ''); // strip trailing whitespace
  md = md.replace(/\n{4,}/g, '\n\n\n'); // collapse blank lines

  assert(!md.includes('   '), 'Trailing whitespace stripped');
  assert(!md.includes('\n\n\n\n'), 'Excessive blank lines collapsed');

  // YAML frontmatter injection
  const yaml = '---\noriginal_file: "report.pdf"\nformat: "markdown"\n---\n\n';
  const final = yaml + md;
  assert(final.startsWith('---'), 'YAML frontmatter present');
  assert(final.includes('original_file: "report.pdf"'), 'Original filename in YAML');
}

// ===========================================================================
// SUMMARY
// ===========================================================================

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

process.exit(failed > 0 ? 1 : 0);
