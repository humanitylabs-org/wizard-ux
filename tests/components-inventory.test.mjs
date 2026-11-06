// docs/COMPONENTS.md must list every shell global and every path it names must exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(root, 'docs/COMPONENTS.md'), 'utf8');
const ticks = new Set([...doc.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`]+)`/g)].flatMap(m => m[1].split(/[\s,;()]+/)));

function sources() {
  const out = [];
  for (const dir of ['web/core', 'web', 'web/motion']) {
    for (const f of readdirSync(join(root, dir))) if (f.endsWith('.js')) out.push(join(dir, f));
  }
  return out;
}

test('every exported shell global has a COMPONENTS.md entry', () => {
  const missing = [];
  for (const f of sources()) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(/\b(?:window|W)\.((?:Wos|Wiz|Wizard)[A-Z]\w*|Orb)\s*=(?!=)/g)) {
      const g = m[1];
      if (![...ticks].some(t => t === g || t.startsWith(g + '.'))) missing.push(`${g} (${f})`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'Add a row (or a Shell plumbing entry) to docs/COMPONENTS.md for: ' + missing.join(', '));
});

test('every path COMPONENTS.md names exists', () => {
  const paths = [...ticks].filter(t => /^(web|android|docs|tools|tests)\//.test(t));
  assert.ok(paths.length > 20);
  const gone = paths.filter(p => !existsSync(join(root, p)));
  assert.deepEqual(gone, [], 'COMPONENTS.md names missing files');
});

test('COMPONENTS.md stays short enough to paste into a worker brief', () => {
  assert.ok(Buffer.byteLength(doc) < 14000, `COMPONENTS.md is ${Buffer.byteLength(doc)} bytes`);
});
