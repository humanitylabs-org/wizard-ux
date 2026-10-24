// Miguel's skins (Dark, Light, Landscapes): floating pill dock, plain orb carrying the current app icon.
// Owner-live desk glyphs are accepted too; exact approved core CSS remains fingerprint guarded.
import { test } from 'node:test';
import { createHash } from 'node:crypto';
const approved = JSON.parse(readFileSync(new URL('./fixtures/owner-skins.json', import.meta.url), 'utf8'));
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const web = new URL('../web/', import.meta.url);
const read = p => readFileSync(new URL(p, web), 'utf8');

test('core mirrors the current desk icon into a hidden #orbApp', () => {
  const app = read('app.js');
  assert.match(app, /el\.id = 'orbApp'; el\.className = 'orb-app'; el\.hidden = true/);
  assert.match(app, /paintOrbApp\(\);/);
});

test('pill docks remain skin-only; owner-live core desk glyphs match the approved baseline', () => {
  for (const dir of ['obsidian', 'landscapes']) {
    const css = read(`skins/${dir}/skin.css`);
    assert.match(css, /floating pill bottom bar/);
    assert.match(css, /\.orb-app:not\(:empty\) \{ display: grid/);
    for (const line of css.split('\n').filter(l => l.includes('.orb-app') || l.includes('--pill-'))) {
      assert.match(line, /^html\[data-skin(\^="obsidian"|="obsidian-light"|="landscapes")\]|^\s|^\/\*| \*/, line.slice(0, 90));
    }
  }
  for (const f of readdirSync(new URL('core/', web)).filter(f => f.endsWith('.css')).concat(['styles.css'])) {
    const src = read(f.includes('/') || f === 'styles.css' ? f : `core/${f}`);
    if (f === 'skins.css') {
      assert.equal(createHash('sha256').update(src).digest('hex'), approved.approvedCoreSkinsSha256, 'owner-approved live core glyph baseline drifted');
    } else assert.ok(!src.includes('.orb-app'), `${f} must not style .orb-app (skin-only)`);
  }
});
