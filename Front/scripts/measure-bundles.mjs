import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Read-only artifact comparison. Both directories must come from clean Vite builds
// with the same lockfile and configuration. No browser timing is inferred here.
const [beforePath, afterPath] = process.argv.slice(2);
assert(beforePath && afterPath, 'Usage: node scripts/measure-bundles.mjs BEFORE_DIST AFTER_DIST');

async function measure(directory) {
  const root = resolve(directory);
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const entry = html.match(/<script\s+type="module"[^>]*\bsrc="([^"]+\.js)"/u)?.[1];
  assert(entry && entry.startsWith('/assets/'), 'Expected a local Vite module entry');
  const paths = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter(item => item.isFile() && item.name.endsWith('.js'))
    .map(item => join(item.parentPath, item.name)).sort();
  const files = await Promise.all(paths.map(async path => {
    const bytes = await readFile(path);
    return {
      file: relative(root, path),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length,
      brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    };
  }));
  const initialModuleEntry = files.find(item => item.file === entry.slice(1));
  assert(initialModuleEntry, 'Module entry was not found in output');
  return {
    initialModuleEntry,
    totalEmittedJavaScript: {
      count: files.length,
      ...Object.fromEntries(['bytes', 'gzip', 'brotli'].map(metric =>
        [metric, files.reduce((sum, item) => sum + item[metric], 0)])),
    },
    files,
  };
}

const before = await measure(beforePath);
const after = await measure(afterPath);
console.log(JSON.stringify({
  node: process.version,
  method: 'Per-file gzip level 9 and Brotli quality 11. Entry is the HTML module entry only; total includes lazy chunks and theme-init.js. No network, parse or rendering measurements.',
  before, after,
}, null, 2));
