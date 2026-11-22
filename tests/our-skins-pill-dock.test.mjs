// The core hook (#orbApp, the current desk icon in the orb) and where its styles may live.
// The core hook (#orbApp) is created hidden; James's approved .orb-app rules may also show it; the pill dock stays skin-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { withoutApprovedOrbIcon } from './approved-orb-icon-css.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { phoneDock } from './fixtures/phone-dock-harness.mjs';
const web = new URL('../web/', import.meta.url);
const read = p => withShellParts(readFileSync(new URL(p, web), 'utf8'));

test('core mirrors the current desk icon into a hidden #orbApp', () => {
  const d = phoneDock({ idx: 2 });
  d.render();
  const el = d.els.orbApp;
  assert.ok(el, 'the orb gets its #orbApp');
  assert.equal(el.className, 'orb-app'); assert.equal(el.hidden, true, 'hidden unless a skin shows it');
  assert.equal(el.attrs['aria-hidden'], 'true');
  assert.equal(el.innerHTML, '<span class="dsg">2</span>', 'it shows the current desk');
  d.ctx.appVars.idx = 3; d.render();
  assert.equal(el.innerHTML, '<span class="dsg">3</span>', 'and follows the desk in view');
  assert.equal(d.els.orbWrap.kids.length, 1, 'made once');
});

test('pill dock and #orbApp rules stay skin-scoped, never core; approved owner skins may show #orbApp', () => {
  for (const dir of ['obsidian', 'landscapes']) {
    const css = read(`skins/${dir}/skin.css`);
    for (const line of css.split('\n').filter(l => l.includes('.orb-app') || l.includes('--pill-'))) {
      assert.match(line, /^html\[data-skin(\^="obsidian"|="obsidian-light"|\^="landscapes"|="landscapes-light")\]|^\s|^\/\*| \*/, line.slice(0, 90));
    }
  }
  for (const f of readdirSync(new URL('core/', web)).filter(f => f.endsWith('.css')).concat(['styles.css'])) {
    const src = withoutApprovedOrbIcon(read(f.includes('/') || f === 'styles.css' ? f : `core/${f}`));
    assert.ok(!src.includes('.orb-app'), `${f} must not style .orb-app (skin-only)`);
  }
});
