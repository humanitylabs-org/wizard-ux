// Tapping the app in front takes it to its first view (wizard-ux issue 1332, switch wizard/app-tap-home, off by
// default). The app SDK's Home (web/core/app-client.js): the app's own WizardApp.nav.onHome first, then every Back step
// at once, a history adapter in one traversal; the narrow desktop's tap uses it only while the switch is on.
// Browser proof: tests/qa-desktop-one-app-home.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appClient } from './fixtures/app-client-harness.mjs';

const ID = 'wizard/app-tap-home';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const shellSide = () => appClient({ service: { nav: {} } });

test('Home with nothing open: false (already at its first view)', () => {
  const h = shellSide();
  assert.equal(typeof h.client().home, 'function', 'the shell gets Home with the client');
  assert.equal(h.client().home(), false);
});

test('Home without onHome: every registered Back step at once, overlays first, never past the root', () => {
  const h = shellSide(), steps = [];
  let views = 3;
  h.api.back.register({ canGoBack: () => views > 0, back: () => { views--; steps.push('view'); return true; } });
  let sheet = true;
  h.api.back.push(() => { sheet = false; steps.push('sheet'); return true; });
  assert.equal(h.client().home(), true);
  assert.deepEqual(steps, ['sheet', 'view', 'view', 'view']);
  assert.equal(sheet, false); assert.equal(views, 0);
  assert.equal(h.client().home(), false, 'a second tap at the first view changes nothing');
});

test('Home stops at an overlay that keeps itself open (unsaved changes)', () => {
  const h = shellSide();
  let views = 2;
  h.api.back.register({ canGoBack: () => views > 0, back: () => { views--; return true; } });
  h.api.back.push(() => false);
  assert.equal(h.client().home(), false);
  assert.equal(views, 2, 'nothing behind the overlay moved');
});

test('Home on a history adapter: one traversal straight to its first entry (Back would take one step per tap)', () => {
  const h = shellSide(), calls = [];
  const hist = { state: null, length: 1, pushState(s) { this.state = s; calls.push('push'); }, replaceState(s) { this.state = s; }, back() { calls.push('back'); }, go(n) { calls.push('go ' + n); } };
  h.ctx.history = hist;
  let depth = 0;
  h.api.back.useHistory({ isRoot: () => depth === 0 });
  for (let i = 0; i < 3; i++) { depth++; hist.pushState({ lvl: depth }, '', '?l=' + depth); }
  assert.equal(h.client().home(), true);
  assert.deepEqual(calls.filter(c => c !== 'push'), ['go -3'], 'one traversal of all three pages');
  assert.equal(h.client().home(), true, 'still on its way (the popstate has not arrived): no second traversal');
  assert.deepEqual(calls.filter(c => c !== 'push'), ['go -3']);
});

test('onHome: true = the app is home (no Back step); false = its Back steps run too; unregister = gone', () => {
  const h = shellSide(), steps = [];
  let views = 1, done = true;
  h.api.back.register({ canGoBack: () => views > 0, back: () => { views--; steps.push('view'); return true; } });
  const off = h.api.nav.onHome(() => { steps.push('home'); return done; });
  assert.equal(h.client().home(), true);
  assert.deepEqual(steps, ['home']); assert.equal(views, 1);
  done = false;
  assert.equal(h.client().home(), true);
  assert.deepEqual(steps, ['home', 'home', 'view']);
  off(); views = 0;
  assert.equal(h.client().home(), false);
  assert.deepEqual(steps, ['home', 'home', 'view'], 'unregistered');
  assert.throws(() => h.api.nav.onHome('x'), e => e.name === 'TypeError');
});

test('an onHome that throws is not home: the Back steps still run', () => {
  const h = shellSide();
  let views = 1;
  h.api.back.register({ canGoBack: () => views > 0, back: () => { views--; return true; } });
  h.api.nav.onHome(() => { throw new Error('boom'); });
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(h.client().home(), true); } finally { console.warn = warn; }
  assert.equal(views, 0);
});

test('the narrow desktop tap: Home only while the switch is on; off (or no Home) = today\'s Back steps', () => {
  const src = read('web/layouts/ai-apps/desktop-tabs.js');
  assert.match(src, /if \(one\(\) && aadVars\.pane && Number\(aadVars\.pane\.desk\) === d\.desk\) \{ if \(!homeOn\(\) \|\| !appHome\(\)\) appTop\(\); return; \}/);
  assert.ok(src.includes(`.split(' ').includes('${ID}')`), 'the switch is read inline');
  assert.match(src, /return S\.home\(f\) !== 'unsupported';/);
  const svc = read('web/core/app-services.js');
  assert.match(svc, /version: VERSION, claimShare, attach, connect, back, home, guardBack,/);
});

test('the switch is listed, off by default, linked to its issue', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(ID));
  assert.ok(!cat.defaults.includes(ID));
  const m = JSON.parse(read('web/tweaks/wizard/app-tap-home/manifest.json'));
  assert.equal(m.id, ID); assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1332']);
  const css = read('web/tweaks/wizard/app-tap-home/tweak.css');
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.trim()).filter(Boolean)) assert.ok(rule.startsWith(`html[data-tweaks~="${ID}"]`), rule);
});
