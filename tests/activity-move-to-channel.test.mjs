// Move to channel… on Activity rows (wizard-ux issue 1292; James, 11 Nov 2026: "when I look at the chats list and I right
// click a thread, I need an option to move it to a different channel"). The AI apps Activity rows
// (sidebar on the desktop, drawer on the phone; Working, Snoozed, Ready, Archive and search) offer Move to channel…,
// which opens Chats' OWN picker (the one a channel feed's row menu uses), General included; the move goes through the
// shared channel store (Channels are on for everyone, wizard-ux issue 1258).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { readFileSync } from 'node:fs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';

const read = f => withShellParts(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const src = withParts(read('web/core/chats.js'));
const cut = (a, b, from = src) => { const i = from.indexOf(a); assert.ok(i >= 0, a); const j = from.indexOf(b, i + a.length); assert.ok(j > i, b); return from.slice(i, j); };

const ROUTED = ['host-ops', 'box', 'locked']; // a routed agent per profile: host, container, restricted
function model() {
  const ctx = {}; vm.createContext(ctx); vm.runInContext(read('web/core/chats-list-model.js'), ctx);
  return ctx.WizChatsListModel;
}
const groups = () => ({ working: [{ id: 'w', status: 'running' }], ready: [{ id: 'r', status: 'completed' }], deferred: [{ id: 's', status: 'completed', deferred: true }], archive: [{ id: 'a', status: 'completed', archived: true }] });
const facts = channelOf => ({ live: { isNew: () => false, cardAt: () => '' }, chats: { threadActions: s => s.archived ? ['restore'] : ['snooze', 'done'], stiKind: () => '', ...(channelOf ? { channelOf } : {}) }, pins: { has: () => false } });

test('every Activity row (Working, Snoozed, Ready, Archive) offers move, before the filing actions', () => {
  const out = model().sessionList(groups(), facts(s => s.id === 'r' ? 'Launch' : 'General'));
  for (const k of ['working', 'ready', 'snoozed', 'archive']) for (const r of out[k]) assert.ok(r.actions.includes('move'), `${k}: ${r.id} offers move`);
  assert.deepEqual([...out.ready[0].actions], ['pin', 'rename', 'unread', 'move', 'snooze', 'done']);
  assert.deepEqual([...out.archive[0].actions], ['pin', 'rename', 'move', 'restore']);
});

test('a row with no channel (channelOf empty or absent) offers no move', () => {
  const out = model().sessionList(groups(), facts(() => ''));
  for (const k of ['working', 'ready', 'snoozed', 'archive']) for (const r of out[k]) assert.ok(!r.actions.includes('move'), `${k}: ${r.id}`);
  assert.deepEqual([...model().sessionList(groups(), facts(null)).ready[0].actions], ['pin', 'rename', 'unread', 'snooze', 'done']);
});

test('the AI apps menus draw it as "Move to channel…" (filing still last); the host passes it to the shell', async () => {
  // The drawn menus are run in tests/ai-apps-view.test.mjs (phone drawer and desktop sidebar: "Move to channel…" before
  // Snooze and Archive; the phone drawer closes for the picker) and the host passing 'move' to the shell in
  // tests/layout-host-api.test.mjs. Here: the menu's own table and its icon.
  const { ACTS, ICON } = await import('../web/layouts/ai-apps/parts.js');
  const keys = ACTS.map(([k]) => k);
  assert.deepEqual(ACTS.find(([k]) => k === 'move'), ['move', 'Move to channel…']);
  assert.ok(keys.indexOf('move') < keys.indexOf('snooze') && keys.indexOf('move') < keys.indexOf('done'), 'filing still last');
  assert.ok(Array.isArray(ICON.move) && ICON.move.length, 'its own icon');
});

// Each shell's real sessionAct, run with a fake Chats; what it opens and what it hands the picker.
function sessionAct(file, ctx) {
  const code = cut("    sessionAct: (sid, act) => {", "\n    },", read(file)).replace(/^    sessionAct: /, '');
  const calls = ctx.calls = [];
  ctx.CHATS = { moveToChannel: (w, sid) => (calls.push(['move', w, sid]), true), threadAct: () => calls.push(['threadAct']), openRenameSheet: () => calls.push(['rename']) };
  ctx.window = {}; ctx.toast = () => {};
  ctx.showChats = ctx.skinShowChats = () => (calls.push(['showChats']), { id: 'shown' });
  return vm.runInNewContext(`(${code}\n    })`, ctx);
}

test('both shells open Chats\' own picker through CHATS.moveToChannel, without taking the owner to Chats', () => {
  // desktop: the main Chats window, else the sidebar's stand-in
  const dw = { main: { id: 'main', app: 'chats' } }, d = {}, desk = sessionAct('web/desktop/desktop.js', Object.assign(d, { findWin: f => Object.values(dw).find(f) || null, mainChats: w => w.app === 'chats', sideMain: () => ({ id: 'side' }) }));
  assert.equal(desk('t1', 'move'), true); assert.deepEqual(d.calls, [['move', 'main', 't1']]);
  delete dw.main; desk('t2', 'move'); assert.deepEqual(d.calls.at(-1), ['move', 'side', 't2'], 'the sidebar stand-in when there is no main Chats');
  assert.ok(!d.calls.some(c => c[0] === 'showChats'), 'desktop: no Chats navigation');
  // phone: a Chats window on a desk; with none, one opens beside, out of view (stay), never showChats()
  const W = {}, p = {}, opened = [];
  const phone = sessionAct('web/app.js', Object.assign(p, { W, mainChats: w => w.app === 'chats', deskOf: id => (id === 'gone' ? -1 : 2), APP: { wizard: { id: 'wizard' } },
    openApp: (a, x, o) => { opened.push([a.id, o]); W.c9 = { id: 'c9', app: 'chats' }; } }));
  W.gone = { id: 'gone', app: 'chats' };
  assert.equal(phone('t3', 'move'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [['wizard', { stay: true }]], 'a Chats window off a desk does not count; one opens out of view');
  assert.deepEqual(p.calls, [['move', 'c9', 't3']]);
  phone('t4', 'move'); assert.equal(opened.length, 1, 'then that one is reused');
  assert.ok(!p.calls.some(c => c[0] === 'showChats'), 'phone: no navigation');
  // desktop with no main Chats: the sidebar's stand-in (sideMain) is not in W, but Chats resolves windows through
  // H.win = chatsWin, which knows the stand-in (sideWin), so the picker finds it
  // (the real desktop-sideview.js: its window lookups and the host object it hands Chats)
  const dj = read('web/desktop/desktop.js');
  let host = null;
  runRecording(`${between(dj, '  const sideWin = id =>', '\n')}\n${between(dj, '  const chatsWin = id =>', '\n')}\nconst CHATS = window.WizChatsHost.create(${block(dj, '  const CHATS = window.WizChatsHost.create({').replace('  const CHATS = window.WizChatsHost.create(', '')});`,
    { W: { w1: { id: 'w1' } }, sideBase: { id: 'side' }, feedBase: null, viewBase: null, listWin: (id, k) => ({ id, k }), MOD: '⌥', window: { WizChatsHost: { create: h => { host = h; return {}; } } } });
  const win = host.win;
  assert.equal(win('side').id, 'side', 'Chats finds the sidebar stand-in'); assert.equal(win('w1').id, 'w1'); assert.equal(win('nope'), undefined);
});

// The real picker code from chats.js: General is a row, the current channel is marked, picks write the store.
function picker({ inSpace = 'launch', session = null, pin = '' } = {}) {
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
    SPACE: { one: 'Space', many: 'Spaces', ch: true },
    esc: s => String(s), norm: s => String(s).toLowerCase(), toast: (...a) => toasts.push(a[1]),
    AGS: () => ({ colour: () => '#fff', defaultId: () => 'hermes' }), agentRec: id => ({ id, label: 'Archimedes' }),
    focusAgents: () => [{ id: 'hermes' }, ...ROUTED.map(id => ({ id }))],
    rowAgent: r => r.agent || 'hermes', focusOf: () => null, focusHoldUntil: 0,
    focusOptions: () => channels.map((c, i) => ({ kind: 'space', key: c.id, label: c.name, recent: 10 - i, unread: 0 })),
    spaces: () => channels, spaceAgent: s => s?.agent || 'hermes', spaceContains: (k, sid) => !!sets.get(k)?.has(sid),
    LIVE: { agentOf: () => pin, session: id => session && session.id === id ? session : null, chanStore: { move: (sid, to, a) => { moves.push([sid, to, a]); for (const s of sets.values()) s.delete(sid); if (to) sets.get(to).add(sid); } } },
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
  return { moveToChannel: env.api.moveToChannel, closeSpacePicker: env.api.closeSpacePicker, get picker() { return env.api.picker; }, body, moves, toasts, fire, sets };
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

test('the picker is for the row\'s own agent: a main row whose id a routed agent also uses stays main', () => {
  for (const [agent, profile] of [['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']]) {
    // main row listed in Activity, id-global pin points at the routed agent: still main's channels
    const m = picker({ session: { id: 't1' }, pin: agent });
    assert.equal(m.moveToChannel('w', 't1'), true, profile); assert.equal(m.picker.agent, 'hermes', `${profile}: main row`);
    // the routed agent's own row: its channels
    const r = picker({ session: { id: 't1', agent }, pin: '' });
    assert.equal(r.moveToChannel('w', 't1'), true, profile); assert.equal(r.picker.agent, agent, `${profile}: routed row`);
  }
});
