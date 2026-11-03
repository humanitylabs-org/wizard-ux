// Chats is the notification inbox (Miguel, 3 Nov 2026): every app's notifications arrive in Chats beside his threads,
// read unlike a chat at a glance (app mark, app name, one line of what happened) and a noisy app is ONE row, not 50.
// The Chats badge still counts every item (badge == items), so folding is only how rows are drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('web/core/chats.js');
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
  assert.deepEqual([...g.items.map(i => i.id)], ['m2', 'm1', 'm3'], 'newest first inside the fold');
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

test('the open item lists the rest from its app (Done all clears them together)', () => {
  const items = [it('m1', 'money', 30), it('m2', 'money', 50), it('m3', 'money', 10, { archived: true }), it('x1', 'messenger', 40), it('m4', 'money', 60, { priority: 5 })];
  const { noteSiblings } = load(items);
  assert.deepEqual([...noteSiblings(items[1]).map(i => i.id)], ['m1'], 'same app, not archived, not needs-you, not itself');
  assert.equal(noteSiblings(items[4]).length, 0, 'a needs-you item stands alone');
  assert.match(src, /if \(NV\) msgs \+= noteMoreHtml\(NV\);/, 'rendered under the open notification');
  assert.match(src, /const ids = \[n\.id, \.\.\.noteSiblings\(n\.item\)\.map\(i => i\.id\)\];/, 'Done all = this one and the rest listed');
  assert.match(src, /data-chnotif-doneall=/);
});

test('Ready lists the folds, and the Chats badge still counts every item', () => {
  assert.match(src, /return \{ awake: fold\(all\.filter\(i => !i\.read\)\), later: fold\(all\.filter\(i => i\.read\)\) \};/);
  const bell = read('web/core/notif-bell.js');
  assert.match(bell, /const readyCount = \(\) => window\.WosSkinHost\?\.inboxList \? IN\.items\.filter\(i => !i\.archived\)\.length : 0;/, 'badge == items, not rows');
});
