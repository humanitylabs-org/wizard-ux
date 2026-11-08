// Every skin (Miguel's included) runs the stock phone dock: the symmetric three-slots-a-side dock left with the retired
// Mizel layout (2 Nov 2026). Core never carries its markup or styles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { withoutApprovedOrbIcon } from './approved-orb-icon-css.mjs';
const web = new URL('../web/', import.meta.url);
const read = p => readFileSync(new URL(p, web), 'utf8');

test('renderDots builds the stock dock on every skin', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /desk-dots left sym|class="ddot sig dplus dnew"|class="dslot"/);
  assert.match(app, /\$\('#dotsL'\)\.className = 'desk-dots left'; \$\('#dotsR'\)\.className = 'desk-dots right';/);
  assert.match(app, /device\.dataset\.sheet = which/);
  assert.match(app, /delete device\.dataset\.sheet/);
});

test('core CSS never styles the symmetric dock or the orb X', () => {
  for (const f of readdirSync(new URL('core/', web)).filter(f => f.endsWith('.css')).map(f => `core/${f}`).concat(['styles.css'])) {
    const src = withoutApprovedOrbIcon(read(f));
    assert.ok(!/\.desk-dots\.sym|\.dnew\b|data-sheet="launcher"/.test(src), `${f} must not carry our skins' dock`);
  }
});
