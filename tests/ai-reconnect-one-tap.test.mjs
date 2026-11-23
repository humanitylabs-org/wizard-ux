// A model or account that stopped working is one tap from its fix: Home's "Reconnect" row and an empty slot in
// Miguel's model switch open the connection app straight at Reconnect (`?reconnect=1`), never a dead greyed control.
// Both run the real code (wizard-ux issue 1674: tests run the code, they do not read it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('an empty model-switch slot is tappable and opens its app at the fix', () => {
  const power = read('web/core/chat-power.js'), on = {}, opened = [];
  const w = { id: 'w1', thread: 't1' };
  const ctx = { esc, window: { WizOpenApp: (app, path) => (opened.push([app, path]), true) }, H: { win: () => w, openLink() {} },
    document: { addEventListener: (t, f) => { on[t] = f; } }, LIVE: { session: () => ({ id: 't1' }) },
    M: { ready: true, visible: () => [], options: [], isPrivateRoute: () => false, tinfoilReady: () => false, short: () => 'Model', privateName: () => ({ name: '', version: '' }) },
    agentOfWin: () => false, modelChip: () => '', threadModel: () => ({ model: '', provider: '' }), newModel: () => null, ch: () => ({}), pickModel: async () => {} };
  vm.createContext(ctx);
  vm.runInContext(`${between(power, "  const SW_NAMES = ", '  async function switchTo(')}\n${between(power, '  (() => { // drag the thumb, or tap a position', '\n  let modelsAsked')}\nthis.modelSwitch = modelSwitch;`, ctx);
  const html = ctx.modelSwitch(w, { id: 't1' });
  const slots = [...html.matchAll(/<button type="button" role="radio"[^>]*>/g)].map(m => m[0]);
  assert.equal(slots.length, 4);
  for (const b of slots) { assert.doesNotMatch(b, /\sdisabled[\s>]/, 'an empty slot is not a dead disabled button'); assert.match(b, /aria-disabled="true" data-msfix="/); }
  assert.match(slots[0], /title="Claude needs attention · tap to fix"/);
  // A tap (no drag) on slot i of a 400 px track opens that slot's fix.
  const track = { getBoundingClientRect: () => ({ left: 0, width: 400 }), classList: { add() {}, remove() {} }, parentElement: { dataset: { mswid: 'w1' }, style: { setProperty() {} } } };
  const tap = x => { on.pointerdown({ target: { closest: () => track }, clientX: x }); on.pointerup({ clientX: x }); };
  tap(50); tap(150); tap(350);
  assert.deepEqual(opened, [['wizard-claude', '/wizard-claude/?reconnect=1'], ['wizard-chatgpt', '/wizard-chatgpt/?reconnect=1'], ['wizard-tinfoil', '/wizard-tinfoil/?connect=1']]);
  // A drag that ends on an empty slot is not a tap: nothing opens.
  on.pointerdown({ target: { closest: () => track }, clientX: 300 }); on.pointermove({ clientX: 60 }); on.pointerup({ clientX: 60 });
  assert.equal(opened.length, 3);
});

test('Home reconnect rows open the connection app at Reconnect', () => {
  const on = {}, opened = [];
  const ctx = { document: { documentElement: { dataset: { tweaks: '' } }, hidden: false, addEventListener: (t, f) => { on[t] = f; }, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, AbortController, console, location: { assign: p => opened.push(['assign', p]) } };
  ctx.window = ctx; ctx.addEventListener = () => {};
  ctx.WizOpenApp = (app, path) => (opened.push([app, path]), true);
  vm.runInNewContext(read('web/core/usage.js'), ctx);
  const source = read('web/core/resources.js');
  vm.runInNewContext(source.replace('window.WosResources={', 'globalThis.__resourcesState=S;window.WosResources={'), ctx);
  const snap = ctx.WosUsage.normalize({ providers: [{ id: 'claude:me', provider: 'claude', name: 'Claude', status: 'unavailable', fetchedAt: new Date().toISOString(), limits: [] }, { id: 'chatgpt:me', provider: 'chatgpt', name: 'ChatGPT', status: 'unavailable', fetchedAt: new Date().toISOString(), limits: [] }] });
  ctx.__resourcesState.ai = snap; ctx.WosUsage.snap = snap;
  const home = ctx.WosResources.barsHtml(); // the Home rows (Home "bars"), from the same readings as the dials
  for (const app of ['wizard-claude', 'wizard-chatgpt']) assert.match(home, new RegExp(`data-res-signin="${app}" data-res-reconnect="1"`), app);
  const click = app => on.click({ preventDefault() {}, target: { closest: s => s === '[data-res-signin]' ? { dataset: { resSignin: app }, hasAttribute: k => k === 'data-res-reconnect' } : null } });
  click('wizard-claude'); click('wizard-chatgpt');
  assert.deepEqual(opened, [['wizard-claude', '/wizard-claude/?reconnect=1'], ['wizard-chatgpt', '/wizard-chatgpt/?reconnect=1']]);
});
