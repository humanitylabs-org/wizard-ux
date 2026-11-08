import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from './fixtures/tweaks.mjs';

// Miguel (2 Nov 2026): no ✕ on the desks in the desktop top bar; right-click a desk → Close desktop stays the way to close.
test('miguel/no-desk-close hides the top-bar desk ✕ only under its own data-tweaks gate', () => {
  const css = read('web/tweaks/miguel/no-desk-close/tweak.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = css.split('}').map(r => r.trim()).filter(Boolean);
  assert.equal(rules.length, 1, 'one rule');
  assert.match(rules[0], /^html\[data-tweaks~="miguel\/no-desk-close"\] \.ws-close \{ display: none !important;$/);
  const m = JSON.parse(read('web/tweaks/miguel/no-desk-close/manifest.json'));
  assert.deepEqual(m.capabilities, ['layout']);
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(m.id)); assert.ok(!cat.defaults.includes(m.id), 'off by default: stock desks keep their ✕');
  assert.ok(JSON.parse(read('web/tweaks/miguel/profile.json')).tweaks.includes(m.id));
});

test('stock desktop still renders the desk ✕ and keeps right-click → Close desktop', () => {
  const desk = read('web/desktop/desktop.js');
  assert.match(desk, /<span class="ws-close" role="button" data-wsclose="\$\{i\}"/, 'the ✕ the tweak hides is stock markup');
  assert.match(desk, /items: \[\{ label: 'Close desktop', action: \(\) => closeDesktop\(ws\.indexOf\(d\)\) \}\]/, 'context menu still closes a desk');
  assert.match(read('web/desktop/desktop.css'), /\.ws:hover \.ws-close, \.ws:focus-visible \.ws-close/);
});
