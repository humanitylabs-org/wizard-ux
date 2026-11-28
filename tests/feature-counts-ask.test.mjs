// Ask before sharing feature counts (wizard-ux#1817; on for everyone, switch wizard/feature-counts-ask removed): Share feature counts
// (wizard/try-feature-counts) stays off until the owner says Share to one prompt that names what is sent. Runs the real
// counts + ask block of web/core/settings.js in node:vm with a small fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const settings = readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
const between = (a, b) => { const i = settings.indexOf(a), j = settings.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a} .. ${b}`); return settings.slice(i, j); };
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body });
const COUNTS = 'wizard/try-feature-counts';

// A node with just what the prompt uses: listeners, closest(), querySelector by data attribute, remove().
function node(attrs = {}, parent = null) {
  const on = {};
  const n = { attrs, parent, html: '', removed: false, on,
    addEventListener: (t, f) => { (on[t] ||= []).push(f); },
    getAttribute: k => attrs[k] ?? null,
    closest: sel => { for (let x = n; x; x = x.parent) if (Object.keys(x.attrs).some(k => sel === `[${k}]`)) return x; return null; },
    querySelector: sel => { const k = /\[([\w-]+)\]/.exec(sel)?.[1]; return k && n.html.includes(k) ? node({ [k]: '' }, n) : null; },
    remove: () => { n.removed = true; },
    fire: (t, ev) => { for (const f of on[t] || []) f(ev); } };
  return n;
}

function kit({ tweaks = '', fetchImpl = () => res(404, {}), store = {} } = {}) {
  const calls = [], toggles = [], body = [], docOn = {}, winOn = {};
  const documentElement = { dataset: { tweaks } };
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const document = { baseURI: 'https://box.example.ts.net:8444/wizard-os-home/', visibilityState: 'visible', documentElement,
    body: { appendChild: el => { body.push(el); return el; } },
    createElement: () => { const holder = { set innerHTML(h) { const el = node({ 'data-fc-ask': '' }); el.html = h; holder.firstElementChild = el; } }; return holder; },
    querySelectorAll: () => [], addEventListener: (t, f) => { (docOn[t] ||= []).push(f); } };
  const window = { fetch: async (u, i = {}) => { calls.push([u, i]); return fetchImpl(u, i); },
    addEventListener: (t, f) => { (winOn[t] ||= []).push(f); },
    WosExperience: { toggle: async id => { toggles.push(id); const t = new Set(documentElement.dataset.tweaks.split(' ')); t.has(id) ? t.delete(id) : t.add(id); documentElement.dataset.tweaks = [...t].join(' '); } } };
  const ctx = { URL, JSON, Date, Array, String, Set, WeakSet, encodeURIComponent, decodeURIComponent, setTimeout: () => 0, localStorage: ls, document, window,
    esc: s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) };
  vm.createContext(ctx);
  vm.runInContext(between('  const homePath = p =>', '\n  function appSwTake(d)') + '\n'
    + between('  async function appSwFetch(body)', '\n  // A read started before a flip') + '\n'
    + between('  const COUNTS_TWEAK =', '\n  window.WosSettings = {')
    + '\nglobalThis.T = { askIntercept, askLook, askHook, askDone, get el() { return ask.el; } };', ctx);
  const tap = attr => { const el = ctx.T.el; el.fire('click', { target: el.querySelector(`[${attr}]`) }); };
  return { ctx, T: ctx.T, calls, toggles, body, store, docOn, winOn, documentElement, tap };
}
const flush = () => new Promise(r => setImmediate(r));

test('no switch: on any box, with no tweaks on, an app frame gets the thumb listener and Settings asks first', async () => {
  const k = kit({ tweaks: 'wizard/desktop-chats' });
  const frame = { dataset: { ownApp: 'notes' }, contentDocument: node() };
  k.docOn.load[0]({ target: { tagName: 'IFRAME', ...frame } });
  assert.equal(frame.contentDocument.on.click?.length, 1, 'the thumb listener is added to app frames');
  assert.equal(k.T.askIntercept(COUNTS), true);
  assert.equal(k.body.length, 1); assert.equal(k.calls.length, 0);
});

test('turning it on from Settings asks first; Share is the only way on, and nothing is sent before it', async () => {
  const k = kit();
  assert.equal(k.T.askIntercept(COUNTS), true);
  assert.equal(k.body.length, 1);
  const html = k.T.el.html;
  for (const words of ['switch id', 'whether you tried it', 'thumbs up or down', 'a random box id', 'No names, messages or other content', 'nothing that says who you are', 'Don’t share', '>Share<'])
    assert.ok(html.includes(words), words);
  assert.equal(k.T.askIntercept(COUNTS), false, 'one prompt at a time');
  assert.deepEqual(k.toggles, []); assert.equal(k.calls.length, 0, 'nothing read or sent while it waits');
  k.tap('data-fc-ask-yes'); await flush();
  assert.deepEqual(k.toggles, [COUNTS]); assert.ok(k.documentElement.dataset.tweaks.includes(COUNTS));
  assert.equal(k.store['wos.feature-counts.answer.v1'], 'share');
  assert.equal(k.T.el, null);
  assert.equal(k.T.askIntercept(COUNTS), false, 'turning it off again is one tap');
});

test("Don't share keeps it off, and a later thumb does not ask again", async () => {
  const k = kit();
  const doc = node(), frame = { tagName: 'IFRAME', dataset: { ownApp: 'notes' }, contentDocument: doc };
  k.T.askHook(frame);
  const row = node({ 'data-try-id': 'compact-bar' }), up = node({ 'data-try-vote': 'up' }, row);
  doc.fire('click', { target: up });
  assert.ok(k.T.el, 'the first thumb opens the prompt');
  assert.ok(k.T.el.html.includes('notes:compact-bar'), 'it names the switch the thumb was for');
  k.tap('data-fc-ask-no'); await flush();
  assert.deepEqual(k.toggles, []); assert.ok(!k.documentElement.dataset.tweaks.includes(COUNTS));
  assert.equal(k.store['wos.feature-counts.answer.v1'], 'decline');
  doc.fire('click', { target: up });
  assert.equal(k.T.el, null, 'no second prompt');
  assert.equal(k.body.length, 1);
});

test('a tap outside or Back is no answer: nothing turns on and it does not ask again this session', async () => {
  const k = kit();
  k.T.askIntercept(COUNTS);
  const el = k.T.el; el.fire('click', { target: el }); await flush();
  assert.equal(k.T.el, null); assert.deepEqual(k.toggles, []); assert.equal(k.store['wos.feature-counts.answer.v1'], undefined);
  const doc = node(); k.T.askHook({ dataset: { ownApp: 'notes' }, contentDocument: doc });
  doc.fire('click', { target: node({ 'data-try-vote': 'down' }, node({ 'data-try-id': 'a' })) });
  assert.equal(k.T.el, null);
});

test('a thumb saved before is found on the next look (box catalog, then the apps the App Manager cannot read)', async () => {
  const routes = u => {
    if (u === '/wizard-os-home/store-install/_feature-switches') return res(200, { switches: [{ id: 'mail:x', kind: 'app', vote: null }], apps: [{ id: 'notes', ok: false }] });
    if (u === '/notes/api/switches') return res(200, { switches: [{ id: 'a', tried: true, vote: null }, { id: 'b', vote: 'down' }] });
    throw new Error('unexpected ' + u);
  };
  const k = kit({ fetchImpl: routes });
  await k.T.askLook();
  assert.ok(k.T.el && k.T.el.html.includes('notes:b'));
  assert.ok(!k.calls.some(([u]) => u.includes('_switch-feedback')), 'looking never sends');
  assert.deepEqual(k.toggles, []);
});

test('already sharing, or already answered: no prompt', async () => {
  const on = kit({ tweaks: COUNTS, fetchImpl: () => res(200, { switches: [{ id: 'n:a', kind: 'app', vote: 'up' }], apps: [] }) });
  await on.T.askLook(); assert.equal(on.T.el, null); assert.equal(on.calls.length, 0);
  const said = kit({ store: { 'wos.feature-counts.answer.v1': 'decline' }, fetchImpl: () => res(200, { switches: [{ id: 'n:a', kind: 'app', vote: 'up' }], apps: [] }) });
  await said.T.askLook(); assert.equal(said.T.el, null);
  assert.equal(said.T.askIntercept(COUNTS), true, 'turning it on from Settings still asks, even after Don’t share');
});
