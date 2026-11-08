import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const web = new URL('../web/', import.meta.url);
const read = f => readFileSync(new URL(f, web), 'utf8');

test('the pill Desks panel is never core CSS; skin rules that paint it stay skin-scoped', () => {
  for (const [dir, pre] of [['obsidian', 'html[data-skin^="obsidian"]'], ['landscapes', 'html[data-skin^="landscapes"]']]) {
    const css = read(`skins/${dir}/skin.css`);
    for (const line of css.split('\n').filter(l => /\.ov[-.\s]/.test(l) && /ov-(pill|badge|cell|close|ic|nm|sheet|scroll)/.test(l))) {
      assert.ok(line.startsWith(pre) || line.startsWith('html[data-skin="obsidian-light"]') || line.startsWith('@keyframes') || /^\s|^\/\*| \*/.test(line), line.slice(0, 100));
    }
  }
  for (const f of readdirSync(new URL('core/', web)).filter(f => f.endsWith('.css')).map(f => `core/${f}`).concat(['styles.css'])) {
    const src = read(f);
    for (const k of ['ov-pill', 'ov-badge', 'ov-cell', 'ov-close']) assert.ok(!src.includes(k), `${f} must not carry ${k} (skin-only)`);
  }
});

test('no skin forces the pill desks panel or per-desk badges; the orb swipe-up still opens it when asked', () => {
  const js = read('app.js');
  assert.doesNotMatch(js, /oursSkin|ov-badge/);
  assert.match(js, /if \(G\.upDesks && !sheet\) \{[\s\S]{0,200}openOverview\('pill'\)/);
  assert.match(js, /g\.upDesks && g\.mode === 'v' && !sheet\) \{ if \(g\.dy < -70[^}]*openOverview\('pill'\)/);
  assert.match(js, /G\.upDesks = orbUpDesks\(\)/);
});

test('any skin (or My skin) can send the orb swipe-up to Desks with --wos-orb-swipe-up: desks', () => {
  const js = read('app.js');
  assert.match(js, /getPropertyValue\('--wos-orb-swipe-up'\)\.trim\(\)/);
  assert.match(js, /const orbUpDesks = \(\) => \['desks', 'pill'\]\.includes\(orbUpVar\(\)\)/);
  assert.match(js, /const pill = mode === 'pill' && orbUpVar\(\) === 'pill'/);
});
