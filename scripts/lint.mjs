import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const appRoots = ['assets', 'lib', 'workers'];
const forbidden = [
  [/\beval\s*\(/, 'eval is forbidden'],
  [/\bnew\s+Function\b/, 'new Function is forbidden'],
  [/\.innerHTML\s*=/, 'innerHTML assignment is forbidden'],
  [/\.outerHTML\s*=/, 'outerHTML assignment is forbidden'],
  [/document\.write\s*\(/, 'document.write is forbidden'],
  [/https?:\/\//, 'remote URL found in executable application source']
];
const executable = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (['.js', '.mjs'].includes(extname(entry.name))) executable.push(path);
  }
}
for (const dir of appRoots) await walk(join(root, dir));
let failed = false;
for (const path of executable) {
  const source = await readFile(path, 'utf8');
  for (const [pattern, message] of forbidden) {
    if (pattern.test(source)) { console.error(`${relative(root, path)}: ${message}`); failed = true; }
  }
}
if (failed) process.exit(1);
console.log(`Security lint passed across ${executable.length} executable application files.`);
