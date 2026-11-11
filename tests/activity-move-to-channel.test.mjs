// Move to channel… on Activity rows (wizard-ux issue 1292; James, 11 Nov 2026: "when I look at the chats list and I right
// click a thread, I need an option to move it to a different channel"). With Channels on, the AI apps Activity rows
// (sidebar on the desktop, drawer on the phone; Working, Snoozed, Ready, Archive and search) offer Move to channel…,
// which opens Chats' OWN picker (the one a channel feed's row menu uses), General included; the move goes through the
// shared channel store. With the switch off the menu is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const src = read('web/core/chats.js');
const cut = (a, b, from = src) => { const i = from.indexOf(a); assert.ok(i >= 0, a); const j = from.indexOf(b, i + a.length); assert.ok(j > i, b); return from.slice(i, j); };

function model() {
  const ctx = {}; vm.createContext(ctx); vm.runInContext(read('web/core/chats-list-model.js'), ctx);
  return ctx.WizChatsListModel;
}
const groups = () => ({ working: [{ id: 'w', status: 'running' }], ready: [{ id: 'r', status: 'completed' }], deferred: [{ id: 's', status: 'completed', deferred: true }], archive: [{ id: 'a', status: 'completed', archived: true }] });
const facts = channelOf => ({ live: { isNew: () => false, cardAt: () => '' }, chats: { threadActions: s => s.archived ? ['restore'] : ['snooze', 'done'], stiKind: () => '', ...(channelOf ? { channelOf } : {}) }, pins: { has: () => false } });

test('Channels on: every Activity row (Working, Snoozed, Ready, Archive) offers move, before the filing actions', () => {
  const out = model().sessionList(groups(), facts(s => s.id === 'r' ? 'Launch' : 'General'));
  for (const k of ['working', 'ready', 'snoozed', 'archive']) for (const r of out[k]) assert.ok(r.actions.includes('move'), `${k}: ${r.id} offers move`);
  assert.deepEqual([...out.ready[0].actions], ['pin', 'rename', 'unread', 'move', 'snooze', 'done']);
  assert.deepEqual([...out.archive[0].actions], ['pin', 'rename', 'move', 'restore']);
});

test('Channels off: the menu is unchanged (no move)', () => {
  const out = model().sessionList(groups(), facts(() => ''));
  for (const k of ['working', 'ready', 'snoozed', 'archive']) for (const r of out[k]) assert.ok(!r.actions.includes('move'), `${k}: ${r.id}`);
  assert.deepEqual([...model().sessionList(groups(), facts(null)).ready[0].actions], ['pin', 'rename', 'unread', 'snooze', 'done']);
});

test('the AI apps menus draw it as "Move to channel…" (filing still last); the host passes it to the shell', () => {
  const parts = read('web/layouts/ai-apps/parts.js');
  assert.match(parts, /export const ACTS = \[\['pin', 'Pin'\], \['rename', 'Rename'\], \['unread', 'Mark unread'\], \['move', 'Move to channel…'\], \['snooze', 'Snooze'\], \['restore', 'Restore'\], \['done', 'Archive'\]\];/);
  assert.match(parts, /\n  move: \[/, 'its own icon');
  assert.match(read('web/core/skin-host.js'), /const SESSION_ACTS = Object\.freeze\(\[[^\]]*'move'[^\]]*\]\)/);
  assert.match(read('web/layouts/ai-apps/layout.js'), /if \(k === 'rename' \|\| k === 'move'\) closeDrawer\(\);/, 'the phone drawer steps aside for the picker');
});

test('both shells open Chats\' own picker through CHATS.moveToChannel, without taking the owner to Chats', () => {
  const dj = read('web/desktop/desktop.js'), aj = read('web/app.js');
  const d = cut("    sessionAct: (sid, act) => {", "\n    },", dj), a = cut("    sessionAct: (sid, act) => {", "\n    },", aj);
  assert.match(d, /if \(act === 'move'\) return !!CHATS\.moveToChannel\?\.\(\(findWin\(mainChats\) \|\| sideMain\(\)\)\?\.id, sid\);/);
  assert.ok(d.indexOf("act === 'move'") < d.indexOf('skinShowChats'), 'desktop: before any Chats navigation');
  assert.match(a, /if \(act === 'move'\) \{ const here = Object\.keys\(W\)\.find\(id => mainChats\(W\[id\]\) && deskOf\(id\) >= 0\), w = here \? W\[here\] : showChats\(\);/);
});

// The real picker code from chats.js: General is a row, the current channel is marked, picks write the store.
function picker({ on = true, inSpace = 'launch' } = {}) {
  const sets = new Map([['launch', new Set(inSpace === 'launch' ? ['t1'] : [])], ['voice', new Set(inSpace === 'voice' ? ['t1'] : [])]]);
  const channels = [{ id: 'launch', agent: 'hermes', name: 'Launch' }, { id: 'voice', agent: 'hermes', name: 'Voice' }];
  const moves = [], toasts = [], body = [];
  class Node {
    constructor() { this.style = {}; this.dataset = {}; this.listeners = {}; this.children = []; }
    set innerHTML(h) { this.html = h; } get innerHTML() { return this.html; }
    get firstElementChild() { return { style: this.cardStyle ||= {}, getBoundingClientRect: () => ({}) }; }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    querySelector() { return null; } remove() { body.splice(body.indexOf(this), 1); }
  }
  const env = {
    document: { createElement: () => new Node(), body: { appendChild: n => body.push(n) }, querySelector: s => s === '[data-chspacepicker]' ? body[0] || null : null },
    innerWidth: 1440, innerHeight: 900, requestAnimationFrame() {}, Date,
    W: { w: { id: 'w', thread: null } }, owner: id => id, elOf: () => null, CH: { w: {} },
    SPACE: { one: 'Space', many: 'Spaces', get ch() { return on; } }, channelsOn: () => on,
    esc: s => String(s), norm: s => String(s).toLowerCase(), toast: (...a) => toasts.push(a[1]),
    AGS: () => ({ colour: () => '#fff', defaultId: () => 'hermes' }), agentRec: id => ({ id, label: 'Archimedes' }),
    focusAgents: () => [{ id: 'hermes' }], focusOf: () => null, focusHoldUntil: 0,
    focusOptions: () => channels.map((c, i) => ({ kind: 'space', key: c.id, label: c.name, recent: 10 - i, unread: 0 })),
    spaces: () => channels, spaceAgent: s => s?.agent || 'hermes', spaceContains: (k, sid) => !!sets.get(k)?.has(sid),
    LIVE: { agentOf: () => '', chanStore: { move: (sid, to, a) => { moves.push([sid, to, a]); for (const s of sets.values()) s.delete(sid); if (to) sets.get(to).add(sid); } } },
    chanStore: () => ({ channels }), storeAgent: a => !a || a === 'hermes' ? 'hermes' : a, rerenderList() {}, setFocus() {}, createPickerSpace() {},
  };
  vm.createContext(env);
  const line = a => src.split('\n').find(l => l.startsWith(a));
  const fn = a => cut(a, '\n  }\n') + '\n  }';
  const code = [line('  const spacesOf = sid =>'), ...['  function spaceMember(', '  function fileInSpace(', '  function fileInGeneral(', '  function moveToChannel(', '  function chanStoreMove('].map(fn),
    cut('  let spacePicker = null, focusHoldUntil = 0;', '  async function createPickerSpace')].join('\n');
  vm.runInContext(`${code}\nthis.api = { moveToChannel, closeSpacePicker, get picker() { return spacePicker; } };`, env);
  const click = attrs => ({ target: { closest: sel => { const k = sel.replace(/^\[|\]$/g, '').split('=')[0]; return k in attrs ? { dataset: { [k.replace(/^data-/, '')]: attrs[k] } } : null; } } });
  const fire = attrs => body[0].listeners.click.forEach(fn => fn(click(attrs)));
  return { ...env.api, body, moves, toasts, fire, sets };
}

test('the picker lists every channel and General last, the current channel marked; opened from no Chats view', () => {
  const p = picker();
  assert.equal(p.moveToChannel('w', 't1'), true);
  const h = p.body[0].innerHTML;
  assert.match(h, /aria-label="Move to channel"/);
  assert.deepEqual([...h.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1]), ['Launch', 'Voice', 'General']);
  assert.match(h, /data-spspace="launch" aria-pressed="true"><span>Launch<\/span><small><\/small><b>✓<\/b>/, 'its channel is marked');
  assert.match(h, /data-spgeneral aria-pressed="false"/);
  assert.equal(p.body[0].cardStyle.transform, 'translate(-50%, -50%)', 'desktop: a card in the middle, not a full-width bar');
});

test('picking a channel moves the chat through the channel store (out of the old one, into the new)', () => {
  const p = picker();
  p.moveToChannel('w', 't1'); p.fire({ 'data-spspace': 'voice' });
  assert.deepEqual(p.moves, [['t1', 'voice', 'hermes']]);
  assert.equal(p.sets.get('voice').has('t1'), true); assert.equal(p.sets.get('launch').has('t1'), false);
  assert.deepEqual(p.toasts, ['Moved to Voice']); assert.equal(p.picker, null, 'the picker closes');
});

test('General moves it out of its channel (the store\'s move to no channel); a chat in General shows General marked', () => {
  const p = picker();
  p.moveToChannel('w', 't1'); p.fire({ 'data-spgeneral': '' });
  assert.deepEqual(p.moves, [['t1', null, 'hermes']]); assert.deepEqual(p.toasts, ['Moved to General']);
  const g = picker({ inSpace: '' }); g.moveToChannel('w', 't1');
  assert.match(g.body[0].innerHTML, /data-spgeneral aria-pressed="true"><span>General<\/span><small><\/small><b>✓<\/b>/);
  g.fire({ 'data-spgeneral': '' }); assert.deepEqual(g.moves, [], 'already there: nothing written'); assert.deepEqual(g.toasts, ['Already in General']);
});

test('Channels off: moveToChannel opens nothing, and the Spaces picker has no General row', () => {
  const p = picker({ on: false });
  assert.equal(p.moveToChannel('w', 't1'), false); assert.equal(p.body.length, 0);
  assert.match(src, /const gen = p\.sid && SPACE\.ch \? /);
});
