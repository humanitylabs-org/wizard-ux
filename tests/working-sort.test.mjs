import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { modelContext } from './fixtures/chats-list-model.mjs';
import '../web/core/chats-list-model.js';
const M = globalThis.WizChatsListModel;
const at = n => `2026-11-06T${String(n).padStart(2, '0')}:00:00Z`;
const ids = rows => Array.from(rows, r => r.id);
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
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
  const src = read('web/core/chats.js'), c = modelContext({ window: {}, LIVE: { cardAt: s => s.at, workingOrder: () => 'alphabetical' } });
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
  assert.match(read('web/layouts/ai-apps/desktop.js'), /openSortMenu\(sort, 'working-sort'\)/);
  assert.match(read('web/layouts/ai-apps/layout.js'), /'aria-label': 'Sort Working'/);
  assert.match(read('web/core/settings.js'), /id: 'working-order', page: 'chats'/);
  assert.match(read('web/core/chats.js'), /function workingOrderBar\(\)/);
  assert.doesNotMatch(read('web/core/chats.js'), /<select data-working-order|Sort Working <select|ch-working-sort/, 'no native select in the Chats list');
  assert.doesNotMatch(read('web/core/chats.css'), /ch-working-sort/);
  assert.match(read('web/live.js'), /workingOrder: \['wos.chats.workingOrder.v1'/);
});

// The Chats list Working control is Ready's order bar (James, 6 Nov 2026: the native select looked foreign on phone).
const chatsSrc = read('web/core/chats.js');
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
  const h = block("    const wo = e.target.closest('[data-workorder]');", "    const rg = e.target.closest('[data-rdyorder]');");
  assert.match(h, /LIVE\.setWorkingOrder\?\.\(nextOrder\(cur, wo\.dataset\.workorder, WORKING_ORDERS\)\)/);
  const live = read('web/live.js'), set = live.slice(live.indexOf('    setWorkingOrder: o =>'), live.indexOf('    prefOps,'));
  assert.ok(set.indexOf("dispatchEvent(new Event('wos:prefs'))") < set.indexOf('putPrefs({ workingOrder: o })'), 'paint before the preference write');
  assert.match(block('  window.addEventListener(\'wos:prefs\', () => {\n    try { const v = localStorage.getItem(READY_ORDER_KEY)', '  // Switching to or from Novairecito'), /renderChats\(W\[id\]\)/);
});
test('collapsing Working hides its order bar too (James, 6 Nov 2026: minimised Working shows no A to Z)', () => {
  const src = read('web/core/chats.js'), at = src.indexOf('workingOrderBar()', src.indexOf('function workingOrderBar') + 30);
  const head = src.slice(Math.max(0, at - 400), at);
  assert.ok(at > 0, 'the list draws the Working order bar');
  assert.match(head, /\$\{open \? `<div class="ch-sec-b">\$\{k === 'working' && list\.length \? $/, 'drawn only inside the open section body');
});
