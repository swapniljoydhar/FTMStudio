import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(process.cwd(), 'file-to-markdown-extension');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest V3 is required');
const files = [];
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'lib') await collect(path);
    else if (entry.isFile()) files.push(path);
  }
}
await collect(root);
const declared = [...(manifest.background ? [manifest.background.service_worker] : []), manifest.action.default_popup];
for (const file of declared) if (!(await readFile(join(root, file)).catch(() => null))) throw new Error(`Missing manifest file: ${file}`);
for (const file of files.filter((file) => file.endsWith('.js'))) {
  const source = await readFile(file, 'utf8');
  if (/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/.test(source)) throw new Error(`Unsafe sink: ${relative(root, file)}`);
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Syntax error: ${relative(root, file)}`);
}
console.log(`Verified MV3 extension: ${files.length} files`);
