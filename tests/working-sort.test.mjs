import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { modelContext } from './fixtures/chats-list-model.mjs';
import '../web/core/chats-list-model.js';
import { withParts } from './fixtures/chats-parts.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withWebParts } from './fixtures/web-parts.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { listFixture } from './fixtures/chats-list-render.mjs';
import { withSettingsParts } from './fixtures/settings-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
const M = globalThis.WizChatsListModel;
const at = n => `2026-11-06T${String(n).padStart(2, '0')}:00:00Z`;
const ids = rows => Array.from(rows, r => r.id);
const read = file => withWebParts(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
const rows = [{ id: 'z', title: 'Zulu', at: at(9) }, { id: 'a-old', title: 'alpha', at: at(1) },
  { id: 'b', title: 'Beta', at: at(8) }, { id: 'a-new', title: 'ALPHA', at: at(7) },
  { id: 'untitled', title: '', at: at(2) }, { id: 'pin', title: 'ZZ pin', pinned: true, at: at(3) }];
test('Working defaults A to Z, case insensitive with newest ties, visible untitled fallback, pins first and no mutation', () => {
  const before = JSON.stringify(rows);
  for (const order of [undefined, null, 'bad', 'priority', 'alphabetical']) assert.deepEqual(ids(M.workingSort(rows, order)), ['pin', 'a-new', 'a-old', 'b', 'untitled', 'z']);
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(M.workingSort(), []);
});
test('emoji and accented titles follow locale collation of the actual visible title', () => {
  const input = [{ id: 'rocket', title: '🚀 Work' }, { id: 'a', title: 'ápple' }, { id: 'sparkle', title: '✨ Work' }, { id: 'z', title: 'zebra' }, { id: 'empty' }];
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  const expected = input.slice().sort((a, b) => collator.compare(a.title || 'New chat', b.title || 'New chat'));
  assert.deepEqual(ids(M.workingSort(input)), ids(expected));
});
test('Newest and Oldest reuse Ready time ordering without attention or snooze priority; pins remain first', () => {
  assert.deepEqual(ids(M.workingSort(rows, 'newest')), ['pin', 'z', 'b', 'a-new', 'untitled', 'a-old']);
  assert.deepEqual(ids(M.workingSort(rows, 'oldest')), ['pin', 'a-old', 'untitled', 'a-new', 'b', 'z']);
  const equal = [{ id: 'b', title: 'Beta', state: 'approval', at: at(1) }, { id: 'a', title: 'Alpha', snoozed: true, at: at(1) }];
  for (const order of ['oldest', 'newest']) assert.deepEqual(ids(M.workingSort(equal, order)), ['a', 'b']);
});
test('stock renderer uses the same Working comparator and raw session cardAt', () => {
  const src = withParts(read('web/core/chats.js')), c = modelContext({ window: {}, LIVE: { cardAt: s => s.at, workingOrder: () => 'alphabetical' } });
  vm.runInContext(src.slice(src.indexOf('  const workingOrdered ='), src.indexOf('  const readyOrdered =')) + '\nthis.sort = workingOrdered;', c);
  assert.deepEqual(ids(c.sort(rows.filter(r => !r.pinned))), ['a-new', 'a-old', 'b', 'untitled', 'z']);
});
test('Working time sort falls back for sessions without request clocks, without changing Ready', () => {
  const live = { cardAt: s => s.requestAt || '' }, facts = { live, chats: { threadActions: () => [] } };
  const sessions = [{ id: 'z', title: 'Zulu', updatedAt: at(9) }, { id: 'a', title: 'alpha', updatedAt: at(1) }, { id: 'b', title: 'Beta', createdAt: at(8) }];
  const projected = sessions.map(s => M.sessionRow(s, 'working', facts));
  assert.deepEqual(ids(M.workingSort(projected, 'newest')), ['z', 'b', 'a']);
  assert.deepEqual(ids(M.workingSort(projected, 'oldest')), ['a', 'b', 'z']);
  assert.equal(M.sessionRow(sessions[0], 'ready', facts).at, '', 'Ready clock unchanged');
  assert.equal(M.workingAt({ requestAt: at(2), updatedAt: at(9) }, live), at(2), 'request clock remains authoritative');
});
test('every surface has a separate Working control, and Settings uses the shared registry', () => {
  // (the phone AI apps drawer's own "Sort Working" control: ai-apps-view.test.mjs; the stock Chats pills: below; the
  // saved, box-synced choice: working-order-two-devices.test.mjs)
  // Settings › Chats: the real registry entry draws the shared WORKING_SORTS and saves through WizLive.setWorkingOrder
  const doc = createDocument(), sets = [];
  const s = { console, URL, setTimeout, clearTimeout, CSS: { escape: String }, navigator: { userAgent: 'Desktop' }, document: doc, location: { host: 'x.test' }, WizCore: {},
    WizChatsListModel: M, WizLive: { workingOrder: () => 'newest', setWorkingOrder: o => sets.push(o) }, addEventListener() {}, removeEventListener() {} };
  s.window = s;
  vm.runInNewContext(withSettingsParts(read('web/core/settings.js')), s);
  const root = doc.createElement('div'); doc.body.appendChild(root);
  s.WosSettings.mount(root, { shell: 'phone', live: { ok: true } }).focus('chats');
  const sel = root.querySelector('select[data-settings-working-order]');
  assert.ok(sel, 'on the Chats page'); assert.equal(sel.getAttribute('aria-label'), 'Sort Working');
  assert.deepEqual(sel.querySelectorAll('option').map(o => [o.getAttribute('value'), o.textContent]), M.WORKING_SORTS.map(([v, w]) => [v, w]), 'the shared registry');
  assert.equal(sel.querySelector('option[selected]').getAttribute('value'), 'newest', 'the saved choice');
  sel.value = 'oldest'; sel.dispatchEvent({ type: 'input', bubbles: true });
  assert.deepEqual(sets, ['oldest']);
  // the stock Chats list draws its Working pills (workingOrderBar), never a native select
  const html = listFixture({}).render('');
  assert.doesNotMatch(html, /<select/, 'no native select in the Chats list');
});

// The Chats list Working control is Ready's order bar (James, 6 Nov 2026: the native select looked foreign on phone).
const chatsSrc = withParts(read('web/core/chats.js'));
const block = (a, b) => { const i = chatsSrc.indexOf(a), j = chatsSrc.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a} anchor`); return chatsSrc.slice(i, j); };
function barContext(order, readyOrder = 'newest') {
  const c = modelContext({ window: {}, LIVE: { cardAt: s => s.at, workingOrder: () => order }, readyOrder, READY_ORDERS: ['newest', 'priority', 'subject'], READY_ORDER_LABEL: { newest: 'Newest', priority: 'Priority', subject: 'By subject' }, snoozeLast: () => false, deferredOf: () => false, esc: String });
  vm.runInContext(block('  function readyBody(', '  /* Android Back on the list') + '\nthis.bar = workingOrderBar; this.orderBar = orderBar; this.nextOrder = nextOrder; this.W_ORDERS = WORKING_ORDERS;', c);
  return c;
}
const buttons = html => [...html.matchAll(/<button type="button" data-workorder="([^"]+)" aria-pressed="(true|false)"( class="on")?>([^<]+)<\/button>/g)].map(m => [m[1], m[2] === 'true', !!m[3], m[4]]);
test('Working order bar: two pills, Ready classes, correct pressed state for each saved value', () => {
  const cases = { alphabetical: [['alphabetical', true, true, 'A to Z'], ['newest', false, false, 'Newest']],
    newest: [['alphabetical', false, false, 'A to Z'], ['newest', true, true, 'Newest']],
    oldest: [['alphabetical', false, false, 'A to Z'], ['newest', true, true, 'Oldest']] };
  for (const [order, want] of Object.entries(cases)) {
    const html = barContext(order).bar();
    assert.match(html, /^<div class="ch-rdy-bar" role="group" aria-label="Order Working">/);
    assert.deepEqual(buttons(html), want, order);
    assert.doesNotMatch(html, /<select|<option/);
  }
  assert.deepEqual(buttons(barContext(undefined).bar())[0], ['alphabetical', true, true, 'A to Z'], 'unset pref shows A to Z');
});
test('Working taps: A to Z, Newest, Newest again flips to Oldest and back, exactly like Ready', () => {
  const c = barContext('alphabetical'), W = c.W_ORDERS;
  assert.equal(c.nextOrder('alphabetical', 'newest', W), 'newest');
  assert.equal(c.nextOrder('newest', 'newest', W), 'oldest');
  assert.equal(c.nextOrder('oldest', 'newest', W), 'newest');
  assert.equal(c.nextOrder('oldest', 'alphabetical', W), 'alphabetical');
  assert.equal(c.nextOrder('newest', 'bogus', W), 'newest');
  const R = ['newest', 'priority', 'subject'];
  assert.equal(c.nextOrder('newest', 'newest', R), 'oldest'); assert.equal(c.nextOrder('oldest', 'priority', R), 'priority');
});
test("Ready's bar markup is byte-identical to the pre-reuse template", () => {
  const LABEL = { newest: 'Newest', priority: 'Priority', subject: 'By subject' }, ORDERS = ['newest', 'priority', 'subject'];
  const legacy = readyOrder => `<div class="ch-rdy-bar" role="group" aria-label="Order Ready">${ORDERS.map(o => { const on = readyOrder === o || (o === 'newest' && readyOrder === 'oldest'); return `<button type="button" data-rdyorder="${o}" aria-pressed="${on}"${on ? ' class="on"' : ''}>${o === 'newest' && readyOrder === 'oldest' ? 'Oldest' : LABEL[o]}</button>`; }).join('')}</div>`;
  for (const r of ['newest', 'oldest', 'priority', 'subject']) assert.equal(barContext('alphabetical', r).orderBar('Order Ready', 'data-rdyorder', ORDERS, r, o => LABEL[o]), legacy(r));
});
test('Working tap handler writes the shared preference through setWorkingOrder (which repaints synchronously)', () => {
  // the list's tap: Newest on an A-to-Z list asks live.js for Newest, Newest again for Oldest
  const c = barContext('alphabetical'), asked = [];
  c.LIVE.setWorkingOrder = o => (asked.push(o), true);
  vm.runInContext(`this.tap = e => { ${block("    const wo = e.target.closest('[data-workorder]');", "    const rg = e.target.closest('[data-rdyorder]');")} };`, c);
  const tap = o => c.tap({ target: { closest: q => (q === '[data-workorder]' ? { dataset: { workorder: o } } : null) } });
  assert.equal(tap('newest'), true); assert.deepEqual(asked, ['newest']);
  c.LIVE.workingOrder = () => 'newest'; tap('newest'); assert.deepEqual(asked, ['newest', 'oldest']);
  // live.js: the list paints (wos:prefs) before the preference write goes out, and a repeat writes nothing
  const live = withLiveParts(read('web/live.js')), set = live.slice(live.indexOf('    setWorkingOrder: o =>'), live.indexOf('    prefOps,'));
  const order = [], store = new Map();
  const L = vm.runInNewContext(`({ ${set} })`, { window: { WizChatsListModel: M, dispatchEvent: e => order.push('paint:' + e.type) }, Event: class { constructor(t) { this.type = t; } },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, putPrefs: p => order.push('write:' + p.workingOrder) });
  assert.equal(L.setWorkingOrder('newest'), true);
  assert.deepEqual(order, ['paint:wos:prefs', 'write:newest']);
  L.setWorkingOrder('newest'); assert.equal(order.length, 2, 'the same choice again writes nothing');
  assert.equal(L.setWorkingOrder('bogus'), false);
  // chats.js: wos:prefs repaints every Chats window
  const painted = [], on = {};
  vm.runInNewContext(block("  window.addEventListener('wos:prefs', () => {\n    try { const v = localStorage.getItem(READY_ORDER_KEY)", '  // Switching to or from Novairecito'),
    { window: { addEventListener: (t, f) => { on[t] = f; } }, localStorage: { getItem: () => null }, READY_ORDER_KEY: 'k', READY_ORDERS: [], readyOrder: 'newest',
      CH: { a: {}, b: {} }, W: { a: { id: 'a' }, b: { id: 'b' } }, renderChats: w => painted.push(w.id) });
  on['wos:prefs'](); assert.deepEqual(painted, ['a', 'b']);
});

test('collapsing Working hides its order bar too (James, 6 Nov 2026: minimised Working shows no A to Z)', () => {
  // the real list renderer (tests/fixtures/chats-list-render.mjs): the bar is drawn only inside the open section body
  const f = listFixture();
  assert.match(f.render(''), /<section[^>]*data-sec="working"[\s\S]*?aria-label="Order Working"/);
  assert.doesNotMatch(f.toggle('working'), /aria-label="Order Working"/);
});

// Main versus routed agents (host profile, container, restricted): one owner Working order for every thread, whichever
// agent owns it — through the stock renderer and the layout list (skin-host api.sessions.list) alike; rows keep their agent.
test('main and routed-agent Working threads share one order on the stock renderer and the layout list', () => {
  const AG = ['', 'profile', 'container', 'restricted'];
  const mixed = rows.filter(r => !r.pinned).map((r, i) => ({ ...r, ...(AG[i % 4] ? { agent: AG[i % 4] } : {}) }));
  const plain = rows.filter(r => !r.pinned);
  for (const order of ['alphabetical', 'newest', 'oldest']) {
    const src = withParts(read('web/core/chats.js')), c = modelContext({ window: {}, LIVE: { cardAt: s => s.at, workingOrder: () => order } });
    vm.runInContext(src.slice(src.indexOf('  const workingOrdered ='), src.indexOf('  const readyOrdered =')) + '\nthis.sort = workingOrdered;', c);
    const stock = c.sort(mixed);
    assert.deepEqual(ids(stock), ids(c.sort(plain)), `${order}: routed rows sort exactly like main rows`);
    assert.deepEqual(stock.map(r => r.agent || ''), ids(stock).map(id => mixed.find(r => r.id === id).agent || ''), 'each row keeps its agent');
    assert.deepEqual(ids(M.workingSort(mixed, order)), ids(M.workingSort(plain, order)), `${order}: layout list (workingSort) agrees`);
    for (const ag of AG.filter(Boolean)) {
      const only = mixed.filter(r => (r.agent || '') === ag);
      assert.deepEqual(ids(c.sort(only)), ids(M.workingSort(only, order)), `${order}: ${ag}-only list`);
    }
  }
  // the layout list (the real skin-host sessions list()) sorts every Working row, routed ones included, in the saved order
  const host = withSkinHostParts(fs.readFileSync(new URL('../web/core/skin-host.js', import.meta.url), 'utf8'));
  const from = host.indexOf('        list: opts =>'), prop = host.slice(from, host.indexOf('        open: id =>', from));
  for (const order of ['alphabetical', 'newest', 'oldest']) {
    const c = { structuredClone, live: () => true, shell: { sessionList: () => ({ working: mixed, ready: [] }) }, withNoteRows: r => r, readWorkingOrder: () => order, window: { WizChatsListModel: M } };
    vm.createContext(c); vm.runInContext(`this.api = ({ ${prop} });`, c);
    const o = c.api.list();
    assert.deepEqual(ids(o.working), ids(M.workingSort(mixed, order)), `${order}: the layout list's Working order`);
    assert.deepEqual(o.working.map(r => r.agent || ''), ids(o.working).map(id => mixed.find(r => r.id === id).agent || ''), 'rows keep their agent');
  }
});
