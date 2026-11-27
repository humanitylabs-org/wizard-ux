// Pin to top (wizard-ux issue 1887, switch wizard/inbox-pin-top, off by default, with wizard/inbox-rows on): threads
// in the owner's pin list (the box's ui-preferences pinnedChats, also what an agent adds to) rank above today's Daily,
// in pin order, always in Inbox, drawn as the normal row with the pin mark; a read one that is only there because of
// the pin is not counted. Runs the real list model and the real chats-inboxrows.js part. Switch off: nothing changes.
// Browser proof: tests/qa-inbox-pin-top.cjs (phone + Classic, owner pin from the row menu, agent pin through the box).
// Run: node --test tests/inbox-pin-top.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const J = v => JSON.parse(JSON.stringify(v));
const H = 3600e3, NOW = Date.now(), ROWS_SW = 'wizard/inbox-rows', SW = 'wizard/inbox-pin-top';
const M = modelContext({}).WizChatsListModel;
const iso = t => new Date(t).toISOString();
const row = (id, h, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', at: NOW - h * H, updatedAt: iso(NOW - h * H), lastAssistantAt: iso(NOW - h * H), messageCount: 2, ...extra });
const needs = s => ['needs_you', 'check'].includes(s.attention?.state);
const unread = s => !!s.fresh;
const quiet = s => s.quietReply === true;
const groups = rows => ({ working: rows.filter(s => s.status === 'running'), ready: rows.filter(s => s.status !== 'running' && !s.archived && !s.deferred), deferred: rows.filter(s => s.deferred && !s.archived), archive: rows.filter(s => s.archived) });
// new1 unread, read1 read reply, d1 today's Daily, q1 quiet reply (Sent), m1 Morning (read, quiet: only here when
// pinned), u1 a quiet thread with an unread reply (still Sent), a1 archived, s1 snoozed.
const ROWS = () => [row('new1', 1, { fresh: true }), row('read1', 30), row('d1', 5), row('q1', 0.5, { quietReply: true }),
  row('m1', 2, { quietReply: true }), row('u1', 0.3, { quietReply: true, fresh: true }), row('a1', 6, { archived: true }), row('s1', 2, { deferred: true })];
const facts = { needs, unread, at: s => s.at };
const base = s => s.id === 'd1' ? 1 : 0;
const withTops = ids => { const tops = new Map(ids.map((id, i) => [id, (i + 1) / 1000])); return { quiet, pin: s => tops.has(s.id) ? tops.get(s.id) : base(s), top: s => tops.has(s.id), base }; };
const ids = list => J(list.map(s => s.id));

test('list model: pinned-to-top threads come first, above Daily, in pin order; newer activity never moves them', () => {
  const g = M.activityGroups(groups(ROWS()), facts, { now: NOW, inbox: withTops(['m1', 'read1']) });
  assert.deepEqual(ids(g.ready).slice(0, 3), ['m1', 'read1', 'd1']);
  assert.deepEqual(ids(g.ready).slice(3), ['new1'], 'then the rest newest first (quiet threads stay in Sent)');
  const later = ROWS().map(s => s.id === 'new1' ? { ...s, at: NOW + H } : s);
  assert.deepEqual(ids(M.activityGroups(groups(later), facts, { now: NOW, inbox: withTops(['m1', 'read1']) }).ready).slice(0, 3), ['m1', 'read1', 'd1']);
});

test('list model: a pinned quiet thread (Sent otherwise) is in Inbox; archived and snoozed ones are not', () => {
  const off = M.activityGroups(groups(ROWS()), facts, { now: NOW, inbox: { quiet, pin: base } });
  assert.ok(!ids(off.ready).includes('m1'), 'not pinned: a read quiet thread is not in Inbox');
  const g = M.activityGroups(groups(ROWS()), facts, { now: NOW, inbox: withTops(['m1', 'a1', 's1']) });
  assert.equal(ids(g.ready)[0], 'm1');
  assert.ok(!ids(g.ready).includes('a1') && !ids(g.ready).includes('s1'));
  assert.ok(ids(g.snoozed).includes('s1') && ids(g.archive).includes('a1'));
});

test('list model: a read pinned thread does not change the count; an unread one counts; pinning a counted one keeps it counted', () => {
  const noPin = M.activityGroups(groups(ROWS()), facts, { now: NOW, inbox: withTops([]) });
  const n0 = noPin.counted.length;
  assert.equal(n0, noPin.ready.length);
  const m = M.activityGroups(groups(ROWS()), facts, { now: NOW, inbox: withTops(['m1']) });
  assert.equal(m.ready.length, n0 + 1, 'shown'); assert.equal(m.counted.length, n0, 'not counted while read');
  const r = M.activityGroups(groups(ROWS()), facts, { now: NOW, inbox: withTops(['read1', 'd1']) });
  assert.equal(r.counted.length, n0, 'read1 and Daily were counted before the pin and still are');
  const unreadQuiet = M.activityGroups(groups(ROWS().map(s => s.id === 'm1' ? { ...s, fresh: true } : s)), facts, { now: NOW, inbox: withTops(['m1']) });
  assert.ok(ids(unreadQuiet.counted).includes('m1'), 'unread: counted');
});

test('list model: without top facts (switch off) the groups are exactly today\'s', () => {
  const g = M.activityGroups(groups(ROWS()), facts, { now: NOW, inbox: { quiet, pin: base } });
  assert.equal('counted' in g, false);
  assert.deepEqual(ids(g.ready), ['d1', 'new1', 'read1'], 'Daily first, quiet threads in Sent');
});

/* The real part: reads the switch and the owner's pin list (window.WosChatPins). */
function part({ tweaks, pins = [], pinsShown = true }) {
  const ctx = vm.createContext({ console, Date, Promise, String, Number, Set, Map, Array, Object, JSON, setTimeout });
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.document = { documentElement: { dataset: { tweaks } } };
  ctx.WizChatsListModel = M; ctx.WizCore = { chatsParts: {} };
  ctx.WosChatPins = { ids: () => pins.slice(), has: id => pins.includes(id) };
  vm.runInContext(read('web/core/chats-inboxrows.js'), ctx);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const rows = ROWS().map(s => ({ ...s, preview: 'Reply of ' + s.id, previewRole: 'assistant' }));
  const LIVE = { quietReply: quiet, cardAt: s => iso(s.at), workGroups: groups, chanDaily: { state: () => ({ today: 'd1' }) }, sentLog: { state: () => ({ ok: true, rows: [] }) }, agentInbox: { needs: () => [] } };
  const c = {};
  const api = ctx.WizCore.chatsParts.inboxrows({
    actMark: s => needs(s) ? 'needs' : unread(s) ? 'new' : '', actNeeds: needs, actUnread: unread,
    AGS: () => ({ sigil: a => `<span class="ag-sig">${a.id}</span>`, defaultId: () => 'hermes' }), agentName: id => id || 'Wizard', agentRec: id => ({ id }),
    ago: t => t ? 'ago' : '', attOf: () => null, chanAt: s => s.at, chanFace: n => ({ emoji: '💬', label: n, own: false }),
    chanStore: () => ({ channels: [{ id: 'daily', kind: 'daily' }] }), chatVars: { readyOrder: 'newest', secOpen: {} }, ch: () => c, clip: (s, n) => String(s).slice(0, n), elOf: () => null, esc,
    isWorking: () => false, LIVE, noteAt: n => n.at, noteRow: () => '', PIN: { on: () => pinsShown }, renderChatList: () => {}, rowAgent: () => 'hermes',
    spacesOf: () => [], threadAct: () => {}, toast: () => {}, W: {}, winAgent: () => '',
  });
  return { api, rows, c, ctx };
}
const order = html => [...html.matchAll(/<div class="ch-row-wrap ch-ib-wrap([^"]*)"[^>]*>[\s\S]*?data-chopen="([^"]+)"/g)].map(m => ({ id: m[2], pinned: / pinned/.test(m[1]) }));

test('part: switch on, Pin to top rows first with the pin mark, the same row; the count leaves out a read one; menu word', () => {
  const { api, rows } = part({ tweaks: `${ROWS_SW} ${SW}`, pins: ['m1'] });
  const html = api.inboxRowsBody({ id: 'w' }, rows, null);
  const r = order(html);
  assert.deepEqual(J(r.slice(0, 2)), [{ id: 'm1', pinned: true }, { id: 'd1', pinned: true }]);
  const first = html.slice(html.indexOf('data-morph-key="row:m1"'), html.indexOf('data-morph-key="row:d1"'));
  assert.match(first, /<span class="ch-ib-from"><span class="ch-ib-pin" aria-label="Pinned">📌<\/span>/);
  assert.match(first, /class="ch-ib-av/); assert.match(first, /<span class="ch-ib-pv">Reply of m1<\/span>/);
  assert.match(html, /<span>Inbox<\/span><small>3<\/small>/, '4 rows, the read pinned Morning not counted');
  assert.equal(r.length, 4);
  assert.equal(api.ibPinWord(false), 'Pin to top'); assert.equal(api.ibPinWord(true), 'Unpin');
  const fx = api.inboxRowsFacts();
  assert.equal(fx.top({ id: 'm1' }), true); assert.ok(fx.pin({ id: 'm1' }) < fx.pin({ id: 'd1' }));
});

test('part: switch off (or Inbox rows off, or Pins hidden), a pinned thread is not lifted and the menu says Pin', () => {
  for (const o of [{ tweaks: ROWS_SW }, { tweaks: SW }, { tweaks: `${ROWS_SW} ${SW}`, pinsShown: false }]) {
    const { api, rows } = part({ ...o, pins: ['m1', 'read1'] });
    const html = api.inboxRowsBody({ id: 'w' }, rows, null);
    if (o.tweaks.includes(ROWS_SW)) {
      const ref = part({ tweaks: ROWS_SW, pins: [] });
      assert.equal(html, ref.api.inboxRowsBody({ id: 'w' }, ref.rows, null), 'byte-identical to no pins: ' + JSON.stringify(o));
      assert.equal(order(html)[0].id, 'd1');
    }
    if (!o.pinsShown && o.pinsShown !== undefined) continue;
    assert.equal(api.ibPinWord(false), 'Pin');
  }
});
