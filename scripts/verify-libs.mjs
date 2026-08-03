import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), 'file-to-markdown-extension', 'lib');
const lock = JSON.parse(await readFile(join(root, 'lockfile.json'), 'utf8'));
const failures = [];

async function verify(name, expected) {
  const path = join(root, name);
  try {
    const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== expected.sha256_hex || info.size !== expected.size) failures.push(name);
    console.log(`${hash === expected.sha256_hex && info.size === expected.size ? 'OK' : 'MISMATCH'} ${name}`);
  } catch (_) {
    failures.push(name);
    console.log(`MISSING ${name}`);
  }
}

for (const [name, expected] of Object.entries(lock.libraries)) await verify(name, expected);
if (failures.length) throw new Error(`Library verification failed: ${failures.join(', ')}`);
console.log(`Verified ${Object.keys(lock.libraries).length} pinned libraries.`);
