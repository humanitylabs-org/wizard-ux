import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const web = new URL('../web/', import.meta.url);
const read = f => readFileSync(new URL(f, web), 'utf8');

test('Desks overview restyle (smaller cards, badges, grown pill) lives only in Miguel\'s skin packages', () => {
  for (const [dir, pre] of [['obsidian', 'html[data-skin^="obsidian"]'], ['landscapes', 'html[data-skin="landscapes"]']]) {
    const css = read(`skins/${dir}/skin.css`);
    for (const sel of ['.ov.ov-pill .ov-sheet', '.ov.ov-pill .ov-close', '.ov .ov-badge', '.ov .ov-grid { grid-template-columns: repeat(3']) assert.ok(css.includes(sel), `${dir} styles ${sel}`);
    for (const line of css.split('\n').filter(l => /\.ov[-.\s]/.test(l) && /ov-(pill|badge|cell|close|ic|nm|sheet|scroll)/.test(l))) {
      assert.ok(line.startsWith(pre) || line.startsWith('html[data-skin="obsidian-light"]') || line.startsWith('@keyframes') || /^\s|^\/\*| \*/.test(line), line.slice(0, 100));
    }
  }
  for (const f of readdirSync(new URL('core/', web)).filter(f => f.endsWith('.css')).map(f => `core/${f}`).concat(['styles.css'])) {
    const src = read(f);
    for (const k of ['ov-pill', 'ov-badge', 'ov-cell', 'ov-close']) assert.ok(!src.includes(k), `${f} must not carry ${k} (skin-only)`);
  }
});

test('app.js gates the pill desks panel and per-desk badges on Miguel\'s three skins', () => {
  const js = read('app.js');
  assert.match(js, /const pill = mode === 'pill' && oursSkin\(\)/);
  assert.match(js, /if \(!oursSkin\(\)\) return ''; const n = window\.WizCore\?\.workspaceNav\?\.deskCount/);
  assert.match(js, /if \(G\.upDesks && !sheet\) \{[\s\S]{0,200}openOverview\('pill'\)/);
  assert.match(js, /g\.upDesks && g\.mode === 'v' && !sheet\) \{ if \(g\.dy < -70[^}]*openOverview\('pill'\)/);
  assert.match(js, /G\.upDesks = orbUpDesks\(\)/);
});

test('any skin (or My skin) can send the orb swipe-up to Desks with --wos-orb-swipe-up: desks', () => {
  const js = read('app.js');
  assert.match(js, /const orbUpDesks = \(\) => oursSkin\(\) \|\| [\s\S]{0,120}getPropertyValue\('--wos-orb-swipe-up'\)\.trim\(\) === 'desks'/);
  // The pill look stays Miguel's: another skin gets the regular Desks overview.
  assert.match(js, /const pill = mode === 'pill' && oursSkin\(\)/);
});
