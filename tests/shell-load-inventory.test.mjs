import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
// Each shell loads only its own layout code (James, 6 Nov 2026: trim what each shell loads).
const root = fileURLToPath(new URL('../', import.meta.url));
const { rows } = JSON.parse(execFileSync(process.execPath, ['tools/shell-load-inventory.mjs', 'web', '--json'], { cwd: root, encoding: 'utf8' }));
const of = name => rows.find(r => r.shell === name);
const has = (r, re) => r.files.filter(f => re.test(f));

test('every counted file exists (the inventory reads real entries)', () => {
  for (const r of rows) assert.deepEqual(r.missing, [], r.shell);
});
test('AI apps desktop loads its own entry only: never the phone layout or a second copy of a classic script', () => {
  const r = of('desktop-ai-apps');
  assert.deepEqual(has(r, /^layouts\/ai-apps\/layout\.(js|css)$/), []);
  assert.ok(r.files.includes('layouts/ai-apps/desktop.js') && r.files.includes('layouts/ai-apps/desktop-boot.css') && r.files.includes('layouts/ai-apps/desktop.css'));
  assert.deepEqual(r.dupModules, [], 'core scripts the page already ran are not re-fetched as modules');
});
test('Classic desktop loads no layout code at all', () => {
  assert.deepEqual(has(of('desktop-classic'), /^layouts\//), []);
});
test('the phone loads no desktop code: no pane geometry, desktop host, desktop shell or layouts', () => {
  const r = of('phone');
  assert.deepEqual(has(r, /^(layouts\/|desktop\/|core\/desktop-host\.js$|core\/pane-layout\.js$)/), []);
});
test('the phone Orb view loads its phone entry, never the desktop Orb scene', () => {
  const r = of('phone-orb');
  assert.deepEqual(has(r, /^layouts\/orb\/layout\.(js|css)$/), []);
  assert.ok(r.files.includes('layouts/orb/phone.js') && r.files.includes('layouts/orb/phone.css'));
});
