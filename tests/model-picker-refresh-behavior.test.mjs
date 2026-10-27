import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
function harness(kind, explicit = false) {
  const paints = [], state = explicit ? { newModel: { model: 'chosen', provider: 'p' } } : {};
  const w = { id: 'win', thread: '__new__', ...(kind === 'main' ? {} : { agent: kind }) };
  let defaultModel = 'old', release;
  const ready = new Promise(r => { release = () => { defaultModel = 'fresh'; r(); }; });
  const el = { querySelectorAll: () => [], insertAdjacentHTML() {}, querySelector: () => null };
  const M = { ready: true, stale: () => true, load: () => ready,
    defaultOption: () => ({ value: defaultModel, provider: 'p' }),
    sheetHtml: opt => { paints.push(JSON.parse(JSON.stringify(opt))); return { list: [], html: '<div></div>' }; } };
  const ctx = { setTimeout, clearTimeout, console, localStorage: { getItem: () => null },
    document: { addEventListener() {} }, addEventListener() {},
    WizCore: { esc: String, clip: String }, WizConfig: { agent: () => 'Wizard' },
    WizLive: { session: () => null }, WosModels: M,
    WosAgents: { isOther: id => id !== 'main', get: id => ({ id }), route: () => ({ model: 'agent-pinned', provider: 'configured' }) } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, H: { win: () => w, root: () => el },
    owner: id => id, winAgent: win => win.agent || '', elOf: () => el, closeRowSheet() {}, vib() {}, toast() {} });
  const open = () => api.click({ target: { closest: s => s === '[data-chmodel]' ? {} : null } }, 'win');
  return { paints, open, release, api, w };
}
for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
  test(`sign-in model refresh repaints the ${kind} picker without switching its agent`, async () => {
    const h = harness(kind); h.open(); assert.equal(h.paints.length, 1);
    h.release(); await new Promise(r => setImmediate(r));
    assert.equal(h.paints.length, 2);
    assert.equal(h.paints[1].cur.model, kind === 'main' ? 'fresh' : 'agent-pinned');
    assert.equal(h.paints[1].agent?.id || 'main', kind);
  });
}
test('a newly loaded default never overrides an explicit draft choice', async () => {
  const h = harness('main', true); h.open(); h.release(); await new Promise(r => setImmediate(r));
  assert.equal(h.paints.at(-1).cur.model, 'chosen');
});
test('a closed picker is not resurrected when sign-in refresh finishes', async () => {
  const h = harness('main'); h.open(); h.api.closeSheet(); h.release(); await new Promise(r => setImmediate(r));
  assert.equal(h.paints.length, 1);
});
test('a refresh finishing after navigation never repaints a different thread', async () => {
  const h = harness('main'); h.open(); h.w.thread = 'another-thread'; h.release(); await new Promise(r => setImmediate(r));
  assert.equal(h.paints.length, 1);
});
