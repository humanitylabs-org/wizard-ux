import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('../web/layouts/ai-apps/', import.meta.url);
const allowed = JSON.parse(readFileSync(new URL('./fixtures/ai-apps-classic-selectors.json', import.meta.url), 'utf8'));
// Count literal selector sites, including interpolated templates and selectors
// passed through helpers. Exact multiplicity prevents new uses of an old selector.
// layout.js entries are PHONE-only legacy mounts; desktop.js must reach zero as
// native desktop layouts land. Do not add entries to fix a failing guard.
function classicLiterals(source) {
  const out = [];
  for (const line of source.split('\n')) {
    for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
      if (/(?:^|[\s>+~,])\.(?:win|wsp|wbar|wtools|dchats|desk)\b|#(?:stage|dsettings)\b|^dsettings$/.test(m[2])) out.push(m[2]);
    }
  }
  return out;
}
test('AI apps has no Classic-only selectors beyond the shrinking migration allowlist', () => {
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
