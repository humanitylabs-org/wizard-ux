// Chats is the notification inbox (Miguel, 3 Nov 2026): every app's notifications arrive in Chats beside his threads,
// read unlike a chat at a glance (app mark, app name, one line of what happened) and a noisy app is ONE row, not 50.
// The Chats badge still counts every item (badge == items), so folding is only how rows are drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { between as slice, block, runRecording } from './fixtures/source-slice.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = withParts(read('web/core/chats.js'));
const between = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, `found ${a}`); return src.slice(i, j); };

function load(items = []) {
  const ctx = {
    window: { WizConfig: { agent: () => 'Oscar' }, WosBell: { items: () => items, icon: '<svg class="bell"></svg>' } },
    esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
    clip: (s, n) => String(s).slice(0, n), ago: () => '2m',
  };
  vm.createContext(ctx);
  vm.runInContext(`const noteAt = it => (Number(it.time) || 0) * 1000;
    ${between('  const noteSrc = it =>', '  const noteAt = ')}
    ${between('  const notePlain = t =>', '  // The snoozed tail is one')}
    this.api = { fold, noteRow, noteSiblings, noteSrc };`, ctx);
  return ctx.api;
}
const it = (id, app, time, extra = {}) => ({ id, ...(app ? { app, appName: app[0].toUpperCase() + app.slice(1) } : {}), title: `T${id}`, message: `M${id}`, time, priority: 3, ...extra });

test('two or more waiting items from one app fold into one row; needs-you items keep their own', () => {
  const { fold } = load();
  const rows = fold([it('m1', 'money', 30), it('m2', 'money', 50), it('m3', 'money', 10), it('x1', 'messenger', 40), it('n1', '', 20), it('m4', 'money', 60, { priority: 4 })]);
  const g = rows.find(r => r.group === 'money');
  assert.ok(g, 'Money is one row');
  assert.deepEqual([...g.items.map(x => x.id)], ['m2', 'm1', 'm3'], 'newest first inside the fold');
  assert.equal(g.id, 'm2', 'the row opens the newest');
  assert.equal(g.time, 50);
  assert.ok(rows.some(r => r.id === 'm4' && !r.group), 'priority 4+ is never buried in a fold');
  assert.ok(rows.some(r => r.id === 'x1' && !r.group), 'a single item stays a plain row');
  assert.ok(rows.some(r => r.id === 'n1' && !r.group), 'one alert of Wizard\'s own stays a plain row');
  assert.equal(rows.length, 4);
});

test('a folded row: app mark, app name label, count, newest first; a single row names its app too', () => {
  const { fold, noteRow } = load();
  const [g] = fold([it('m1', 'money', 30), it('m2', 'money', 50)]);
  const html = noteRow(g);
  assert.match(html, /data-chnotif="m2"/);
  assert.match(html, /data-chnotif-group="money"/);
  assert.match(html, /<span class="ch-notif-from">Money<\/span>/);
  assert.match(html, /<span class="ch-notif-n">2<\/span>/);
  assert.match(html, /<b>Tm2 · Tm1<\/b>/);
  assert.match(html, /aria-label="Money: 2 waiting · newest Tm2"/);
  const one = noteRow(it('x1', 'messenger', 40));
  assert.match(one, /<span class="ch-notif-from">Messenger<\/span><b>Tx1<\/b><time>/);
  assert.doesNotMatch(one, /ch-notif-n|data-chnotif-group/);
  assert.match(noteRow(it('n1', '', 20)), /<span class="ch-notif-from">Oscar<\/span>/, 'Wizard\'s own alerts carry the agent\'s name');
});

test('the open item lists the rest from its app (Done all clears them together)', async () => {
  const items = [it('m1', 'money', 30), it('m2', 'money', 50), it('m3', 'money', 10, { archived: true }), it('x1', 'messenger', 40), it('m4', 'money', 60, { priority: 5 })];
  const { noteSiblings } = load(items);
  assert.deepEqual([...noteSiblings(items[1]).map(x => x.id)], ['m1'], 'same app, not archived, not needs-you, not itself');
  assert.equal(noteSiblings(items[4]).length, 0, 'a needs-you item stands alone');
  // the open item's "More from Money" list and its Done all (real chats-drafts.js noteMoreHtml / notifDoneAll)
  const drafts = read('web/core/chats-drafts.js'), NV = { id: 'm2', item: items[1] };
  const more = runRecording(`${block(drafts, '  function noteMoreHtml(NV) {')}\nthis.more = noteMoreHtml;`, { noteQuiet: () => false, noteSiblings, noteSrcName: () => 'Money', noteAt: x => (Number(x.time) || 0) * 1000, noteTitle: x => x.title, notePlain: String, esc: String, ACT: { done: { icon: '', label: 'Done all' } }, clip: x => x, ago: () => '' }).more(NV);
  assert.match(more, /data-chnotif-doneall="m2"/, 'Done all sits under the open notification');
  // the thread paint (real chats-threadpaint.js) puts that list under the open notification, and only there
  const paint = read('web/core/chats-threadpaint.js');
  const under = paint.slice(paint.indexOf('    // The rest waiting from the same app'), paint.indexOf('    // The same Badge | Chats picker'));
  const painted = open => runRecording(`let msgs = '<note/>';\n${under}\nthis.out = msgs;`, { NV: open, noteMoreHtml: x => (x === NV ? more : 'wrong item') }).out;
  assert.equal(painted(NV), '<note/>' + more, 'rendered under the open notification');
  assert.equal(painted(null), '<note/>', 'no open notification: no list');
  const marked = [], toasts = [];
  const doneAll = runRecording(`${block(drafts, '  async function notifDoneAll(wid, nid) {')}\nthis.doneAll = notifDoneAll;`, {
    W: { w: { id: 'w' } }, owner: id => id, notifOf: () => NV, noteSiblings, vib() {}, PHONE: () => false, CH: {}, H: {}, ch: () => ({}),
    KIT: { drafts: { get: () => ({ text: '', files: [] }), clear() {}, setReply() {} } }, chatsBack() {}, renderChats() {},
    window: { WosBell: { mark: async (ids, how) => { marked.push([[...ids], { ...how }]); return true; } } }, toast: (...a) => toasts.push(a[1]) }).doneAll;
  assert.equal(await doneAll('w', 'm2'), true);
  assert.equal(JSON.stringify(marked), '[[["m2","m1"],{"read":true,"archived":true}]]', 'Done all = this one and the rest listed, read and archived');
  assert.deepEqual(toasts, ['2 done']);
  assert.equal(await doneAll('w', 'other'), false, 'a stale tap does nothing');
});

test('Ready lists the folds, and the Chats badge still counts every item', () => {
  // Ready as Chats draws it (notes()), then the bell's own count over the same items
  const items = [it('m1', 'money', 30), it('m2', 'money', 50, { read: true }), it('m3', 'money', 10, { read: true }), it('m4', 'money', 5), it('x1', 'messenger', 40), it('z9', 'money', 1, { archived: true })];
  const { fold } = load(items);
  const ctx = runRecording(block(src, '  function notes() {') + '\nglobalThis.notes = notes;',
    { fold, notesOff: () => {}, window: { WosSkinHost: { inboxList: true }, WosBell: { items: () => items } } });
  const { awake, later } = ctx.notes();
  assert.deepEqual([...awake.map(r => r.group || r.id)], ['money', 'x1'], 'unread: Money folds, Messenger stays one row');
  assert.deepEqual([...later.map(r => r.group || r.id)], ['money'], 'read ones fold apart');
  assert.ok(![...awake, ...later].some(r => r.id === 'z9' || r.items?.some(i => i.id === 'z9')), 'never a completed one');
  const bell = readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8');
  const count = runRecording(slice(bell, '  const readyCount = () =>', '\n') + '\nglobalThis.count = readyCount;', { IN: { items }, window: { WosSkinHost: { inboxList: true } } });
  assert.equal(count.count(), 5, 'badge == items (5), not rows (3)');
  const off = runRecording(slice(bell, '  const readyCount = () =>', '\n') + '\nglobalThis.count = readyCount;', { IN: { items }, window: {} });
  assert.equal(off.count(), 0, 'no inbox list: no Ready badge');
});
