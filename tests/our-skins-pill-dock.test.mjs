// My release (html[data-mine], every skin): floating pill dock, plain orb carrying the current app icon.
// The core hook (#orbApp) is created hidden; only the release layer shows it, the stock shell stays as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const web = new URL('../web/', import.meta.url);
const read = p => readFileSync(new URL(p, web), 'utf8');

test('core mirrors the current desk icon into a hidden #orbApp', () => {
  const app = read('app.js');
  assert.match(app, /el\.id = 'orbApp'; el\.className = 'orb-app'; el\.hidden = true/);
  assert.match(app, /paintOrbApp\(\);/);
});

test('only the release layer styles the pill dock and shows #orbApp (skins may only recolour it)', () => {
  const css = read('mine/mine.css');
  assert.match(css, /floating pill bottom bar/);
  assert.match(css, /\.orb-app:not\(:empty\) \{ display: grid/);
  for (const line of css.split('\n').filter(l => l.includes('.orb-app') || l.includes('--pill-'))) {
    assert.match(line, /^html\[data-mine\]|^\s|^\/\*| \*|^@media/, line.slice(0, 90));
  }
  for (const dir of ['obsidian', 'landscapes']) {
    const sk = read(`skins/${dir}/skin.css`);
    assert.doesNotMatch(sk, /\.orb-app:not\(:empty\) \{ display: grid|--pill-h:/, dir);
  }
  for (const f of readdirSync(new URL('core/', web)).filter(f => f.endsWith('.css')).concat(['styles.css'])) {
    const src = read(f.includes('/') || f === 'styles.css' ? f : `core/${f}`);
    assert.ok(!src.includes('.orb-app'), `${f} must not style .orb-app (skin-only)`);
  }
});
