// Miguel's skins (Dark, Light, Landscapes): symmetric phone dock, three fixed slots a side, empty-desk New desk icon,
// orb turns into an X while the Apps sheet is open. James's skins keep the stock dock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { withoutApprovedOrbIcon } from './approved-orb-icon-css.mjs';
const web = new URL('../web/', import.meta.url);
const read = p => readFileSync(new URL(p, web), 'utf8');

test('renderDots builds three fixed slots a side only for our skins', () => {
  const app = read('app.js');
  assert.match(app, /if \(\['obsidian', 'obsidian-light', 'landscapes'\]\.includes\(document\.documentElement\.dataset\.skin \|\| ''\)\) \{\n\s+const NEWD/);
  assert.match(app, /\[idx - 3, idx - 2, idx - 1\]/);
  assert.match(app, /\[idx \+ 1, idx \+ 2, idx \+ 3\]/);
  assert.match(app, /class="ddot sig dplus dnew"/);
  assert.match(app, /device\.dataset\.sheet = which/);
  assert.match(app, /delete device\.dataset\.sheet/);
});

test('only our skin packages style the symmetric dock and the orb X', () => {
  for (const dir of ['obsidian', 'landscapes']) {
    const css = read(`skins/${dir}/skin.css`);
    assert.match(css, /\.desk-dots\.sym \{/);
    assert.match(css, /\[data-sheet="launcher"\] \.dock \.orb-wrap::before/);
    assert.match(css, /\.ddot\.dnew \.dsg svg/);
  }
  for (const f of readdirSync(new URL('core/', web)).filter(f => f.endsWith('.css')).map(f => `core/${f}`).concat(['styles.css'])) {
    const src = withoutApprovedOrbIcon(read(f));
    assert.ok(!/\.desk-dots\.sym|\.dnew\b|data-sheet="launcher"/.test(src), `${f} must not carry our skins' dock`);
  }
});
