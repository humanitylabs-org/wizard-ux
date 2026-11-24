// Every skin (Miguel's included) runs the stock phone dock: the symmetric three-slots-a-side dock left with the retired
// Mizel layout (2 Nov 2026). Core never carries its markup or styles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { withoutApprovedOrbIcon } from './approved-orb-icon-css.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { phoneDock } from './fixtures/phone-dock-harness.mjs';
import vm from 'node:vm';
const web = new URL('../web/', import.meta.url);
const read = p => withShellParts(readFileSync(new URL(p, web), 'utf8'));

test('renderDots builds the stock dock on every skin', () => {
  const d = phoneDock({ count: 8, idx: 5, filled: [4] });
  d.render();
  assert.equal(d.els.dotsL.className, 'desk-dots left'); assert.equal(d.els.dotsR.className, 'desk-dots right');
  const ids = h => [...h.matchAll(/data-goto="(\d+)"/g)].map(m => +m[1]);
  assert.deepEqual(ids(d.els.dotsL.innerHTML), [0, 2, 3, 4], 'Home, then the three desks left of the one in view');
  assert.match(d.els.dotsL.innerHTML, /<i class="dmore"><\/i>/, 'more desks between Home and those');
  assert.deepEqual(ids(d.els.dotsR.innerHTML), [6, 7]);
  assert.match(d.els.dotsR.innerHTML, /class="ddot sig dplus" data-plus aria-label="New desk: pick an app"/);
  assert.match(d.els.dotsL.innerHTML, /class="ddot sig filled" data-goto="4"/);
  for (const h of [d.els.dotsL.innerHTML, d.els.dotsR.innerHTML]) assert.doesNotMatch(h, /desk-dots left sym|class="ddot sig dplus dnew"|class="dslot"/);
  // the sheet a dock opens is marked on the device and cleared on close (app-deskset.js / app.js)
  const set = readFileSync(new URL('../web/app-deskset.js', import.meta.url), 'utf8'), app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const device = { dataset: {}, classList: { add() {}, remove() {} } };
  const open = set.slice(set.indexOf('    appVars.sheet = which;'), set.indexOf('\n', set.indexOf('    appVars.sheet = which;')));
  const close = app.slice(app.indexOf('    const was = sheet; sheet = null;'), app.indexOf('\n', app.indexOf('    const was = sheet; sheet = null;')));
  vm.runInNewContext(open, { appVars: {}, device, which: 'launcher', tourEv() {} });
  assert.equal(device.dataset.sheet, 'launcher');
  vm.runInNewContext(close, { sheet: 'launcher', device, tourEv() {} });
  assert.equal(device.dataset.sheet, undefined);
});

test('core CSS never styles the symmetric dock or the orb X', () => {
  for (const f of readdirSync(new URL('core/', web)).filter(f => f.endsWith('.css')).map(f => `core/${f}`).concat(['styles.css'])) {
    const src = withoutApprovedOrbIcon(read(f));
    assert.ok(!/\.desk-dots\.sym|\.dnew\b|data-sheet="launcher"/.test(src), `${f} must not carry our skins' dock`);
  }
});
