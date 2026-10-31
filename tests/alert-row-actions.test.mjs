// James: alerts in Ready have the same hold/context actions as threads, without opening them.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('web/core/chats.js');
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); };
const plain = x => JSON.parse(JSON.stringify(x));
const flush = () => new Promise(r => setImmediate(r));

async function harness({ read = false, fail = false } = {}) {
  let items = [{ id: 'sample-alert', title: 'Sample alert', message: 'Nothing needed from you', read, archived: false }];
  const calls = [], opened = [], sheets = [], listeners = {}, timers = new Map(); let now = 1000, seq = 0;
  const row = { dataset: { chnotif: 'sample-alert' }, style: {}, focus() {}, isConnected: true };
  const wrap = { style: { setProperty() {} }, classList: { add() {}, remove() {} }, querySelector: () => null };
  row.closest = s => s === '.ch-row-wrap' ? wrap : (s.includes('[data-chnotif]') ? row : null);
  const el = { insertAdjacentHTML: (_, h) => sheets.push(h), querySelector: () => null };
  const ctx = { console, document: { addEventListener() {}, querySelectorAll: () => [] }, location: { origin: 'https://example.invalid' },
    Date: { now: () => now }, CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout(fn, ms) { const n = ++seq; timers.set(n, { fn, ms }); return n; }, clearTimeout(n) { timers.delete(n); }, setInterval() {},
    addEventListener() {}, dispatchEvent() {},
    fetch: async (url, init) => {
      if (init?.method === 'POST') { const body = JSON.parse(init.body); calls.push({ url, body }); if (!fail) items = items.map(i => body.ids.includes(i.id) ? { ...i, ...body } : i); return { ok: !fail }; }
      return { ok: true, json: async () => url.includes('/items') ? { items } : { unread: items.filter(i => !i.read && !i.archived).length, needs: 0 } };
    },
    WizCore: { backendApps: () => [{ id: 'notifications' }] }, WosSkinHost: { inboxList: true, inboxAct: (...a) => opened.push(a), claimed: () => false },
    LIVE: { warm() {}, workGroups: () => ({ ready: [] }), isNew: () => false }, root: { addEventListener(k, fn) { (listeners[k] ||= []).push(fn); } },
    track: { querySelector: () => el }, CH: {}, W: {}, rowOf: () => ({ title: 'Thread' }), threadActions: () => ['done'],
    esc: String, notePlain: String, vib() {}, toast() {}, idOf: () => 'w', ownerSwipe: () => true,
    closeSwipe() {}, swipeTray() {}, swipeA11y() {}, topicOn: () => false, owner: x => x, openChat: () => assert.fail('not a chat thread'),
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8'), ctx);
  ctx.WosBell.watch(() => {}); await flush();
  const pointerStart = src.indexOf("    root.addEventListener('pointerdown',", src.indexOf('// Speed: pointing'));
  const pointerEnd = src.indexOf('    // Paste, drag/drop', pointerStart);
  const actionClick = src.match(/    const rsa = e.target.closest\('\[data-rsact\]'\);[^\n]+/)[0];
  const tapClick = cut("    if (justPressed() &&", "    const o = e.target.closest('[data-chopen]');");
  vm.runInContext(cut('  const ACT = {', '  // Notification-thread only:') + cut('  const ROW_MENU =', '  const emojiCategoryHtml')
    + '\nfunction closeRowSheet() { rowSheet = null; sheets.length = 0; }\n'
    + cut('  let notesOff =', '  const noteAt =') + cut('  let lp =', '  /* Gmail-style swipe') + '\nlet swipeOpen = null;\n'
    + src.slice(pointerStart, pointerEnd) + cut('  function justPressed()', '  // A list must not re-render')
    + `\nthis.tap = e => { ${tapClick} }; this.action = e => { ${actionClick} }; this.api = { notes, openRowSheet, justPressed, closeRowSheet, noteRowAct };`, Object.assign(ctx, { sheets }));
  return { ctx, calls, opened, sheets, row,
    event(type, extra = {}) { const e = { target: row, button: 0, pointerType: 'touch', pointerId: 1, clientX: 20, clientY: 40, preventDefault() {}, ...extra }; for (const fn of listeners[type] || []) fn(e); },
    hold() { for (const [id, t] of timers) if (t.ms === 480) { timers.delete(id); t.fn(); } },
    advance(ms) { now += ms; },
    choose(action) { ctx.action({ target: { closest: s => s === '[data-rsact]' ? { dataset: { rsact: action } } : null } }); },
  };
}

test('touch hold on an alert uses the shared sheet with Done / Archive, no thread-only controls and no open', async () => {
  const h = await harness(); h.event('pointerdown'); h.hold();
  assert.equal(h.sheets.length, 1); assert.match(h.sheets[0], /aria-label="Alert actions"/);
  assert.match(h.sheets[0], /data-rsact="done"/); assert.match(h.sheets[0], /data-rsact="archive"/);
  assert.doesNotMatch(h.sheets[0], /data-rspin|data-rsrename|data-rsspace|Flag/);
  h.advance(3000); assert.equal(h.ctx.api.justPressed(), true, 'long holds remain guarded until lift');
  h.event('pointerup'); h.ctx.tap({ target: h.row }); assert.deepEqual(h.opened, []);
});
for (const action of ['archive', 'done']) test(`${action} uses the real Notifications mark path and removes the alert from Ready`, async () => {
  const h = await harness(); h.event('pointerdown'); h.hold(); h.event('pointerup'); h.choose(action); await flush();
  assert.deepEqual(plain(h.calls), [{ url: '/notifications/api/mark', body: { ids: ['sample-alert'], read: true, archived: true } }]);
  assert.deepEqual(plain(h.ctx.api.notes()), { awake: [], later: [] }); assert.equal(h.sheets.length, 0); assert.deepEqual(h.opened, []);
});
test('ordinary tap still opens the alert and right-click opens the same sheet', async () => {
  const h = await harness(); h.event('pointerdown'); h.event('pointerup'); h.ctx.tap({ target: h.row });
  assert.deepEqual(h.opened, [['open', 'sample-alert']]); assert.equal(h.calls.length, 0);
  h.event('contextmenu'); assert.match(h.sheets[0], /aria-label="Alert actions"/);
});
test('failed archive restores the Ready row; unread uses only the supported read mark', async () => {
  const h = await harness({ fail: true }); await h.ctx.api.noteRowAct('sample-alert', 'archive');
  assert.equal(h.ctx.api.notes().awake.length, 1);
  const r = await harness({ read: true }); r.ctx.api.openRowSheet('w', '', 'sample-alert');
  assert.match(r.sheets[0], /data-rsact="unread"/); await r.ctx.api.noteRowAct('sample-alert', 'unread');
  assert.deepEqual(plain(r.calls[0].body), { ids: ['sample-alert'], read: false }); assert.equal(r.ctx.api.notes().awake.length, 1);
});
test('a scrolling/cancelled touch does not open the actions sheet', async () => {
  const h = await harness(); h.event('pointerdown'); h.event('pointermove', { clientY: 80 }); h.hold(); assert.equal(h.sheets.length, 0);
  h.event('pointerdown'); h.event('pointercancel'); h.hold(); assert.equal(h.sheets.length, 0);
});
