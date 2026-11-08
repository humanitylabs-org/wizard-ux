import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../web/layouts/ai-apps/', import.meta.url);
const allowed = JSON.parse(readFileSync(new URL('./fixtures/ai-apps-classic-selectors.json', import.meta.url), 'utf8'));
// Count literal selector sites, including interpolated templates and selectors
// passed through helpers. Exact multiplicity prevents new uses of an old selector.
// The allowlist is empty: desktop placement containers come from WizDesktop.host.placements()
// and phone Chats parts from api.phone.chats(). Do not add entries to fix a failing guard.
function classicLiterals(source) {
  const out = [];
  for (const line of source.split('\n')) {
    for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
      if (/(?:^|[\s>+~,])\.(?:win|wsp|wbar|wtools|dchats|desk)\b|#(?:stage|dsettings)\b|^dsettings$/.test(m[2])) out.push(m[2]);
    }
  }
  return out;
}
test('AI apps has no Classic-only selectors (the migration allowlist is empty)', () => {
  const actual = {};
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
    const found = classicLiterals(readFileSync(new URL(file, dir), 'utf8'));
    if (found.length) actual[file] = found;
  }
  assert.deepEqual(actual, allowed, 'Remove migrated entries; do not expand the allowlist.');
});
test('boundary guard detects helper scopes, template selectors and repeated dependencies', () => {
  assert.deepEqual(classicLiterals("scope('.win iframe'); root.querySelector(`.wsp[data-desk=\"${id}\"]`); q('.win iframe')"), ['.win iframe', '.wsp[data-desk="${id}"]', '.win iframe']);
  assert.deepEqual(classicLiterals('const k = `desk:${d.desk}`; q(".aad-pane");'), []);
});
test('phone Chats parts reach the layout as shared WizChatsHost surfaces through the skin host', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const host = readFileSync(new URL('../web/core/skin-host.js', import.meta.url), 'utf8');
  const phone = readFileSync(new URL('../web/layouts/ai-apps/layout.js', import.meta.url), 'utf8');
  assert.match(app, /chatsSurfaces: \(\) => Object\.keys\(W\)\.filter\(id => W\[id\]\?\.app === 'chats'\)\.map\(id => CHATS\.surface\(id\)\)\.filter\(Boolean\)/);
  assert.match(host, /chats: \(\) => \{ const l = live\(\) \? shell\.chatsSurfaces\?\.\(\) : null; return Object\.freeze\(Array\.isArray\(l\) \? l\.filter\(Boolean\) : \[\]\); \}/);
  assert.match(phone, /const chatSurfaces = \(\) => api\.phone\.chats\?\.\(\) \|\| \[\];/);
  assert.match(phone, /globalThis\.WizChatsHost\.placeNotificationRoute\(shownNote\(\)\)/);
});
