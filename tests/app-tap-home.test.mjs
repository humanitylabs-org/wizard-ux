// Tapping the app in front takes it to its first view (wizard-ux issue 1332, on for everyone). The app SDK's Home
// (web/core/app-client.js): the app's own WizardApp.nav.onHome first, then every Back step at once, a history adapter
// in one traversal; the narrow desktop's tap uses it.
// Browser proof: tests/qa-desktop-one-app-home.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appClient } from './fixtures/app-client-harness.mjs';
import { deskWorld, layout, El, FakePointerEvent } from './fixtures/ai-apps-world.mjs';

import fs from 'node:fs';

const ID = 'wizard/app-tap-home';
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

// The narrow desktop's tap on the app already in front, on the real AI apps desktop view (tests/fixtures/ai-apps-world).
async function narrowTap({ stale = false, answer = 'handled', width = 900 }) {
  const had = globalThis.innerWidth, hadS = globalThis.WizAppServices;
  globalThis.innerWidth = width;
  try {
    const { w } = deskWorld();
    w.api.nav.goDesk = i => { w.st.gone.push(i); w.st.route = { home: false, view: 'desk', thread: null, desk: i }; w.emit('route', w.st.route); };
    const stage = new El('div'); stage.id = 'stage';
    const chatDesk = new El('div'); chatDesk.className = 'wsp'; chatDesk.dataset.ws = '1'; const dchats = new El('div'); dchats.className = 'dchats'; dchats.dataset.thread = 'r1'; chatDesk.append(dchats);
    const appDesk = new El('div'); appDesk.className = 'wsp'; appDesk.dataset.ws = '5'; const frame = new El('iframe'); appDesk.append(frame);
    stage.append(chatDesk, appDesk); w.html.children[0].append(stage);
    const calls = [];
    globalThis.WizAppServices = { home: f => { calls.push(['home', f === frame]); return answer; }, back: f => { calls.push(['back', f === frame]); return 'atRoot'; } };
    if (stale) w.html.dataset.tweaks = ID;
    (await layout()).default(w.api);
    w.st.route = { home: false, view: 'desk', thread: null, desk: 5 }; w.emit('route', w.st.route); w.run();
    assert.equal(w.html.dataset.aadOne, width < 1100 ? 'app' : undefined);
    const gone = w.st.gone.length;
    w.qa('.aad-vtl .aad-vtab').find(t => t.dataset.app === 'notes').dispatchEvent(new FakePointerEvent('click'));
    return { calls, moved: w.st.gone.slice(gone), front: w.html.dataset.aadOne };
  } finally {
    if (had === undefined) delete globalThis.innerWidth; else globalThis.innerWidth = had;
    if (hadS === undefined) delete globalThis.WizAppServices; else globalThis.WizAppServices = hadS;
  }
}

test('narrow desktop: tapping the app in front asks it for Home once, and it stays in front', async () => {
  const r = await narrowTap({});
  assert.deepEqual(r.calls, [['home', true]], 'Home on the app\'s own frame, no Back steps');
  assert.deepEqual(r.moved, [], 'no desk change'); assert.equal(r.front, 'app');
  const later = await narrowTap({ answer: 'pending' });
  assert.deepEqual(later.calls, [['home', true]], 'a sandboxed app answers later: still no Back steps');
});

test('narrow desktop, an app with no Home (older SDK, off-origin): today\'s Back steps', async () => {
  const r = await narrowTap({ answer: 'unsupported' });
  assert.deepEqual(r.calls.map(c => c[0]), ['home', 'back']);
});

test('the switch is gone: no package, no catalog entry, no help line, a stale saved choice is cleared', () => {
  assert.equal(fs.existsSync(new URL('../web/tweaks/wizard/app-tap-home', import.meta.url)), false);
  assert.ok(!JSON.parse(fs.readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8')).tweaks.includes(ID));
  assert.ok(!fs.readFileSync(new URL('../skill/help.json', import.meta.url), 'utf8').includes(ID));
  assert.match(fs.readFileSync(new URL('../web/core/experience.js', import.meta.url), 'utf8'), /const GONE = \[[^\]]*'wizard\/app-tap-home'/);
  assert.ok(!fs.readFileSync(new URL('../web/layouts/ai-apps/desktop-tabs.js', import.meta.url), 'utf8').includes(ID), 'the tap no longer reads a switch');
});

test('a leftover switch attribute changes nothing: the tap still asks for Home', async () => {
  const r = await narrowTap({ stale: true });
  assert.deepEqual(r.calls, [['home', true]]);
  assert.deepEqual(r.moved, []); assert.equal(r.front, 'app');
});
