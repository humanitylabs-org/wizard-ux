// Channels view (wizard-ux issue 1254; on for everyone since issue 1258): the real block from core/chats.js on fake Spaces/rows.
import test from 'node:test';
import { rowSheet } from './fixtures/row-sheet-harness.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withLiveParts } from './fixtures/live-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { valueOf } from './fixtures/r7A-css.mjs';
import { skinPage } from './fixtures/r8A-skin-paint.mjs';
import { listFixture } from './fixtures/chats-list-render.mjs';
import { block as fnBlock, expression, runRecording } from './fixtures/source-slice.mjs';
import { stmt, tap, plain } from './fixtures/pB-slice.mjs'; // live.js parts moved out verbatim (issue 1665)
const src = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
// The real list renderer (tests/fixtures/chats-list-render.mjs) with the Channels block loaded: names the Channels
// code reaches that the fixture does not have render nothing ('').
function channelsList(extra) {
  const f = listFixture(); Object.assign(f.ctx, { chanHead: () => '', chanOpen: () => null, chanHold() {} }, extra);
  const render = q => { for (let n = 0; n < 40; n++) { try { return f.render(q); } catch (e) { const m = /^(\w+) is not defined$/.exec(e.message); if (!m) throw e; f.ctx[m[1]] = () => ''; } } throw new Error('too many'); };
  return { f, render };
}
const srcLine = (from, k) => { const i = from.indexOf(k); assert.ok(i >= 0, k); return from.slice(from.lastIndexOf('\n', i) + 1, from.indexOf('\n', i)); };
const app = withAppParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));
const cut = (a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); return src.slice(i, src.indexOf(b, i)); };
const block = withParts(cut('  /* Channels view (wizard-ux issue 1254)', '  function clearAll(w)'));

const H = 3600e3, NOW = Date.UTC(2026, 10, 10, 12);
function fixture({ rows = [], spacesList, agents = {}, history = {}, full = {}, sessions = {}, owner = 'James de Fleur', marksAt = null, on = null } = {}) {
  const spacesData = spacesList || [
    { id: 'launch', name: 'Launch', threads: ['a', 'b', 'c'] },
    { id: 'voice', name: 'Voice', threads: ['d'] },
    { id: 'host-ops', name: 'Host ops', agent: 'host', threads: ['h1'] },
    { id: 'box', name: 'Box', agent: 'container', threads: ['k1'] },
    { id: 'locked', name: 'Locked', agent: 'restricted', threads: ['r1'] },
  ];
  const wins = { w: { id: 'w', thread: null, focus: null } };
  const store = new Map(), renders = [], focusCalls = [], sheets = [], toasts = [], ops = [], reads = [], viewer = [], drafts = [], marks = [];
  const sheetEl = { insertAdjacentHTML: (_, html) => sheets.push(html), querySelector: () => null };
  const agentOf = id => agents[id] || '';
  // Issue 1316: this device's channel watermarks (since = read up to then for a channel never read here).
  if (marksAt) store.set(READ_KEY, JSON.stringify(marksAt));
  const env = {
    document: { documentElement: { dataset: { tweaks: 'wizard/desktop-chats' } } },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    requestAnimationFrame: () => {}, Date: class extends Date { static now() { return env._now ?? NOW; } }, _now: null,
    W: new Proxy({}, { get: (_, id) => wins[id] }), owner: id => id, save() {}, elOf: () => null,
    esc: s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    clip: (s, n) => String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s), ago: t => Math.round((NOW - Date.parse(t)) / H) + 'h',
    ch: id => (env._c[id] = env._c[id] || {}), _c: {},
    spaces: () => spacesData, spaceAgent: s => s?.agent || 'hermes',
    visibleSpaces: () => spacesData,
    spaceContains: (key, sid) => !!spacesData.find(s => s.id === key)?.threads.includes(sid),
    spacesOf: sid => spacesData.filter(s => (s.agent || 'hermes') === (agentOf(sid) || 'hermes') && s.threads.includes(sid)),
    focusOf: w => w.focus || null,
    focusedAgent: f => f?.kind === 'agent' ? f.key : f?.kind === 'space' ? (spacesData.find(s => s.id === f.key)?.agent || 'hermes') : '',
    setFocus: (w, f) => { focusCalls.push(f); w.focus = f; renders.push('focus'); return true; },
    rerenderList: () => renders.push('list'), renderChatList: () => renders.push('list'),
    isWorking: s => s.status === 'running', attOf: s => s.attention || null,
    rowOf: (wid, sid) => env._rowOf ? env._rowOf(wid, sid) : sessions[sid] || null,
    snoozeLast: () => !!env._snoozeLast, _snoozeLast: false, deferredOf: s => !!s.deferred && !s.archived,
    LIVE: { isNew: s => !!s.fresh && !s.archived, agentOf, ownerOf: s => s.owner ?? agents[s.id] ?? '', cardAt: s => new Date(s.at).toISOString(), session: id => sessions[id] || null, sessionFor: (id, a) => sessions[a ? a + '|' + id : id] || null,
      firstMessages: async (id, agent) => { reads.push(agent ? agent + '|' + id : id); const h = history[agent ? agent + '|' + id : id]; if (h instanceof Error) throw h; return h || []; },
      // Issue 1266: a long thread's full read for its reply count, the row's own read time, and the seen write.
      threadRows: async (id, agent) => { const k = agent ? agent + '|' + id : id; reads.push('full:' + k); const h = full[k] ?? history[k]; if (h instanceof Error) throw h; return h || []; },
      readAt: s => s.readAt || 0, markSeen: list => { marks.push(...list.map(s => (s.owner ? s.owner + '|' : '') + s.id)); for (const s of list) s.fresh = false; }, prefOps: o => { ops.push(...o); for (const x of o) { const sp = spacesData.find(s => x.key === `spaces/${s.id}/name`); if (sp) sp.name = x.item; } return Promise.resolve(true); } },
    // KIT.parseRows stand-in: a row {role:'user', text, files} is an owner turn.
    toTurns: rows => rows.filter(r => r.role === 'user' || r.role === 'assistant').map(r => r.role === 'user' ? { u: { text: r.text || '', files: r.files || [], images: r.images || [], at: r.at } } : { a: { text: r.text, at: r.at } }),
    mediaOfFile: f => ({ id: f.id, name: f.name, mime: f.mime || '', kind: /^image\//.test(f.mime || '') ? 'image' : 'file', url: f.id ? `/wizard/files/${f.id}/content` : '' }),
    KIT: { viewer: { open: (g, i) => viewer.push([g, i]) }, drafts: { _d: {}, get(k) { return this._d[k] || { text: '', files: [] }; }, set(k, text, files = []) { this._d[k] = { text, files }; }, clear(k) { delete this._d[k]; } } }, H: { win: id => wins[id] }, CH: {}, holdList: () => false, setTimeout: fn => fn(), clearTimeout() {},
    window: { WizConfig: { owner: () => owner }, ...(on ? { addEventListener: (t, fn) => { on[t] = fn; } } : {}) }, PIN_SVG: '<svg pin></svg>', RENAME_SVG: '<svg rn></svg>', ACT: { done: { icon: '<svg ar></svg>' } },
    track: { querySelector: () => sheetEl }, closeRowSheet() { env.rowSheet = null; }, vib() {}, toast: (...a) => toasts.push(a[1]), rowSheet: null,
    norm: s => String(s).toLowerCase().trim(), openNewDraft: (id, r) => drafts.push([id, r]),
    AGS: () => ({ defaultId: () => 'hermes', isOther: a => !!a && a !== 'hermes', isPrivate: a => a.id === 'restricted', sigil: a => `<i class="ag-sig" data-agent="${a.id}"></i>` }), agentRec: id => ({ id }),
    // The channel's message box (wizard-ux issue 1258): the thread composer's helpers and the real send path's seam.
    winAgent: w => w.focus?.kind === 'agent' && w.focus.key !== 'hermes' ? w.focus.key : '', PREVIEW: {}, fileUrl: id => `/wizard/files/${id}/content`, CLIP_SVG: '<svg clip></svg>',
    hasContent: (t, files = []) => !!String(t || '').trim() || files.some(f => f && (f.id || f.uploading)),
    attachTray: c => (c.files || []).length ? `<div class="ch-tray">${c.files.map(f => `<i data-f="${f.id}"></i>`).join('')}</div>` : '',
    pendRef: f => f && f.id ? { id: f.id, name: f.name, mime: f.mime, bytes: f.bytes } : null, growTa() {}, syncSend() {}, viewContext: (id, how) => 'ctx:' + how,
    PW: { modelLabel: (w, s) => `<button class="ch-mlabel ch-model" data-chmodel data-for="${w.thread}">Default model</button>`, micBtn: id => `<button class="ch-mic" data-chmic data-w="${id}"></button>`, newModel: c => c.newModel || null, ensureModels() {} },
    sendChat: (...a) => { env._sends.push(a); return env._sendResult; }, _sends: [], _sendResult: null,
    orderBar: (label, attr, orders, cur, word) => `<div class="ch-rdy-bar" aria-label="${label}">${orders.map(o => `<button ${attr}="${o}" aria-pressed="${cur === o}">${word(o)}</button>`).join('')}</div>`,
  };
  vm.createContext(env); modelContext(env);
  vm.runInContext(block + ';this.api={chanEmojiPick,chanEmojiTap,chanSetEmoji,openChannelEmoji,chanFace,setChanModel,chanModel,chanOpen,channelsFor,inChannel,chanName,openChannel,channelBack,channelsBody,channelFeed,chanHead,channelClick,chanPruned,openChannelSheet,submitChannelRename,firstPost,chanComposer,chanDraftKey,chanSpaceOf,channelSend,chanSeenPaint,chanSeenRow,chanHold,chanScrolled,chanUser,chanToEnd,chanOwnPost,chanReplies,chanEditUnsent,chanReadAt,chanReadKey,chanReadFeed,chanNewCount,chanReadTo,chanDropSending,REPLIES,CHAN_SENDING,FIRST,CHAN_ARCHIVE_PRUNE_DAYS,get view(){return chanView}};', env);
  return { ...env.api, get view() { return env.api.view; }, w: wins.w, rows, renders, focusCalls, store, env, sheets, toasts, ops, reads, viewer, drafts, marks, spacesData };
}
const READ_KEY = 'wos.chats.channel-read.v1';
// Every channel read up to `h` hours ago (issue 1316's watermark): posts that changed later are new.
const readTo = h => ({ since: NOW - h * H, at: {} });
const row = (id, at, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', at: NOW - at * H, ...extra });
const click = attrs => ({ target: { closest: sel => { const k = sel.slice(1, -1); return k in attrs ? { dataset: { [k.replace(/^data-/, '').replace(/-./g, m => m[1].toUpperCase())]: attrs[k] } } : null; } } });

test('the phone Back hook goes through CHATS.channelBack', () => {
  // the phone's real backStep, on a Chats list with an open channel feed
  const back = (channelBack, c = { id: 'c1', app: 'chats', thread: null }) => {
    const seen = [], ctx = runRecording(`${fnBlock(app, '  function backStep(skipHosted')}\nthis.back = backStep;`, { phoneBack: { run: () => false }, desks: [{ focus: 'c1' }], idx: 0, W: { c1: c }, rvCoach: false, window: {},
      CHATS: { isHosted: () => false, hasFilter: () => false, ch: () => ({ q: '' }), threadBack: () => 'thread', channelBack: f => (seen.push(f.id), channelBack), readyBack: () => false } });
    return [ctx.back(), seen];
  };
  assert.deepEqual(back(true), ['channel', ['c1']], 'a channel feed: Back goes to Channels');
  assert.notEqual(back(false)[0], 'channel', 'no feed open: Back goes on');
  assert.deepEqual(back(true, { id: 'c1', app: 'chats', thread: 't1' }), ['thread', []], 'an open thread steps back first');
});

test('Channels lists Spaces A–Z by default, General last, with one aggregate marker each', () => {
  const rows = [row('a', 1, { status: 'running' }), row('b', 2, { attention: { state: 'needs_you' } }), row('d', 3, { status: 'running' }), row('g', 4), row('old', 40, { archived: true })];
  const f = fixture();
  assert.deepEqual(f.channelsFor(f.w).map(c => c.name), ['Box', 'Host ops', 'Launch', 'Locked', 'Voice', 'General']);
  const html = f.channelsBody(f.w, rows);
  const chans = html.split('class="ch-chan"').slice(1);
  assert.deepEqual(chans.map(c => c.match(/data-chchan="([^"]+)"/)[1]), ['box', 'host-ops', 'launch', 'locked', 'voice', '__general__']);
  // Issue 1269: one slot at the right, in a fixed order: spinner (working), amber (needs you), green (new replies).
  assert.match(chans[2], /<\/b><span class="ch-chan-ind"><i class="ch-spin" role="img" aria-label="Working"><\/i><i class="ch-chan-dot" role="img" aria-label="Needs you"><\/i><\/span><\/button>/, 'working and needs you, in order, in the one slot');
  assert.match(chans[4], /<span class="ch-chan-ind"><i class="ch-spin" role="img" aria-label="Working"><\/i><\/span>/);
  assert.doesNotMatch(chans[5], /ch-chan-dot|ch-spin/, 'General: g is done, so no marker');
  assert.doesNotMatch(html, /<time>/, 'no timestamps or previews on channel lines');
});

test('the chevron expands working, needs-you and last-24h posts, newest first; tapping one opens the thread', () => {
  const rows = [row('a', 30, { status: 'running' }), row('b', 2), row('c', 50), row('g', 1)];
  const f = fixture();
  assert.equal(f.channelClick(click({ 'data-chchanx': 'launch' }), 'w', f.w), true);
  const html = f.channelsBody(f.w, rows);
  const launch = html.split('class="ch-chan"')[3];
  assert.deepEqual([...launch.matchAll(/class="ch-chan-post" data-chopen="([^"]+)"/g)].map(m => m[1]), ['b', 'a'], 'c is 50h old and done');
  const general = html.split('class="ch-chan"')[6];
  assert.doesNotMatch(general, /ch-chan-recent/, 'only the expanded channel shows its posts');
});

test('issue 1531: a channel with only older chats never reads as empty; a channel with none says so', () => {
  const spacesList = [{ id: 'home', name: 'Home', threads: ['h1', 'h2', 'h3', 'h4', 'h5'] }, { id: 'quiet', name: 'Quiet', threads: [] }];
  const rows = [row('h1', 30), row('h2', 50), row('h3', 70), row('h4', 90), row('h5', 100)];
  for (const [agent, ag] of [['main', ''], ['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']]) {
    const sl = spacesList.map(s => ag ? { ...s, agent: ag } : s), agents = Object.fromEntries(rows.map(r => [r.id, ag]));
    const f = fixture({ spacesList: sl, agents, sessions: Object.fromEntries(rows.map(r => [r.id, r])) });
    if (ag) f.w.focus = { kind: 'agent', key: ag };
    f.channelClick(click({ 'data-chchanx': 'home' }), 'w', f.w); f.channelClick(click({ 'data-chchanx': 'quiet' }), 'w', f.w);
    const html = f.channelsBody(f.w, rows.map(r => ag ? { ...r, owner: ag } : r)), chans = html.split('class="ch-chan"').slice(1);
    const home = chans.find(c => c.includes('data-chchan="home"')), quiet = chans.find(c => c.includes('data-chchan="quiet"'));
    assert.deepEqual([...home.matchAll(/class="ch-chan-post" data-chopen="([^"]+)"/g)].map(m => m[1]), ['h1', 'h2', 'h3'], `${agent}: the newest three, newest first`);
    assert.doesNotMatch(home, /Nothing in the last 24 hours|ch-none/, `${agent}: no empty line for a channel with chats`);
    assert.match(quiet, /<span class="ch-none">No chats yet<\/span>/, `${agent}: a channel with no chats keeps an empty line`);
  }
  // Store off (Spaces): chats filed in the Space but not in the loaded list still count (Codex P2).
  const sp = fixture({ spacesList });
  sp.channelClick(click({ 'data-chchanx': 'home' }), 'w', sp.w); sp.channelClick(click({ 'data-chchanx': 'quiet' }), 'w', sp.w);
  const spHtml = sp.channelsBody(sp.w, []).split('class="ch-chan"').slice(1);
  assert.match(spHtml.find(c => c.includes('data-chchanx="home"')), /data-chchan="home"><span>5 chats, open channel<\/span>/);
  assert.match(spHtml.find(c => c.includes('data-chchanx="quiet"')), /No chats yet/);
  // Older chats only the box's channel store knows about: their number and a way into the channel.
  const f = fixture({ spacesList });
  f.env.LIVE.chanStore = { state: () => ({ sort: 'az', channels: [{ id: 'home', count: 6 }, { id: 'quiet', count: 0 }] }), patch: async () => ({ ok: true }), move() {} };
  f.channelClick(click({ 'data-chchanx': 'home' }), 'w', f.w); f.channelClick(click({ 'data-chchanx': 'quiet' }), 'w', f.w);
  const html = f.channelsBody(f.w, []), chans = html.split('class="ch-chan"').slice(1);
  assert.match(chans.find(c => c.includes('data-chchanx="home"')), /<button type="button" class="ch-chan-post ch-chan-more" data-chchan="home"><span>6 chats, open channel<\/span><\/button>/);
  assert.match(chans.find(c => c.includes('data-chchanx="quiet"')), /No chats yet/);
});

test('opening a channel is its Space Focus; Back returns to the list with the old Focus', () => {
  const f = fixture();
  f.w.focus = { kind: 'agent', key: 'hermes' };
  assert.equal(f.channelClick(click({ 'data-chchan': 'voice' }), 'w', f.w), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.w.focus)), { kind: 'space', key: 'voice' });
  assert.equal(f.chanOpen(f.w).name, 'Voice');
  assert.match(f.chanHead(f.w, f.chanOpen(f.w)), /data-chchanback[^]*# ?<\/span>Voice/);
  // thread → channel: a thread open in this window keeps the feed under it (Back from a thread is threadBack's).
  f.w.thread = 'd'; assert.equal(f.channelBack(f.w), false); f.w.thread = null;
  assert.equal(f.channelBack(f.w), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.w.focus)), { kind: 'agent', key: 'hermes' });
  assert.equal(f.w.chan, null); assert.equal(f.chanOpen(f.w), null);
  assert.equal(f.channelBack(f.w), false, 'at the list Back falls through (never leaves Chats here)');
});

test('a stale feed (Focus moved since) never hands its old Back target to the next channel', () => {
  const f = fixture();
  f.w.focus = null; f.openChannel(f.w, 'launch');               // from All
  f.w.focus = { kind: 'agent', key: 'container' };              // the focus strip moved on: the Launch feed is gone
  assert.equal(f.chanOpen(f.w), null);
  f.openChannel(f.w, 'box');                                    // opened from the container list
  assert.equal(f.channelBack(f.w), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.w.focus)), { kind: 'agent', key: 'container' }, 'Back lands on the list it was opened from, not All');
});

test('General keeps the agent Focus and holds only chats in no Space; a Focus tap elsewhere leaves the feed', () => {
  const f = fixture();
  f.w.focus = { kind: 'space', key: 'launch' };
  f.openChannel(f.w, '__general__');
  assert.deepEqual(JSON.parse(JSON.stringify(f.w.focus)), { kind: 'agent', key: 'hermes' });
  const g = f.chanOpen(f.w); assert.equal(g.general, true);
  const html = f.channelFeed(f.w, g, [row('a', 2), row('g', 3), row('g2', 1)]);
  assert.deepEqual([...html.matchAll(/class="ch-post-b" data-chopen="([^"]+)"/g)].map(m => m[1]), ['g', 'g2'], 'oldest to newest, filed chats excluded');
  f.w.focus = { kind: 'space', key: 'voice' }; // the focus strip moved on
  assert.equal(f.chanOpen(f.w), null);
});

test('issue 1440: no Open / Needs you / All row; every post shows, marked for the jump pills; posts truncate at about 240 characters with more', async () => {
  const long = 'x'.repeat(300), say = (...t) => [{ role: 'user', text: long }, ...t.map(x => ({ role: 'assistant', text: x }))];
  const rows = [row('a', 5, { request: long, messageCount: 5 }), row('b', 3, { attention: { state: 'needs_you' }, messageCount: 2 }), row('c', 1, { archived: true })];
  const f = fixture({ history: { a: say('one', 'two', 'three', 'four'), b: say('ok') } }); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w), ids = h => [...h.matchAll(/class="ch-post-b" data-chopen="([^"]+)"/g)].map(m => m[1]);
  f.channelFeed(f.w, open, rows); await new Promise(r => setImmediate(r));
  let html = f.channelFeed(f.w, open, rows);
  assert.deepEqual(ids(html), ['a', 'b', 'c'], 'every post, the done one too'); assert.match(html, /Done/);
  assert.doesNotMatch(html, /data-chchanf|ch-rdy-bar/, 'no filter row');
  assert.match(html, /class="ch-post" data-chmark="needs" data-morph-key="post:b"/, 'the needs-you post is an amber marker');
  assert.doesNotMatch(html, /data-chmark="[^"]*" data-morph-key="post:(a|c)"/, 'read posts carry no marker');
  assert.match(html, /4 replies/); assert.match(html, /1 reply</); assert.match(html, /Needs you/);
  assert.match(html, /data-chpostmore="a" aria-expanded="false">more/);
  assert.match(html, /class="ch-post-t clamp">x{300}</, 'long text is clamped at 4 lines by CSS');
  f.channelClick(click({ 'data-chpostmore': 'a' }), 'w', f.w);
  assert.match(f.channelFeed(f.w, open, rows), /class="ch-post-t">x{300}</);
  // The old filter taps do nothing any more; the feed's pills go to the shared jump.
  const before = f.channelFeed(f.w, open, rows);
  assert.equal(f.channelClick(click({ 'data-chchanf': 'needs' }), 'w', f.w), false);
  assert.equal(f.channelFeed(f.w, open, rows), before);
  const went = []; f.env.jumpGo = (id, dir) => { went.push([id, dir]); return true; };
  assert.equal(f.channelClick(click({ 'data-chjump': 'up' }), 'w', f.w), true);
  assert.deepEqual(went, [['w', 'up']]);
});

test('issue 1440 main vs routed: a host-profile, container or restricted channel marks its own posts for the pills', () => {
  const agents = { h1: 'host', k1: 'container', r1: 'restricted', a: '' };
  for (const [cid, sid, kind] of [['launch', 'a', 'main'], ['host-ops', 'h1', 'host-profile'], ['box', 'k1', 'container'], ['locked', 'r1', 'restricted']]) {
    const f = fixture({ agents }); f.openChannel(f.w, cid);
    const html = f.channelFeed(f.w, f.chanOpen(f.w), [row(sid, 1, { attention: { state: 'needs_you' } }), row(sid + 'x', 2)]);
    assert.match(html, new RegExp(`data-chmark="needs" data-morph-key="post:${sid}"`), `${kind}: its needs-you post is an amber marker`);
    assert.doesNotMatch(html, /data-chchanf/, `${kind}: no filter row`);
  }
});

test('the Activity / Channels tab choice is remembered on the device; Activity is the default', () => {
  const f = fixture();
  assert.equal(f.view, 'activity');
  assert.match(f.chanHead(f.w, null), /data-chview="activity" aria-pressed="true">Activity/);
  assert.doesNotMatch(f.chanHead(f.w, null), /data-chchansort/, 'the channel sort shows on Channels only');
  f.channelClick(click({ 'data-chview': 'channels' }), 'w', f.w);
  assert.equal(f.view, 'channels'); assert.equal(f.store.get('wos.chats.view.v1'), 'channels');
  assert.equal(fixture().view, 'activity', 'a fresh device starts on Activity');
});

test('the header tabs read Channels | Activity, left to right (issue 1467)', () => {
  const f = fixture(), html = f.chanHead(f.w, null);
  assert.ok(html.indexOf('data-chview="channels"') >= 0 && html.indexOf('data-chview="channels"') < html.indexOf('data-chview="activity"'), 'Channels is the left tab');
});

test('main vs routed: host-profile, container and restricted rows belong only to their own agent\'s channels', () => {
  const agents = { h1: 'host', k1: 'container', r1: 'restricted', h2: 'host', a: '' };
  const f = fixture({ agents });
  const by = id => f.channelsFor(f.w).find(c => c.id === id);
  for (const [chan, sid] of [['launch', 'a'], ['host-ops', 'h1'], ['box', 'k1'], ['locked', 'r1']]) {
    assert.equal(f.inChannel(by(chan), row(sid, 1)), true, `${sid} in ${chan}`);
    assert.equal(f.inChannel(by('__general__'), row(sid, 1)), false);
  }
  // A routed row whose id is listed in a main Space is not that Space's post (one Space per chat per agent).
  assert.equal(f.inChannel(by('launch'), row('h1', 1)), false);
  assert.equal(f.inChannel(by('__general__'), row('h2', 1)), true, 'an unfiled routed chat is in General');
  assert.equal(f.chanName(row('k1', 1)), 'Box'); assert.equal(f.chanName(row('h2', 1)), 'General');
  // An agent Focus lists only that agent's channels.
  f.w.focus = { kind: 'agent', key: 'container' };
  assert.deepEqual(f.channelsFor(f.w).map(c => c.id), ['box', '__general__']);
  // The restricted agent's feed wears that agent's own sigil.
  f.openChannel(f.w, 'locked');
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [row('r1', 1, { status: 'running', messageCount: 3 })]), /data-agent="restricted"[^]*Working/);
});

test('posting reuses the Space-fixed-at-send path: a new chat sent from a channel files into its Space Focus', async () => {
  // the real sendChat with a fake outbox that gives the new chat its id and agent
  const send = async (opts, focus) => {
    const ctx = runRecording(`${fnBlock(src, '  async function sendChat(')}\nthis.sendChat = sendChat;`, {
      W: { w1: { id: 'w1', app: 'chats', thread: null } }, ch: () => ({ draft: '', files: [] }), focusOf: () => focus, AGID: '', MAX_FILES: 10, window: {}, Promise, Date, Object, Array, String, JSON, Math, Error, Set, Map,
      OUTBOX: { enqueue: async it => ({ ...it, sessionId: 's9', agent: 'merlin', durable: true }) }, joinWords: (a, b) => [a, b].filter(Boolean).join('\n\n'),
      KIT: { drafts: { get: () => ({}), clear() {}, set() {} } }, isWorking: () => false, pendRef: f => f });
    await ctx.sendChat('w1', 'hello', 'typing', null, opts);
    return ctx.calls.filter(c => c[0] === 'spaceMember').map(c => c.slice(1));
  };
  // Issue 1261: the send's own agent rides along, so the channel store files the chat by agent plus id.
  assert.deepEqual(await send({ sid: '__new__', space: 'launch' }, null), [['launch', 's9', true, 'merlin']], 'a channel\'s box (opts.space)');
  assert.deepEqual(await send({ sid: '__new__' }, { kind: 'space', key: 'voice' }), [['voice', 's9', true, 'merlin']], 'the Space in Focus');
  assert.deepEqual(await send({ sid: '__new__', away: true }, { kind: 'space', key: 'voice' }), [], 'a send from elsewhere does not take the Focus');
  assert.deepEqual(await send({ sid: 't1' }, { kind: 'space', key: 'voice' }), [], 'a reply files nothing');
  // Back on the desktop list goes through clearFilter, which closes a feed after search and chips.
  const clear = (c, channelBack) => runRecording(`${fnBlock(src, '  function clearFilter(w) {')}\nthis.clear = clearFilter;`, { ch: () => c, channelBack, window: { WizCore: {} } }).clear({ id: 'w1', thread: null });
  assert.equal(clear({ q: 'x', filter: 'ready' }, () => true), 'search');
  assert.equal(clear({ q: '', filter: 'ready' }, () => true), 'chip');
  assert.equal(clear({ q: '', filter: '' }, () => true), 'channel');
  assert.equal(clear({ q: '', filter: '' }, () => false), false);
});

const ids = html => [...html.matchAll(/data-chchan="([^"]+)"/g)].map(m => m[1]);
const sheetButtons = html => [...html.matchAll(/data-(rsch\w+)>(?:<svg[^]*?<\/svg>|<span[^>]*>[^<]*<\/span>)?([^<]*)</g)].map(m => m[2]);

test('a post is the owner\'s first message with photo thumbnails, never a title card; read once per thread', async () => {
  const history = { a: [{ role: 'user', text: 'Please fix the boot logo\non the phone', files: [{ id: 'f1', name: 'shot.png', mime: 'image/png' }, { id: 'f2', name: 'notes.pdf', mime: 'application/pdf' }], at: NOW - 5 * H }, { role: 'assistant', text: 'On it' }] };
  const sessions = { a: row('a', 5, { messageCount: 7 }) }; // 7 stored messages, one visible reply
  const f = fixture({ history, sessions }); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w), rows = [sessions.a];
  let html = f.channelFeed(f.w, open, rows);
  assert.match(html, /ch-post-wait/, 'a skeleton while the first message is read, not the title');
  assert.doesNotMatch(html, />T a</);
  await new Promise(r => setImmediate(r));
  html = f.channelFeed(f.w, open, rows);
  assert.deepEqual(f.reads, ['a'], 'one history read for the thread');
  assert.match(html, /class="ch-post-me"[^>]*>J</); assert.match(html, /<b>James de Fleur<\/b><time>5h<\/time>/);
  assert.match(html, /class="ch-post-t">Please fix the boot logo\non the phone</);
  assert.doesNotMatch(html, /<b>T a<\/b>/, 'no title card');
  assert.deepEqual([...html.matchAll(/data-chpostimg="a" data-chpostag="" data-i="(\d)"[^]*?<img src="([^"]+)"/g)].map(m => m[2]), ['/wizard/files/f1/content'], 'images only');
  assert.match(html, /<span>1 reply<\/span>/, 'the one reply James sees, not message_count - 1');
  f.channelFeed(f.w, open, rows); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a'], 'kept per thread');
  // Tapping a thumbnail opens the shared media viewer on that photo.
  assert.equal(f.channelClick(click({ 'data-chpostimg': 'a', 'data-i': '0' }), 'w', f.w), true);
  assert.equal(f.viewer.length, 1); assert.equal(f.viewer[0][0][0].url, '/wizard/files/f1/content'); assert.equal(f.viewer[0][1], 0);
});

test('Agent Service firstRequest / firstAttachments win over a history read once list rows carry them', () => {
  const s = row('a', 2, { firstRequest: 'Ship the channels review', firstAttachments: [{ id: 'p1', name: 'p.jpg', mime: 'image/jpeg' }] });
  const f = fixture({ sessions: { a: s } }); f.openChannel(f.w, 'launch');
  const html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
  assert.match(html, />Ship the channels review</); assert.match(html, /\/wizard\/files\/p1\/content/);
  assert.deepEqual(f.reads, []);
});

test('A–Z / Z–A sort, pinned channels on top in pin order, General always last', () => {
  const f = fixture();
  assert.match(f.chanHead(f.w, null), /data-chview/);
  f.channelClick(click({ 'data-chview': 'channels' }), 'w', f.w);
  assert.match(f.chanHead(f.w, null), /data-chchansort="az" aria-pressed="true"[^]*A–Z[^]*data-chchansort="za" aria-pressed="false"/);
  f.channelClick(click({ 'data-chchansort': 'za' }), 'w', f.w);
  assert.deepEqual(f.channelsFor(f.w).map(c => c.id), ['voice', 'locked', 'launch', 'host-ops', 'box', '__general__']);
  assert.equal(JSON.parse(f.store.get('wos.chats.channel-prefs.v1')).sort, 'za');
  // Pin Voice then Box from the channel sheet: they sit on top in pin order, the rest stay sorted.
  for (const id of ['voice', 'box']) { f.openChannelSheet('w', id); f.channelClick(click({ 'data-rschpin': '' }), 'w', f.w); }
  f.channelClick(click({ 'data-chchansort': 'az' }), 'w', f.w);
  assert.deepEqual(f.channelsFor(f.w).map(c => c.id), ['voice', 'box', 'host-ops', 'launch', 'locked', '__general__']);
  assert.match(f.channelsBody(f.w, []).split('class="ch-chan pinned"')[1], /aria-label="Pinned"/);
  assert.equal(f.toasts.at(-1), 'Pinned');
});

test('long-press sheet on a channel: Pin, Rename, Emoji…, Archive channel, Mark channel read, New post; General gets Mark channel read and New post', () => {
  const f = fixture();
  f.openChannelSheet('w', 'launch');
  assert.match(f.sheets.at(-1), /aria-label="Channel actions"[^]*# Launch/);
  // Mark channel read comes with Channels since wizard-ux issue 1358 (it had its own switch).
  assert.deepEqual(sheetButtons(f.sheets.at(-1)), ['Pin', 'Rename', 'Emoji…', 'Archive channel', 'Mark channel read', 'New post']);
  assert.doesNotMatch(f.sheets.at(-1), /Delete/i);
  f.openChannelSheet('w', '__general__');
  assert.deepEqual(sheetButtons(f.sheets.at(-1)), ['Mark channel read', 'New post']);
  // New post opens the channel with its message box ready (wizard-ux issue 1258), never a separate New chat draft.
  f.openChannelSheet('w', 'voice'); f.channelClick(click({ 'data-rschnew': '' }), 'w', f.w);
  assert.deepEqual(JSON.parse(JSON.stringify(f.w.focus)), { kind: 'space', key: 'voice' }); assert.deepEqual(f.drafts, []);
  // Rename is one item edit on spaces/<id>/name.
  f.openChannelSheet('w', 'launch'); f.channelClick(click({ 'data-rschrename': '' }), 'w', f.w);
  assert.match(f.sheets.at(-1), /data-chrnform[^]*Rename channel[^]*value="Launch"/);
  f.submitChannelRename({ querySelector: () => ({ value: '  Launch  week ', focus() {} }) });
  assert.deepEqual(JSON.parse(JSON.stringify(f.ops)), [{ op: 'set', key: 'spaces/launch/name', item: 'Launch week' }]);
  f.openChannelSheet('w', 'voice'); f.channelClick(click({ 'data-rschrename': '' }), 'w', f.w);
  f.submitChannelRename({ querySelector: () => ({ value: 'launch WEEK', focus() {} }) });
  assert.equal(f.ops.length, 1, 'a name another channel of this agent has is refused'); assert.match(f.toasts.at(-1), /Already a channel/);
  assert.equal(f.openChannelSheet('w', 'nope'), false);
});

test('Archive: an archived channel moves to a folded Archive section, Restore brings it back, 30 idle days prune it', () => {
  const f = fixture(), rows = [row('a', 2), row('d', 24 * 40)];
  f.openChannelSheet('w', 'voice'); f.channelClick(click({ 'data-rschpin': '' }), 'w', f.w);
  f.openChannelSheet('w', 'voice'); f.channelClick(click({ 'data-rscharch': '' }), 'w', f.w);
  assert.equal(f.toasts.at(-1), 'Archived # Voice');
  assert.ok(!f.channelsFor(f.w).some(c => c.id === 'voice')); assert.deepEqual(f.channelsFor(f.w, { archived: true }).map(c => c.id), ['voice']);
  assert.equal(JSON.parse(f.store.get('wos.chats.channel-prefs.v1')).pins.length, 0, 'archiving unpins');
  let html = f.channelsBody(f.w, rows);
  assert.match(html, /class="ch-sec ch-chan-arch" data-sec="chan-archive"><button type="button" class="ch-sec-h" data-chchanarch aria-expanded="false"><span>Archive<\/span><small>1<\/small>/, 'folded by default');
  assert.doesNotMatch(html.split('ch-chan-arch')[1], /data-chchan="voice"/);
  f.channelClick(click({ 'data-chchanarch': '' }), 'w', f.w);
  html = f.channelsBody(f.w, rows);
  assert.match(html.split('ch-chan-arch')[1], /data-chchan="voice"/);
  // The channel's chat stays where it is (Activity's # line still names it).
  assert.equal(f.chanName(row('d', 1)), 'Voice');
  // Archived sheet: Restore, no New post.
  f.openChannelSheet('w', 'voice'); assert.deepEqual(sheetButtons(f.sheets.at(-1)), ['Pin', 'Rename', 'Emoji…', 'Restore', 'Mark channel read']);
  // Pruning: newest chat 40 days old and archived 31 days ago → gone from Archive (the Space itself is untouched).
  assert.equal(f.CHAN_ARCHIVE_PRUNE_DAYS, 30);
  const p = JSON.parse(f.store.get('wos.chats.channel-prefs.v1')); p.archived.voice = new Date(NOW - 31 * 24 * H).toISOString(); f.store.set('wos.chats.channel-prefs.v1', JSON.stringify(p));
  assert.equal(f.chanPruned({ id: 'voice', name: 'Voice', agent: 'hermes' }, rows), true);
  assert.doesNotMatch(f.channelsBody(f.w, rows), /ch-chan-arch/);
  assert.equal(f.chanPruned({ id: 'voice', name: 'Voice', agent: 'hermes' }, [row('d', 24 * 10)]), false, 'a chat 10 days old keeps it');
  assert.ok(f.spacesData.some(s => s.id === 'voice'));
  f.channelClick(click({ 'data-chchanarch': '' }), 'w', f.w); // fold again
  p.archived.voice = new Date(NOW - 1 * H).toISOString(); f.store.set('wos.chats.channel-prefs.v1', JSON.stringify(p));
  f.openChannelSheet('w', 'voice'); f.channelClick(click({ 'data-rscharch': '' }), 'w', f.w);
  assert.equal(f.toasts.at(-1), 'Restored # Voice'); assert.ok(f.channelsFor(f.w).some(c => c.id === 'voice'));
});

test('the channel name shows once in an open feed: no focus strip, no title-bar label', () => {
  // Issue 1336: with Channels on there is no focus strip at all (agents live in the Channels list's Agents row).
  const strip = vm.runInNewContext(`(feed, chanOn) => \`${expression(src, "${feed || chanOn ? '' : focusStrip(w)}")}\``, { focusStrip: () => '<div class="ch-focus"></div>', w: {} });
  assert.equal(strip(false, true), ''); assert.equal(strip(true, false), ''); assert.equal(strip(false, false), '<div class="ch-focus"></div>');
  const title = (agents, kind, open) => runRecording(`${srcLine(src, 'function listTitle(w) {')}\nthis.title = listTitle;`, { focusAgents: () => agents, focusOf: () => ({ kind }), chanOpen: () => open, focusLabel: () => 'Launch' }).title({});
  assert.equal(title(['hermes'], 'space', false), 'Launch');
  assert.equal(title(['hermes'], 'space', true), '', 'an open feed shows its name once, in the feed');
  assert.equal(title(['hermes', 'merlin'], 'space', false), '');
});

test('Channels wording: Move to channel, Remove from channel', () => {
  // the real row menu (tests/fixtures/row-sheet-harness.mjs) with the real SPACE words from chats.js
  const SPACE = vm.runInNewContext(`(() => { ${src.slice(src.indexOf('const SPACE = '), src.indexOf('}', src.indexOf('const SPACE = ')) + 1)}; return SPACE; })()`);
  assert.equal(SPACE.ch, true, 'Channels wording is on for everyone');
  const r = rowSheet({ spaces: { t1: [{ id: 'c1', name: 'Launch' }] } }); r.ctx.SPACE = SPACE;
  r.open('t1');
  const labels = r.buttons().map(b => b.label);
  assert.ok(labels.includes('Move to channel…'), labels.join(', '));
  assert.ok(labels.includes('Remove from channel · Launch'));
  r.ctx.SPACE = { ...SPACE, ch: false }; r.open('t1');
  assert.ok(r.buttons().some(b => b.label === 'Move to Space…'), 'the old Spaces words stay for Channels off');
  // the new-channel sheet's own words ('Already a channel' …) are run by 'a name another channel of this agent has…' above
});

test('long-press, right-click and Shift+F10 on a channel open the channel sheet through one rowMenu', () => {
  // the real gestures (bindGestures) and keys (bind's keydown) on a tiny Chats list with a channel row
  const doc = createDocument(), root = doc.createElement('div'); doc.body.appendChild(root);
  root.innerHTML = '<div data-chats="w1"><div class="ch-list"><div class="ch-row-wrap"><div class="ch-chan" data-chchan="launch" tabindex="0">Launch</div></div></div></div>';
  const chan = root.querySelector('[data-chchan]'), timers = [];
  const ctx = runRecording(`${srcLine(src, "const ROW_MENU = '")}\nlet lp = null, lpUntil = 0, rowSheet = null, swipeOpen = null;\n${fnBlock(src, '  function bindGestures(root) {')}\nthis.bindGestures = bindGestures;`,
    { document: doc, window: { WizComposerInput: { bind() {} } }, Date, Math, setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearTimeout() {}, idOf: () => 'w1', SWIPE_W: 80, ownerSwipe: () => false, Object, Number, String });
  ctx.bindGestures(root);
  const menus = () => ctx.calls.filter(c => c[0] === 'rowMenu').map(c => [c[1], c[2] === chan]);
  chan.dispatchEvent({ type: 'contextmenu', bubbles: true, target: chan, preventDefault() { this.prevented = true; } });
  assert.deepEqual(menus(), [['w1', true]], 'right-click');
  chan.dispatchEvent({ type: 'pointerdown', bubbles: true, target: chan, pointerId: 1, pointerType: 'touch', button: 0, clientX: 10, clientY: 10, isPrimary: true });
  const press = timers.find(([, ms]) => ms >= 300); assert.ok(press, 'a long-press timer'); press[0]();
  assert.equal(menus().length, 2, 'long-press'); assert.deepEqual(menus()[1], ['w1', true]);
  const keyCode = fnBlock(src, "    root.addEventListener('keydown', e => {", src.indexOf("if (e.target.matches('[data-chemosearch]')) { e.stopPropagation();") - 200);
  const k = runRecording(`${srcLine(src, "const ROW_MENU = '")}\nlet rowSheet = null;\nthis.key = ${keyCode.replace(/^\s*root\.addEventListener\('keydown', /, '')};`, { idOf: () => 'w1', globalThis: {}, document: doc });
  for (const ev of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
    const e = { ...ev, target: chan, preventDefault() { this.prevented = true; }, stopPropagation() {} }; k.key(e);
    assert.ok(e.prevented, ev.key);
  }
  assert.deepEqual(k.calls.filter(c => c[0] === 'rowMenu').map(c => c[2] === chan), [true, true], 'ContextMenu and Shift+F10');
  // right after a long-press, the lift's click never also opens the channel
  const click = runRecording(`this.guard = e => { ${srcLine(src, "if (justPressed() && e.target.closest('[data-chopen], [data-chnotif], [data-chchan]')) return true;").trim().replace(/\s*\/\/[^'"]*$/, '')} return 'open'; };`, { justPressed: () => true });
  assert.equal(click.guard({ target: chan }), true);
});

test('main vs routed: a restricted thread sharing a main thread\'s id never shows the other\'s first message', async () => {
  const history = { a: [{ role: 'user', text: 'Main ask' }], 'restricted|a': [{ role: 'user', text: 'Private ask' }] };
  const main = row('a', 2), priv = row('a', 2, { owner: 'restricted' });
  const spacesList = [{ id: 'launch', name: 'Launch', threads: ['a'] }, { id: 'locked', name: 'Locked', agent: 'restricted', threads: ['a'] }];
  const f = fixture({ history, spacesList, sessions: { a: main, 'restricted|a': priv } });
  f.openChannel(f.w, 'launch'); f.channelFeed(f.w, f.chanOpen(f.w), [main]); await new Promise(r => setImmediate(r));
  f.channelBack(f.w); f.openChannel(f.w, 'locked'); f.channelFeed(f.w, f.chanOpen(f.w), [priv]); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a', 'restricted|a'], 'each read names its own agent');
  const locked = f.channelFeed(f.w, f.chanOpen(f.w), [priv]);
  assert.match(locked, />Private ask</); assert.doesNotMatch(locked, /Main ask/);
  f.channelBack(f.w); f.openChannel(f.w, 'launch');
  const launch = f.channelFeed(f.w, f.chanOpen(f.w), [main]);
  assert.match(launch, />Main ask</); assert.doesNotMatch(launch, /Private ask/);
});

test('a failed first-message read is not kept: a skeleton (never the generated title) stands in, and a repaint after 30 s reads again', async () => {
  const history = { a: new Error('offline') }, s0 = row('a', 2);
  const f = fixture({ history, sessions: { a: s0 } }); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w);
  f.channelFeed(f.w, open, [s0]); await new Promise(r => setImmediate(r));
  const html = f.channelFeed(f.w, open, [s0]); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a'], 'no retry storm within 30 s');
  assert.match(html, /ch-post-wait/, 'offline: the loading line, never the chat title (issue 1266)');
  assert.doesNotMatch(html, />T a</);
  history.a = [{ role: 'user', text: 'Back online ask' }]; f.env._now = NOW + 31e3;
  f.channelFeed(f.w, open, [s0]); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a', 'a']);
  assert.match(f.channelFeed(f.w, open, [s0]), />Back online ask</);
});

test('an archived channel\'s feed takes no new posts until it is restored', () => {
  const f = fixture();
  f.openChannelSheet('w', 'voice'); f.channelClick(click({ 'data-rscharch': '' }), 'w', f.w);
  f.openChannel(f.w, 'voice');
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), []), /archived\. Restore it to post here/);
  // The real list renderer puts the channel's own box (chanComposer) in place of the New chat button under a feed.
  const withFeed = channelsList({ chanOpen: () => ({ id: 'voice' }), channelFeed: () => '<p>feed</p>', chanComposer: (_w, feed) => `<form data-box="${feed.id}"></form>` }).render('');
  assert.ok(withFeed.includes('<form data-box="voice"></form>') && !withFeed.includes('ch-fab'), 'a feed: its box, no New chat button');
  assert.match(channelsList({}).render(''), /class="ch-fab" data-chnew/, 'no feed: the New chat button');
  assert.equal(f.chanComposer(f.w, f.chanOpen(f.w)), '', 'no message box on an archived channel');
});

// ---- wizard-ux issue 1258: a message box at the bottom of a channel posts straight into it ----
const form = value => { const ta = { value }; return { ta, querySelector: () => ta }; };
const settle = () => new Promise(r => setImmediate(r));
// The real Chats click handler (core/chats-bind.js), every name it reaches but the test's a recorder.
const bindText = readFileSync(new URL('../web/core/chats-bind.js', import.meta.url), 'utf8');
const bindClick = ctx => runRecording(`${fnBlock(bindText, 'function click(e, id) {')}\nthis.click = click;`, { chatVars: {}, justPressed: () => false, topicOn: () => false, W: {}, Promise, ...ctx, H: { win: () => ({ id: 'w1' }), toast() {}, ...ctx.H } });

test('an open channel has the thread composer at the bottom: attach, mic, model label, "Message # name"; none on the list', () => {
  const f = fixture(); f.openChannel(f.w, 'launch');
  const html = f.chanComposer(f.w, f.chanOpen(f.w));
  assert.match(html, /<form [^>]*class="ch-compose ch-chan-compose"[^>]*data-chform data-chchanform>/);
  assert.match(html, /placeholder="Message # Launch"/);
  assert.match(html, /data-chattach/); assert.match(html, /data-chmic data-w="w"/);
  assert.match(html, /class="ch-mlabel ch-model" data-chmodel data-for="__new__"/, 'the model label of a new chat from this list');
  assert.match(html, /aria-label="Post in # Launch"/);
  // The draft is kept per channel, and per agent (a main and a routed Space may share a name).
  assert.equal(f.chanDraftKey(f.w), 'chan:hermes:launch');
  f.env.KIT.drafts.set('chan:hermes:launch', 'half typed', []); f.env.ch('w').draftFor = '';
  assert.match(f.chanComposer(f.w, f.chanOpen(f.w)), /has-text[^]*>half typed<\/textarea>/);
  // The Channels list itself (no feed open): no box.
  f.channelBack(f.w); assert.equal(f.chanDraftKey(f.w), '');
});

test('Send paints the post on the same frame, starts a new chat filed into the channel, and stays in the channel', async () => {
  const f = fixture(); f.openChannel(f.w, 'launch');
  f.env.ch('w').files = [{ id: 'p1', name: 'shot.png', mime: 'image/png', preview: 'blob:shot' }, { id: 'd1', name: 'notes.pdf', mime: 'application/pdf' }];
  let resolve; f.env._sendResult = new Promise(r => { resolve = r; });
  const fm = form('  Ship the boot logo  '), renders0 = f.renders.length;
  const sent = f.channelSend('w', fm);
  // Same frame: the box is empty, the list repainted, and the feed already holds the post with its photo.
  assert.equal(fm.ta.value, ''); assert.equal(f.env.ch('w').draft, ''); assert.equal(f.env.ch('w').files.length, 0);
  assert.ok(f.renders.length > renders0, 'the list repaints on the tap');
  const open = f.chanOpen(f.w); let html = f.channelFeed(f.w, open, []);
  assert.match(html, /class="ch-post sending"[^]*>Ship the boot logo<[^]*<img src="blob:shot"[^]*Sending…/);
  assert.doesNotMatch(html, /Nothing open here/);
  // Today's new-chat path: '__new__', sent from elsewhere (no navigation), the channel's Space, the box's files.
  const [wid, text, how, audio, opts] = f.env._sends[0];
  assert.equal(wid, 'w'); assert.equal(text, 'Ship the boot logo'); assert.match(how, /# Launch channel/); assert.equal(audio, null);
  assert.equal(opts.sid, '__new__'); assert.equal(opts.away, true); assert.equal(opts.space, 'launch');
  assert.deepEqual(opts.files.map(x => x.id), ['p1', 'd1']);
  assert.equal(opts.route, null, 'no pick: the owner\'s default agent and model, as a new chat does');
  // The outbox allocated the chat: the post stays until the chat's own row is in the channel, then gives way to it.
  resolve({ sessionId: 'n1' }); await sent;
  assert.equal(f.w.thread, null, 'still on the channel feed'); assert.deepEqual(JSON.parse(JSON.stringify(f.w.focus)), { kind: 'space', key: 'launch' });
  assert.match(f.channelFeed(f.w, open, []), /ch-post sending/);
  f.spacesData[0].threads.push('n1');
  // The outbox's own row for it (live.js addSynthetic) has no card time yet: it still sorts as the newest post.
  const cardAt0 = f.env.LIVE.cardAt; f.env.LIVE.cardAt = s => s.synthetic ? '' : cardAt0(s);
  f.spacesData[0].threads.push('a'); const old = row('a', 3);
  const rowN = { id: 'n1', title: 'Ship the boot logo', status: 'submitting', synthetic: true, updatedAt: new Date(NOW).toISOString() };
  assert.deepEqual([...f.channelFeed(f.w, open, [rowN, old]).matchAll(/class="ch-post-b" data-chopen="([^"]+)"/g)].map(m => m[1]), ['a', 'n1']);
  html = f.channelFeed(f.w, open, [rowN]);
  assert.doesNotMatch(html, /ch-post sending/);
  assert.match(html, /data-chopen="n1"[^]*>Ship the boot logo<[^]*<img src="blob:shot"/, 'the chat\'s post keeps the words and photo it was sent with');
  assert.equal(f.reads.length, 0, 'no history read for a post this device just sent');
});

test('a model picked in the channel box rides along', async () => {
  const f = fixture(); f.openChannel(f.w, 'launch');
  f.setChanModel('w', { model: 'opus', provider: 'anthropic' }); f.env._sendResult = Promise.resolve({ sessionId: 'n2' }); // the box's own pick (issue 1309)
  await f.channelSend('w', form('hi'));
  assert.deepEqual(JSON.parse(JSON.stringify(f.env._sends[0][4].route)), { model: 'opus', provider: 'anthropic' });
});

test('an empty box sends nothing; an archived channel has no box and sends nothing; a running take finishes instead', async () => {
  const f = fixture(); f.openChannel(f.w, 'launch');
  assert.equal(await f.channelSend('w', form('   ')), null); assert.equal(f.env._sends.length, 0);
  let finished = 0; f.env.H.voiceInto = () => '__new__'; f.env.H.finishVoice = () => finished++;
  assert.equal(await f.channelSend('w', form('with my voice')), null); assert.equal(finished, 1); assert.equal(f.env._sends.length, 0);
  delete f.env.H.voiceInto;
  f.openChannelSheet('w', 'launch'); f.channelClick(click({ 'data-rscharch': '' }), 'w', f.w); f.openChannel(f.w, 'launch');
  assert.equal(await f.channelSend('w', form('late')), null); assert.equal(f.env._sends.length, 0);
});

test('a send that could not be saved takes the post back and returns the words to the channel box', async () => {
  const f = fixture(); f.openChannel(f.w, 'launch'); f.env._sendResult = Promise.resolve(null);
  await f.channelSend('w', form('keep me'));
  assert.equal(f.CHAN_SENDING.length, 0);
  assert.equal(f.env.KIT.drafts.get('chan:hermes:launch').text, 'keep me');
  assert.doesNotMatch(f.channelFeed(f.w, f.chanOpen(f.w), []), /ch-post sending/);
});

// Issue 1293: Dismiss on a Not sent channel post takes its "Sending…" post out of the feed at once, not after the
// two-minute cap; only that chat's post, of its own agent.
test('Dismiss on a Not sent channel post removes its Sending… post from the feed at once', async () => {
  const f = fixture(); f.openChannel(f.w, 'launch'); f.env._sendResult = Promise.resolve({ sessionId: 'n7' });
  await f.channelSend('w', form('will fail'));
  f.env._sendResult = Promise.resolve({ sessionId: 'n8' }); await f.channelSend('w', form('still going'));
  const open = f.chanOpen(f.w);
  assert.equal([...f.channelFeed(f.w, open, []).matchAll(/ch-post sending/g)].length, 2);
  assert.equal(f.chanDropSending({ id: 'ob7', kind: 'new', sessionId: 'n7', agent: 'host' }), 0, 'another agent\'s chat id leaves it');
  assert.equal(f.chanDropSending({ id: 'ob7', kind: 'new', sessionId: 'n7' }), 1);
  const html = f.channelFeed(f.w, open, []);
  assert.doesNotMatch(html, />will fail</); assert.match(html, /ch-post sending[^]*>still going</);
  // The real Dismiss handler (core/chats-bind.js click) drops it after a saved dismissal, then repaints the feed.
  const dismiss = async (gone, ok = true) => {
    const dropped = [], c = bindClick({ OUTBOX: { get: () => gone, dismissFailed: () => Promise.resolve(ok) }, chanDropSending: g => (dropped.push(g.id), 1) });
    assert.equal(c.click(tap({ '[data-obdismissfailed]': { disabled: false, dataset: { obdismissfailed: 'ob7' } } }), 'w1'), true);
    await settle(); return [dropped, c.calls.filter(x => x[0] === 'chanRepaint').length];
  };
  assert.deepEqual(await dismiss({ id: 'ob7', kind: 'new' }), [['ob7'], 1], 'a dismissed new chat: dropped, feed repainted');
  assert.deepEqual(await dismiss({ id: 'ob7', kind: 'new' }, false), [[], 0], 'a refused dismissal keeps the post');
  assert.deepEqual(await dismiss({ id: 'ob8', kind: 'reply' }), [[], 0], 'a reply has no channel post');
});

test('issue 1293 main vs routed: Dismiss drops a host-profile, container or restricted channel\'s own Sending… post only', async () => {
  for (const [cid, agent] of [['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']]) {
    const f = fixture(); f.openChannel(f.w, cid); f.env._sendResult = Promise.resolve({ sessionId: 'n7' });
    await f.channelSend('w', form(`${agent} post`));
    assert.equal(f.env._sends[0][4].sid, '__new__');
    const open = f.chanOpen(f.w), sending = () => [...f.channelFeed(f.w, open, []).matchAll(/ch-post sending/g)].length;
    assert.equal(sending(), 1, `${agent}: the post shows Sending…`);
    assert.equal(f.chanDropSending({ id: 'ob7', kind: 'new', sessionId: 'n7' }), 0, `${agent}: a main chat sharing the id leaves it`);
    assert.equal(f.chanDropSending({ id: 'ob7', kind: 'new', sessionId: 'n7', agent: agent === 'host' ? 'container' : 'host' }), 0, `${agent}: another routed agent's chat leaves it`);
    assert.equal(f.chanDropSending({ id: 'ob7', kind: 'new', sessionId: 'n7', agent }), 1, `${agent}: its own dismissed chat takes it`);
    assert.equal(sending(), 0, `${agent}: gone from the feed at once`);
  }
});

// Issue 1294: Edit on a channel post that was saved but then not sent refills the channel's own box (the real
// WosSettings.moveDraft from core/settings.js), never a separate New chat; other unsent items keep the shell's Edit.
const settingsSrc = readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
const moveDraftSrc = (() => { const i = settingsSrc.indexOf('  function moveDraft('); return settingsSrc.slice(i, settingsSrc.indexOf('\n  }\n', i) + 4); })();
function editFixture() {
  const f = fixture(); const removed = [];
  f.env.OUTBOX = { remove: id => { removed.push(id); return true; }, quarantined: () => false };
  f.env.window.WosChat = { drafts: f.env.KIT.drafts };
  f.env.window.WosSettings = { moveDraft: vm.runInContext(`(${moveDraftSrc.trim().replace(/^function moveDraft/, 'function')})`, f.env) };
  return { f, removed };
}
const failedPost = (how, extra = {}) => ({ id: 'ob1', kind: 'new', sessionId: 'n9', state: 'failed', how, text: 'Ship the boot logo', files: [{ id: 'p1', name: 'shot.png', mime: 'image/png' }], ...extra });

test('Edit on a Not sent channel post puts the words and files back in that channel\'s box', () => {
  const { f, removed } = editFixture(); f.openChannel(f.w, 'launch');
  assert.equal(f.chanEditUnsent('w', failedPost('typing in the # Launch channel in Chats')), true);
  assert.deepEqual(removed, ['ob1'], 'the unsent item becomes the draft');
  const d = f.env.KIT.drafts.get('chan:hermes:launch');
  assert.equal(d.text, 'Ship the boot logo'); assert.deepEqual(d.files.map(x => x.id), ['p1']);
  assert.match(f.chanComposer(f.w, f.chanOpen(f.w)), /has-text[^]*>Ship the boot logo<\/textarea>/);
  assert.equal(f.w.thread, null, 'still on the channel feed'); assert.equal(f.drafts.length, 0, 'no New chat opened');
  // Renamed since it was sent: still this channel's post, by its filing.
  const g = editFixture(); g.f.spacesData[0].threads.push('n9'); g.f.openChannel(g.f.w, 'launch');
  assert.equal(g.f.chanEditUnsent('w', failedPost('typing in the # Old name channel in Chats')), true);
  assert.equal(g.f.env.KIT.drafts.get('chan:hermes:launch').text, 'Ship the boot logo');
});

test('Edit keeps words already in the channel box, and leaves replies and other chats to the shell', () => {
  const { f, removed } = editFixture(); f.openChannel(f.w, 'launch');
  f.env.KIT.drafts.set('chan:hermes:launch', 'half typed', []);
  assert.equal(f.chanEditUnsent('w', failedPost('typing in the # Launch channel in Chats')), true);
  assert.deepEqual(removed, [], 'original kept'); assert.equal(f.env.KIT.drafts.get('chan:hermes:launch').text, 'half typed');
  assert.match(f.toasts.at(-1), /Existing draft kept/);
  const { f: g } = editFixture(); g.openChannel(g.w, 'launch');
  assert.equal(g.chanEditUnsent('w', failedPost('typing in Chats')), false, 'a plain new chat');
  assert.equal(g.chanEditUnsent('w', failedPost('typing in the # Voice channel in Chats')), false, 'another channel');
  assert.equal(g.chanEditUnsent('w', failedPost('typing in the # Launch channel in Chats', { kind: 'reply' })), false, 'a reply');
  g.channelBack(g.w); assert.equal(g.chanEditUnsent('w', failedPost('typing in the # Launch channel in Chats')), false, 'no feed open');
  // Main vs routed: a host-profile, container or restricted channel takes back only its own agent's post.
  for (const [cid, agent] of [['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']]) {
    const { f: r } = editFixture(); r.openChannel(r.w, cid); const name = r.chanOpen(r.w).name;
    assert.equal(r.chanEditUnsent('w', failedPost(`typing in the # ${name} channel in Chats`)), false, `a main post never lands in ${agent}'s channel`);
    assert.equal(r.chanEditUnsent('w', failedPost(`typing in the # ${name} channel in Chats`, { agent })), true);
    assert.equal(r.env.KIT.drafts.get(`chan:${agent}:${cid}`).text, 'Ship the boot logo');
  }
  const { f: m } = editFixture(); m.openChannel(m.w, 'launch');
  assert.equal(m.chanEditUnsent('w', failedPost('typing in the # Launch channel in Chats', { agent: 'host' })), false, 'a routed post never lands in a main channel');
  // The real Edit tap (core/chats-bind.js click): the channel takes its own post back, else the shell's Edit.
  const edit = took => {
    const seen = [], shell = [], c = bindClick({ OUTBOX: { get: id => ({ id }) }, chanEditUnsent: (wid, it) => (seen.push([wid, it.id]), took), H: { editUnsent: it => shell.push(it.id) } });
    assert.equal(c.click(tap({ '[data-obedit]': { dataset: { obedit: 'ob1' } } }), 'w1'), true);
    return [seen, shell];
  };
  assert.deepEqual(plain(edit(true)), [[['w1', 'ob1']], []], 'the channel box took it: no shell Edit');
  assert.deepEqual(plain(edit(false)), [[['w1', 'ob1']], ['ob1']], 'not a channel post: the shell\'s Edit');
});

test('General posts unfiled (no Space); routed host-profile, container and restricted channels keep their own agent', async () => {
  const f = fixture(); f.env._sendResult = Promise.resolve({ sessionId: 'g1' });
  f.openChannel(f.w, '__general__'); await f.channelSend('w', form('general ask'));
  assert.equal(f.env._sends[0][4].space, '', 'General = in no Space');
  for (const [cid, agent, sid] of [['host-ops', 'host', 'x1'], ['box', 'container', 'x1'], ['locked', 'restricted', 'x1']]) {
    const g = fixture({ agents: { x1: agent } }); g.env._sendResult = Promise.resolve({ sessionId: sid });
    g.openChannel(g.w, cid); assert.equal(g.chanDraftKey(g.w), `chan:${agent}:${cid}`);
    await g.channelSend('w', form(`ask ${agent}`));
    assert.equal(g.env._sends[0][4].space, cid);
    // The post is keyed by its own agent: a main thread with the same id never shows these words.
    assert.equal(g.FIRST.get(`${agent}|${sid}`)?.text, `ask ${agent}`); assert.equal(g.FIRST.has(`|${sid}`), false);
    g.spacesData.find(s => s.id === cid).threads.push(sid);
    const open = g.chanOpen(g.w);
    assert.match(g.channelFeed(g.w, open, [row(sid, 0, { owner: agent })]), new RegExp(`>ask ${agent}<`));
    assert.doesNotMatch(g.channelFeed(g.w, open, [row(sid, 0, { owner: agent })]), /ch-post sending/);
  }
  // A main-agent post with the same id is not taken for a routed one (and vice versa).
  const m = fixture(); m.env._sendResult = Promise.resolve({ sessionId: 'x1' }); m.openChannel(m.w, 'launch');
  await m.channelSend('w', form('main ask')); assert.equal(m.FIRST.get('|x1')?.text, 'main ask'); assert.equal(m.FIRST.has('host|x1'), false);
});

test('voice: the orb and the box mic in front of a channel start a new chat there, with the box riding along', () => {
  const raw = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const plain = v => JSON.parse(JSON.stringify(v));
  const lineOf = (text, k) => text.split('\n').find(l => l.includes(k));
  // Phone orb (real viewOf): a channel feed is an auto view whose take goes to a new chat ('__new__'), never the cloud
  // router, pinned to the channel's Space, its box riding along.
  const viewOfFn = fnBlock(raw('web/app-viewvoice.js'), '  function viewOf(id) {');
  const orb = (w, { agent = '', chan = { id: 'launch', name: 'Launch' } } = {}) => runRecording(viewOfFn + '\nglobalThis.viewOf = viewOf;', {
    appVars: { W: { w1: { id: 'w1', app: 'chats', thread: null, ...w } } }, window: { WizCore: { channelFace: (n, g) => ({ title: g ? 'General' : '🚀 ' + n }) } },
    CHATS: { chanOpen: () => chan, chanBox: id => 'chan:' + id, winAgent: () => agent }, agentWin: () => false,
    agentApp: x => ({ agent: x.agent, name: 'Scout', private: false }), winTitle: () => 'T' }).viewOf('w1');
  assert.deepEqual(plain(orb({})), { id: 'w1', mode: 'auto', kind: 'chat thread', thread: '__new__', channel: 'Launch', space: 'launch', box: 'chan:w1', chanAgent: '', name: '🚀 Launch channel' });
  assert.equal(orb({}, { chan: { id: 'general', name: 'General', general: true } }).space, '', 'General files into no Space');
  // A routed agent's channel (host-profile, container, restricted) keeps its agent's own voice path, pinned the same way.
  const routed = plain(orb({}, { agent: 'scout' }));
  assert.equal(routed.agent, 'scout'); assert.equal(routed.name, 'Scout chats');
  assert.equal(routed.thread, '__new__'); assert.equal(routed.space, 'launch'); assert.equal(routed.box, 'chan:w1'); assert.equal(routed.chanAgent, 'scout');
  assert.equal(orb({ thread: 'sid9' }, { chan: null }).space, undefined, 'a thread in front: no channel pin');
  // The take's composer (words, photos) is this channel's box, not the New chat draft (real chanBoxOf).
  const box = runRecording(lineOf(raw('web/core/chats-send.js'), 'const chanBoxOf =').trim().replace('const chanBoxOf', 'globalThis.chanBoxOf'),
    { W: { a: { thread: null }, b: { thread: 'x' } }, chanDraftKey: w => w === undefined ? '' : 'chan-box' }).chanBoxOf;
  assert.equal(box('a', '__new__'), 'chan-box'); assert.equal(box('a', 'sid'), ''); assert.equal(box('b', '__new__'), ''); assert.equal(box('zz', '__new__'), '');
  // (takeComposer keying the take by that box runs in chat-channel-box-voice.test.mjs: 'a channel take seals the box...')
  // ...the box of the channel the take STARTED in (Codex P1): phone sealTarget carries it.
  const seal = V => runRecording(fnBlock(raw('web/app-sendgo.js'), '  function sealTarget() {') + '\nglobalThis.seal = sealTarget;', { V, appVars: { W: { w1: {} } } }).seal();
  assert.deepEqual(plain(seal({ replyTo: { wid: 'w1', sid: '__new__', box: 'chan-box' } })), { wid: 'w1', sid: '__new__', box: 'chan-box' });
  assert.deepEqual(plain(seal({ kind: 'tap', target: null, snap: { view: { kind: 'chat thread', id: 'w1', thread: '__new__', box: 'chan-box' } } })), { wid: 'w1', sid: '__new__', box: 'chan-box' });
  // The phone's Send seals that box (the real statement in app.js finishVoice).
  const sealLine = stmt(app, 'if (sealAt && !V.seal)'), took = [];
  const sealed = runRecording(sealLine, { sealAt: { wid: 'w1', sid: '__new__', box: 'chan-box' }, V: {}, CHATS: { takeComposer: (...a) => (took.push(a), { text: 'hi', files: [] }) } });
  assert.deepEqual(plain(took), [['w1', '__new__', 'chan-box']]); assert.equal(sealed.V.seal.text, 'hi');
  // (sendTapRoute keeping the channel's agent runs in chat-channel-box-voice.test.mjs: 'phone and desktop: a channel take...')
  // The box mic records a new chat from this channel (real boxThread); the model label opens the new-chat model menu.
  const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
  const boxThread = runRecording(lineOf(power, 'const boxThread =').trim().replace('const boxThread', 'globalThis.boxThread'), { A: { chanOpen: w => w.feed ? {} : null } }).boxThread;
  assert.equal(boxThread({ thread: 'sid1' }), 'sid1'); assert.equal(boxThread({ thread: null, feed: true }), '__new__'); assert.equal(boxThread({ thread: null }), ''); assert.equal(boxThread(null), '');
  // (the box mic and model label taps through the real chat-power.js click run in chat-channel-box-voice.test.mjs)
  // An orb take is pinned to the channel it started in (Codex P1): phone viewOf carries its Space to every send path
  // (real pinSpace), the desktop orb keeps it from the start of the take.
  const pinSpace = runRecording(lineOf(raw('web/app-routing.js'), 'const pinSpace =').trim().replace('const pinSpace', 'globalThis.pinSpace'), {}).pinSpace;
  assert.deepEqual(plain(pinSpace({ space: 'launch', thread: '__new__' })), { space: 'launch' });
  assert.deepEqual(plain(pinSpace({ space: '', thread: '__new__' })), { space: '' });
  assert.deepEqual(plain(pinSpace({ space: 'launch', thread: 'sid1' })), {}); assert.deepEqual(plain(pinSpace(null)), {});
  assert.equal((app.match(/\.\.\.pinSpace\(s?v\)/g) || []).length, 4, 'the agent path, deliverToView, the take with files, and an interrupted take');
  const desk = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  const vLine = lineOf(desk, 'vSpace = !forceNew && vTarget ?').trim();
  const deskTake = (forceNew, vTarget, spaceOf) => runRecording('var vSpace, vBox;\n' + vLine + '\nglobalThis.out = { vSpace, vBox };', { forceNew, vTarget, W: { w1: {} }, CHATS: { chanSpaceOf: spaceOf, chanBox: id => 'box:' + id } }).out;
  assert.deepEqual(plain(deskTake(false, 'w1', () => 'launch')), { vSpace: 'launch', vBox: 'box:w1' });
  assert.deepEqual(plain(deskTake(false, 'w1', () => null)), { vSpace: null });
  assert.deepEqual(plain(deskTake(true, 'w1', () => 'launch')), { vSpace: null }, 'a forced new chat is not a channel take');
  // The desktop's aimed send carries that Space on a new chat only (the real statement in desktop.js).
  const aimed = stmt(desk, 'if (w && aimSid) CHATS.sendChat(');
  const deskSend = (aimSid, rp, vSpace) => { const out = []; runRecording(aimed, { w: { id: 'w1' }, aimSid, rp, vSpace, r: {}, CHATS: { sendChat: (...a) => out.push(a) } }); return out[0]?.[4].space; };
  assert.equal(deskSend('__new__', null, 'launch'), 'launch'); assert.equal(deskSend('__new__', null, ''), '', 'General');
  assert.equal(deskSend('sid1', null, 'launch'), undefined, 'a reply to a thread'); assert.equal(deskSend('__new__', { id: 'q' }, 'launch'), undefined, 'a quoted reply');
  assert.equal(deskSend('__new__', null, null), undefined, 'no channel take');
  // Those takes are filed into the channel the way every new chat from a Space in front is (real outbox onNew).
  const focusText = raw('web/core/chats-focus.js');
  const onNew = focusText.slice(focusText.indexOf('  OUTBOX?.onNew?.((it, o) => {'), focusText.indexOf('\n  });', focusText.indexOf('  OUTBOX?.onNew?.((it, o) => {')) + 6);
  const hook = {};
  const filed = runRecording(onNew, { OUTBOX: { onNew: f => { hook.cb = f; } }, spaceInFront: agent => agent === 'scout' ? 'launch' : '', chanOwnPost: undefined });
  filed.calls.length = 0; hook.cb({ agent: 'scout', sessionId: 's1' }, {});
  assert.deepEqual(plain(filed.calls.filter(c => c[0] === 'spaceMember')), [['spaceMember', 'launch', 's1', true, 'scout']]); // issue 1261: with its agent
  filed.calls.length = 0; hook.cb({ agent: 'scout', sessionId: 's2' }, { space: false });
  assert.deepEqual(filed.calls.filter(c => c[0] === 'spaceMember'), [], 'an explicit no-Space send is not filed');
});

test('a channel feed names the Space its new chats go to (General = none); no feed, no Space', () => {
  const f = fixture();
  assert.equal(f.chanSpaceOf(f.w), null);
  f.openChannel(f.w, 'launch'); assert.equal(f.chanSpaceOf(f.w), 'launch');
  f.openChannel(f.w, '__general__'); assert.equal(f.chanSpaceOf(f.w), '');
  f.w.thread = 'a'; assert.equal(f.chanSpaceOf(f.w), null, 'a thread open in the window: not the feed');
});

test('a private agent\'s model is never sent from a main channel box (its chat could not be filed there); the channel\'s own agent\'s is', async () => {
  const f = fixture(); f.openChannel(f.w, 'launch'); f.env._sendResult = Promise.resolve({ sessionId: 'p1' });
  f.setChanModel('w', { model: 'tinfoil', provider: 'tinfoil', agent: 'restricted' });
  await f.channelSend('w', form('private?'));
  assert.equal(f.env._sends[0][4].route, null, 'default route instead of another agent');
  const g = fixture(); g.openChannel(g.w, 'host-ops'); g.env._sendResult = Promise.resolve({ sessionId: 'p2' });
  g.setChanModel('w', { model: 'h-model', provider: 'h', agent: 'host' });
  await g.channelSend('w', form('host ask'));
  assert.equal(g.env._sends[0][4].route?.model, 'h-model');
});

test('a model picked for another agent never rides into a channel (box, mic or orb all read it); the New chat pick is left alone', () => {
  const f = fixture(); f.openChannel(f.w, 'launch');
  f.setChanModel('w', { model: 'tinfoil', provider: 'tinfoil', agent: 'restricted' }); assert.equal(f.chanModel(f.w), null);
  f.env.ch('w').newModel = { model: 'tinfoil', provider: 'tinfoil', agent: 'restricted' };
  f.chanComposer(f.w, f.chanOpen(f.w)); assert.equal(f.env.ch('w').newModel?.model, 'tinfoil', 'a box paint never clears the window\'s New chat pick (issue 1309)');
  f.setChanModel('w', { model: 'opus', provider: 'anthropic' }); assert.equal(f.chanModel(f.w)?.model, 'opus', 'a main pick stays in a main channel');
  const g = fixture(); g.openChannel(g.w, 'box');
  g.setChanModel('w', { model: 'h', provider: 'h', agent: 'host' }); assert.equal(g.chanModel(g.w), null, 'a host pick never rides into the container channel');
  g.setChanModel('w', { model: 'c', provider: 'c', agent: 'container' }); assert.equal(g.chanModel(g.w)?.model, 'c');
});

test('a photo still uploading stays with the channel it was attached in when another channel opens', () => {
  const f = fixture(); f.openChannel(f.w, 'launch');
  f.chanComposer(f.w, f.chanOpen(f.w));
  const local = { key: 'k1', name: 'shot.png', mime: 'image/png', uploading: true, preview: 'blob:shot' };
  f.env.ch('w').files = [local];
  f.openChannel(f.w, 'voice'); f.chanComposer(f.w, f.chanOpen(f.w));
  assert.equal(f.env.ch('w').files.length, 0, '# Voice has its own (empty) tray');
  Object.assign(local, { id: 'up1', bytes: 9, uploading: false }); // the upload finishes while # Voice is open
  f.openChannel(f.w, 'launch'); const html = f.chanComposer(f.w, f.chanOpen(f.w));
  assert.equal(f.env.ch('w').files[0], local, 'the same live attachment is back in # Launch');
  assert.match(html, /data-f="up1"/); assert.equal(f.env.KIT.drafts.get('chan:hermes:launch').files[0]?.id, 'up1', 'and saved with that channel');
});

// Unread (wizard-ux issue 1259): the per-chat read state Activity keeps (LIVE.isNew), drawn on lines and posts.
test('issue 1316: a post changed since the watermark makes its channel bold with a green dot (no number pill) after the amber one, in the right-hand slot', () => {
  const rows = [row('a', 1, { messageCount: 4 }), row('b', 2, { attention: { state: 'needs_you' } }), row('c', 3, { fresh: true }), row('d', 3, { fresh: true }), row('g', 1)];
  const f = fixture({ marksAt: readTo(2.5) });
  const chans = f.channelsBody(f.w, rows).split(/<div class="ch-chan(?=[ "])/).slice(1);
  const by = Object.fromEntries(chans.map(c => [c.match(/data-chchan="([^"]+)"/)[1], c]));
  assert.match(by.launch, /^ unread"/, 'Launch is bold');
  assert.match(by.launch, /<span class="ch-chan-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you"><\/i><i class="ch-chan-dot new" role="img" aria-label="2 unread"><\/i><\/span>/, 'count of posts, not messages, in the green dot\'s label; amber first');
  assert.doesNotMatch(by.launch, /ch-chan-n|<small/, 'no bare number pill');
  assert.doesNotMatch(by.voice, /unread|ch-chan-ind/, 'read up to the watermark: an unopened reply (d) does not make it bold');
  assert.match(by.__general__, /^ unread"[^]*aria-label="1 unread"><\/i>/);
});

test('working, archived and snoozed-last rows are not unread posts (Activity rule)', () => {
  const rows = [row('a', 1, { fresh: true, status: 'running' }), row('b', 1, { fresh: true, archived: true }), row('c', 1, { fresh: true, deferred: true })];
  const f = fixture({ marksAt: readTo(2) });
  let launch = f.channelsBody(f.w, rows).split(/<div class="ch-chan(?=[ "])/).slice(1).find(c => c.includes('data-chchan="launch"'));
  assert.match(launch, /aria-label="1 unread"><\/i>/, 'snooze-last off: the snoozed post still counts');
  f.env._snoozeLast = true;
  launch = f.channelsBody(f.w, rows).split(/<div class="ch-chan(?=[ "])/).slice(1).find(c => c.includes('data-chchan="launch"'));
  assert.doesNotMatch(launch, /ch-chan-dot new|^ unread/);
});

test('the expanded chevron lines are bold for unread posts', () => {
  const rows = [row('a', 1, { fresh: true }), row('b', 2)];
  const f = fixture();
  f.channelClick(click({ 'data-chchanx': 'launch' }), 'w', f.w);
  const html = f.channelsBody(f.w, rows);
  assert.match(html, /class="ch-chan-post unread" data-chopen="a"/);
  assert.match(html, /class="ch-chan-post" data-chopen="b"/);
});

test('in the feed an unread post says "● N new replies" at the right, in the needs-you slot; read posts are unchanged', async () => {
  const rows = [row('a', 3, { fresh: true, messageCount: 4, readAt: 150 }), row('b', 2, { messageCount: 2 }), row('c', 1, { fresh: true, messageCount: 1 })];
  const a = [{ role: 'user', text: 'q' }, { role: 'assistant', text: '1', at: 100 }, { role: 'assistant', text: '2', at: 200 }, { role: 'assistant', text: '3', at: 300 }, { role: 'assistant', text: '4', at: 400 }];
  const f = fixture({ history: { a, b: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'ok' }], c: [{ role: 'user', text: 'q' }] } });
  f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), rows); await new Promise(r => setImmediate(r));
  const html = f.channelFeed(f.w, f.chanOpen(f.w), rows);
  const post = id => html.split(/<div class="ch-post(?=[ "])/).find(p => p.includes(`data-morph-key="post:${id}"`));
  assert.match(post('a'), /^ unread"/);
  assert.match(post('a'), /class="ch-post-r unread" data-chopen="a"><span class="ch-post-av"[^]*<span>4 replies<\/span><time>[^<]*<\/time><span class="ch-post-sts"><span class="ch-post-st new"><i class="ch-chan-dot new" aria-hidden="true"><\/i>3 new replies<\/span><\/span><\/button>/, 'issue 1269: green dot with words on the right, nothing on the left');
  assert.doesNotMatch(html, /class="st unread"/, 'no left-side dot');
  assert.match(post('b'), /class="ch-post-r" data-chopen="b"><span class="ch-post-av"[^]*<span>1 reply<\/span>/);
  assert.doesNotMatch(post('b'), /ch-post-st new|new repl/);
  assert.match(post('c'), /<span class="ch-post-st new"><i class="ch-chan-dot new" aria-hidden="true"><\/i>New reply<\/span>/, 'no count yet: still marked');
  // A post that needs you and has a new reply shows both, amber first, in the same slot.
  const both = row('a', 1, { fresh: true, status: 'waiting_for_approval' });
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [both]), /Needs you<\/span><span class="ch-post-st new">/);
});

test('issue 1289: posts stay in posting order; a reply to an older post updates its reply line where it sits (main and routed)', async () => {
  for (const [kind, agent] of [['main', ''], ['host-profile', 'host'], ['container', 'container'], ['restricted', 'restricted']]) {
    const spacesList = [{ id: 'ch', name: 'Ch', ...(agent ? { agent } : {}), threads: ['a', 'b', 'c'] }];
    const k = id => (agent ? agent + '|' : '') + id, own = agent ? { owner: agent } : {};
    // Three posts started 30, 20 and 10 hours ago; each had one reply soon after.
    const started = { a: 30, b: 20, c: 10 }, hist = {};
    for (const [id, h] of Object.entries(started)) hist[k(id)] = [{ role: 'user', text: 'post ' + id, at: NOW - h * H }, { role: 'assistant', text: 'ok', at: NOW - (h - 1) * H }];
    const mk = (id, at, extra = {}) => row(id, at, { ...own, startedAt: new Date(NOW - started[id] * H).toISOString(), messageCount: 2, lastAssistantAt: new Date(NOW - (started[id] - 1) * H).toISOString(), ...extra });
    const f = fixture({ spacesList, history: hist });
    f.openChannel(f.w, 'ch'); const open = f.chanOpen(f.w);
    const order = html => [...html.matchAll(/data-morph-key="post:([^"]+)"/g)].map(m => m[1]);
    const post = (html, id) => html.split(/<div class="ch-post(?=[ "])/).find(p => p.includes(`data-morph-key="post:${id}"`));
    let rows = [mk('c', 9), mk('a', 29), mk('b', 19)];
    f.channelFeed(f.w, open, rows); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
    let html = f.channelFeed(f.w, open, rows);
    assert.deepEqual(order(html), ['a', 'b', 'c'], kind + ': oldest post first');
    assert.match(post(html, 'a'), /<b>[^<]*<\/b><time>30h<\/time>[^]*<span>1 reply<\/span><time>29h<\/time>/, kind);
    // A new reply lands on the oldest post: its card time is now the newest of all three.
    hist[k('a')] = [...hist[k('a')], { role: 'user', text: 'and?' }, { role: 'assistant', text: 'done', at: NOW }];
    rows = [mk('c', 9), mk('a', 0, { messageCount: 4, lastAssistantAt: new Date(NOW).toISOString(), fresh: true }), mk('b', 19)];
    f.channelFeed(f.w, open, rows); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
    html = f.channelFeed(f.w, open, rows);
    assert.deepEqual(order(html), ['a', 'b', 'c'], kind + ': the reply never moves its post');
    assert.match(post(html, 'a'), /<b>[^<]*<\/b><time>30h<\/time>/, kind + ': the header keeps the post\'s own time');
    assert.match(post(html, 'a'), /<span>2 replies<\/span><time>0h<\/time>/, kind + ': the reply line has the new count and time');
  }
});

test('issue 1316: opening a post (markSeen) clears its own words only; the channel line clears once the feed is read to its end', () => {
  const a = row('a', 1, { fresh: true, messageCount: 2 }), rows = [a];
  const f = fixture({ marksAt: readTo(2) });
  assert.match(f.channelsBody(f.w, rows), /ch-chan-dot new/);
  a.fresh = false;                                    // what LIVE.markSeen does to isNew when the thread opens
  assert.match(f.channelsBody(f.w, rows), /ch-chan-dot new/, 'the channel keeps its watermark state');
  f.openChannel(f.w, 'launch');
  const html = f.channelFeed(f.w, f.chanOpen(f.w), rows);
  assert.doesNotMatch(html, /ch-post unread|new repl/, 'the post\'s own words are gone');
  const d = feedDom(html); f.env.elOf = () => d.el; f.chanHold('w');   // one post: the whole feed is in view
  f.channelBack(f.w);
  assert.doesNotMatch(f.channelsBody(f.w, rows), /ch-chan-dot new| unread"/, 'read to the end: the line is read');
});

test('unread marks follow each row\'s own agent: main and routed (host-profile, container, restricted) alike', () => {
  const rows = [row('h1', 1, { fresh: true, owner: 'host' }), row('k1', 1, { fresh: true, owner: 'container' }), row('r1', 3, { owner: 'restricted' }), row('a', 1, { fresh: true })];
  const f = fixture({ agents: { h1: 'host', k1: 'container', r1: 'restricted' }, marksAt: readTo(2) });
  const chans = Object.fromEntries(f.channelsBody(f.w, rows).split(/<div class="ch-chan(?=[ "])/).slice(1).map(c => [c.match(/data-chchan="([^"]+)"/)[1], c]));
  for (const k of ['host-ops', 'box', 'launch']) assert.match(chans[k], /^ unread"[^]*aria-label="1 unread"/, k);
  assert.doesNotMatch(chans.locked, /ch-chan-dot new/, 'read restricted chat');
  // A main chat that shares the routed id is not counted in the routed channel.
  const twin = [row('h1', 1, { fresh: true, owner: 'hermes' })];
  const ho = f.channelsBody(f.w, twin).split(/<div class="ch-chan(?=[ "])/).slice(1).find(c => c.includes('data-chchan="host-ops"'));
  assert.doesNotMatch(ho, /ch-chan-dot new/);
});

test('opening a post repaints every open feed at once (the desktop list pane beside the thread)', () => {
  const f = fixture();
  f.env.CH.w = {}; f.env.elOf = () => ({});
  // Issue 1336: Activity repaints too (an opened green thread leaves Ready at once); the Channels list does not.
  f.chanSeenPaint(); assert.deepEqual(f.renders, ['list'], 'Activity: painted');
  f.channelClick(click({ 'data-chview': 'channels' }), 'w', f.w); f.renders.length = 0;
  f.chanSeenPaint(); assert.deepEqual(f.renders, [], 'the Channels list with no feed open: no paint');
  f.openChannel(f.w, 'launch'); f.renders.length = 0;
  f.chanSeenPaint(); assert.deepEqual(f.renders, ['list']);
  f.env.holdList = () => true; f.renders.length = 0;
  f.chanSeenPaint(); assert.deepEqual(f.renders, [], 'a held list keeps the hold (it repaints when let go)');
  // openChat (the real statement in chats.js) marks the window's own row, then paints.
  const seenLine = stmt(src, "LIVE.markSeen(typeof chanSeenRow === 'function'"), order = [];
  const openSeen = sid => { order.length = 0; runRecording(seenLine, { wid: 'w', sid, LIVE: { markSeen: r => order.push(['seen', r]) }, chanSeenRow: (wid, id) => ({ wid, id }), chanSeenPaint: () => order.push(['paint']) }); return plain(order); };
  assert.deepEqual(openSeen('a'), [['seen', { wid: 'w', id: 'a' }], ['paint']], 'openChat marks the window\'s own row, then paints');
  assert.deepEqual(openSeen('__new__'), [], 'a new chat has nothing to mark');
});

test('opening a routed post that shares its id with a main thread marks the routed row, not the main one', () => {
  const main = row('h1', 1, { fresh: true, owner: 'hermes' }), routed = row('h1', 1, { fresh: true, owner: 'host', agent: 'host' });
  for (const [agent, shown] of [['host', routed], ['container', { ...routed, owner: 'container', agent: 'container' }], ['restricted', { ...routed, owner: 'restricted', agent: 'restricted' }]]) {
    const f = fixture({ sessions: { h1: main } });
    f.env._rowOf = () => shown;
    assert.equal(f.chanSeenRow('w', 'h1'), shown, agent + ': the window\'s own row');
  }
  const f = fixture({ sessions: { h1: main } });
  assert.equal(f.chanSeenRow('w', 'h1'), 'h1', 'main window: the id, as today');
});

// Where a feed opens and stays (wizard-ux issue 1263): a fake scroller laid out from the painted feed's own keys.
function feedDom(html, heights = {}, client = 400, { bar = 0, keys: forced } = {}) {
  const keys = forced || [...html.matchAll(/data-morph-key="((?:post:|chan-new)[^"]*)"/g)].map(m => m[1]);
  const sc = { scrollTop: 0, clientHeight: client, getBoundingClientRect: () => ({ top: 0 }) };
  const nodes = keys.map(k => ({ dataset: { morphKey: k }, h: heights[k] ?? (k === 'chan-new' ? 20 : 100) }));
  const topOf = n => bar + nodes.slice(0, nodes.indexOf(n)).reduce((a, x) => a + x.h, 0);
  for (const n of nodes) n.getBoundingClientRect = () => ({ top: topOf(n) - sc.scrollTop, bottom: topOf(n) + n.h - sc.scrollTop });
  Object.defineProperty(sc, 'scrollHeight', { get: () => bar + nodes.reduce((a, x) => a + x.h, 0) });
  // bar: the sticky Open · Needs you · All bar at the top of the feed (it stays at the top of the view).
  const feed = { querySelectorAll: () => nodes, firstElementChild: bar ? { dataset: {}, offsetHeight: bar, sticky: true } : null };
  sc.querySelector = q => q === '.ch-chan-feed' ? feed : null;
  return { sc, nodes, el: { querySelector: q => q === '.ch-list > .ch-scroll' ? sc : null }, grow: (k, h) => { nodes.find(n => n.dataset.morphKey === k).h = h; } };
}
const manyRows = (n, unreadFrom = n) => Array.from({ length: n }, (_, i) => row('p' + i, n - i, { fresh: i >= unreadFrom }));
const longSpaces = n => [{ id: 'launch', name: 'Launch', threads: Array.from({ length: n }, (_, i) => 'p' + i) }];

test('issue 1263: all read, a long channel opens at the very bottom and stays there while posts fill in', () => {
  const f = fixture({ spacesList: longSpaces(120) }), rows = manyRows(120);
  f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w), html = f.channelFeed(f.w, open, rows);
  assert.doesNotMatch(html, /ch-chan-new/, 'all read: no New line');
  assert.deepEqual({ ...f.w.chan.at }, { end: true });
  const d = feedDom(html); f.env.elOf = () => d.el;
  f.chanHold('w'); assert.equal(d.sc.scrollTop, d.sc.scrollHeight - d.sc.clientHeight, 'at the bottom');
  // First messages and thumbnails arrive: the feed grows above and at the end; a repaint resets to 0 first (rerenderList).
  d.grow('post:p3', 260); d.grow('post:p119', 300); d.sc.scrollTop = 0;
  f.chanHold('w'); assert.equal(d.sc.scrollTop, d.sc.scrollHeight - d.sc.clientHeight, 'still at the bottom, never the top');
});

test('issue 1263/1316: posts changed since the watermark, it opens at the first under one "New" line that holds its place as posts fill in', () => {
  const f = fixture({ spacesList: longSpaces(120), marksAt: readTo(17) }), rows = manyRows(120, 104);
  f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w), html = f.channelFeed(f.w, open, rows);
  assert.equal(html.match(/class="ch-chan-new"/g)?.length, 1, 'one New line');
  assert.match(html, /data-morph-key="chan-new"><span>New<\/span><\/div><div class="ch-post unread" data-chmark="new" data-morph-key="post:p104"/, 'directly above the first unread post');
  const d = feedDom(html); f.env.elOf = () => d.el;
  const lineY = () => d.nodes.find(n => n.dataset.morphKey === 'chan-new').getBoundingClientRect().top;
  f.chanHold('w'); assert.equal(lineY(), 8, 'the New line near the top of the view');
  d.grow('post:p10', 400); d.grow('post:p103', 180);
  f.chanHold('w'); assert.equal(lineY(), 8, 'posts above filled in: the line did not move');
  // Reading to the end does not take the line away while the channel is open; the next open does.
  f.chanUser('w'); d.sc.scrollTop = d.sc.scrollHeight - d.sc.clientHeight; f.chanScrolled('w', d.sc);
  assert.match(f.channelFeed(f.w, open, rows), /ch-chan-new/, 'still there while James is looking');
  f.channelBack(f.w); f.openChannel(f.w, 'launch');
  assert.doesNotMatch(f.channelFeed(f.w, f.chanOpen(f.w), rows), /ch-chan-new/, 'cleared on the next open');
  assert.deepEqual({ ...f.w.chan.at }, { end: true }, 'and it opens at the bottom');
});

test('issue 1263: James\'s own scroll moves the place (a repaint or Back from a thread returns to it); programmatic scrolls do not', () => {
  const f = fixture({ spacesList: longSpaces(40) }), rows = manyRows(40);
  f.openChannel(f.w, 'launch');
  const html = f.channelFeed(f.w, f.chanOpen(f.w), rows), d = feedDom(html); f.env.elOf = () => d.el;
  f.chanHold('w');
  d.sc.scrollTop = 1050; f.chanScrolled('w', d.sc);
  assert.deepEqual({ ...f.w.chan.at }, { end: true }, 'a scroll James did not make never moves the place');
  f.chanUser('w'); f.chanScrolled('w', d.sc);
  assert.deepEqual({ ...f.w.chan.at }, { key: 'post:p10', y: -50 }, 'the post at the top of his view');
  d.sc.scrollTop = 0; d.grow('post:p2', 300); // Back repaints the list from the top, and a post above grew meanwhile
  f.chanHold('w'); assert.equal(d.nodes.find(n => n.dataset.morphKey === 'post:p10').getBoundingClientRect().top, -50, 'back where he was');
  f.chanUser('w'); d.sc.scrollTop = d.sc.scrollHeight - d.sc.clientHeight - 2; f.chanScrolled('w', d.sc);
  assert.deepEqual({ ...f.w.chan.at }, { end: true }, 'scrolled to the end: the end is the place again');
  f.chanToEnd('w'); assert.deepEqual({ ...f.w.chan.at }, { end: true }, 'a send keeps the newest post in view');
});

test('issue 1263: the first unread follows each row\'s own agent (main vs routed host-profile, container, restricted)', () => {
  for (const agent of ['host', 'container', 'restricted']) {
    const sp = { host: 'host-ops', container: 'box', restricted: 'locked' }[agent], tid = { host: 'h1', container: 'k1', restricted: 'r1' }[agent];
    const f = fixture({ agents: { [tid]: agent }, marksAt: readTo(3) });
    f.w.focus = { kind: 'agent', key: agent }; f.openChannel(f.w, sp);
    const html = f.channelFeed(f.w, f.chanOpen(f.w), [row(tid, 2, { owner: 'hermes', fresh: true }), row(tid, 1, { owner: agent, agent, fresh: true })]);
    assert.equal(f.w.chan.newKey, agent + '|' + tid, agent + ': the routed row, never the main one sharing its id');
    assert.match(html, /ch-chan-new/);
  }
});

test('issue 1263: every list paint and every rerender put the feed back in its place', () => {
  // rerenderList: the list repaints from the top, then the open feed takes its place back
  const doc = createDocument(), el = doc.createElement('div'); el.innerHTML = '<div class="ch-scroll"></div>';
  const sc = el.querySelector('.ch-scroll'); sc.scrollTop = 120;
  const r = runRecording(`${fnBlock(src, '  function rerenderList(w) {')}\nthis.rerender = rerenderList;`, { elOf: () => el, ch: () => ({}) });
  r.rerender({ id: 'w1', thread: null });
  assert.equal(sc.scrollTop, 0); assert.deepEqual(r.calls.map(c => c[0]), ['renderChatList', 'chanHold'], 'rerenderList');
  assert.equal(r.calls[1][1], 'w1');
  // renderChatList, where the Channels block is loaded (tests/fixtures/chats-list-render.mjs runs the real renderer)
  const held = [], { render } = channelsList({ chanHold: id => held.push(id) });
  render(''); assert.deepEqual(held, ['synthetic'], 'renderChatList');
  // the list's scroll listener tells the feed it moved
  const root = doc.createElement('div'); root.innerHTML = '<div class="ch-list"><div class="ch-scroll"></div></div>'; doc.body.appendChild(root);
  const g = runRecording(`${fnBlock(src, '  function bindGestures(root) {')}\nthis.bind = bindGestures;`, { document: doc, window: { WizComposerInput: { bind() {} } }, idOf: () => 'w1', readGuard: () => ({ touches: new Set() }), Date, Math, Object });
  g.bind(root);
  const list = root.querySelector('.ch-list > .ch-scroll');
  root.listeners.scroll.filter(l => String(l.f).includes('chanScrolled')).forEach(l => l.f({ target: list }));
  assert.deepEqual(g.calls.filter(c => c[0] === 'chanScrolled').map(c => [c[1], c[2] === list]), [['w1', true]], 'the list scroll listener');
});

test('issue 1263: the tap that opens an unread channel and the hold\'s own scroll never replace the New line as the place', () => {
  const f = fixture({ spacesList: longSpaces(120), marksAt: readTo(17) }), rows = manyRows(120, 104);
  f.chanUser('w'); // the row's pointerdown, before openChannel runs
  f.openChannel(f.w, 'launch');
  const d = feedDom(f.channelFeed(f.w, f.chanOpen(f.w), rows)); f.env.elOf = () => d.el;
  f.chanHold('w'); f.chanScrolled('w', d.sc);
  assert.deepEqual({ ...f.w.chan.at }, { key: 'chan-new', y: 8, bar: true }, 'the opening tap is not a scroll');
  f.chanUser('w'); f.chanScrolled('w', d.sc);
  assert.deepEqual({ ...f.w.chan.at }, { key: 'chan-new', y: 8, bar: true }, 'the scroll event the hold itself fired is not James\'s');
  f.chanUser('w'); d.sc.scrollTop -= 250; f.chanScrolled('w', d.sc);
  assert.equal(f.w.chan.at.key, 'post:p101', 'a real scroll after it does move the place');
});

test('issue 1263 review: with a sticky filter bar, a New-line place James scrolled to keeps his offset (the bar is not added twice)', () => {
  const f = fixture({ spacesList: longSpaces(120), marksAt: readTo(17) }), rows = manyRows(120, 104);
  f.env.getComputedStyle = el => ({ position: el?.sticky ? 'sticky' : 'static' });
  f.openChannel(f.w, 'launch');
  const d = feedDom(f.channelFeed(f.w, f.chanOpen(f.w), rows), {}, 400, { bar: 40 }); f.env.elOf = () => d.el;
  const y = k => d.nodes.find(n => n.dataset.morphKey === k).getBoundingClientRect().top;
  f.chanHold('w'); assert.equal(y('chan-new'), 48, 'opening: the New line just below the 40px bar');
  f.chanUser('w'); d.sc.scrollTop += 10; f.chanScrolled('w', d.sc);
  assert.deepEqual({ ...f.w.chan.at }, { key: 'chan-new', y: 38 }, 'James nudged it: the line is the place at 38px');
  d.sc.scrollTop = 0; f.chanHold('w'); assert.equal(y('chan-new'), 38, 'a repaint keeps 38px, not 78px');
  f.chanHold('w'); assert.equal(y('chan-new'), 38, 'and again');
  f.chanUser('w'); d.sc.scrollTop -= 300; f.chanScrolled('w', d.sc); const at = { ...f.w.chan.at };
  assert.equal(at.key, 'post:p101'); d.sc.scrollTop = 0; f.chanHold('w'); assert.equal(y('post:p101'), at.y, 'an ordinary post keeps its offset');
});

test('issue 1263 review: two posts drawn with the same key (main and routed), the place is the row James was at, even after a re-sort', () => {
  const f = fixture({ spacesList: longSpaces(4) });
  f.openChannel(f.w, 'launch'); f.w.chan.at = { end: true };
  const keys = ['post:a', 'post:same', 'post:b', 'post:c', 'post:d', 'post:same', 'post:e', 'post:f', 'post:g', 'post:h'];
  const d = feedDom('', {}, 300, { keys }); f.env.elOf = () => d.el;
  const twins = d.nodes.filter(n => n.dataset.morphKey === 'post:same'); twins[0].dataset.chrow = 'hermes|same'; twins[1].dataset.chrow = 'host|same';
  f.chanUser('w'); d.sc.scrollTop = 500; f.chanScrolled('w', d.sc);
  assert.deepEqual({ ...f.w.chan.at }, { key: 'post:same', y: 0, row: 'host|same' }, 'the routed copy');
  d.sc.scrollTop = 0; f.chanHold('w'); assert.equal(d.sc.scrollTop, 500, 'back at the routed copy, not the first one');
  // A newer reply re-sorts the two copies: the routed one is now drawn first, and the place follows it.
  twins[0].dataset.chrow = 'host|same'; twins[1].dataset.chrow = 'hermes|same';
  d.sc.scrollTop = 0; f.chanHold('w'); assert.equal(d.sc.scrollTop, 100, 'it follows the routed row');
  f.chanUser('w'); d.sc.scrollTop = 300; f.chanScrolled('w', d.sc);
  assert.deepEqual({ ...f.w.chan.at }, { key: 'post:c', y: 0 }, 'a key drawn once needs no row');
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [row('p0', 1)]), /data-morph-key="post:p0" data-chrow="hermes\|p0"/, 'each post carries its row');
});

// Issue 1266: reply counts are the replies James sees, seeing a post reads it, and unread is green (not violet).
const kitSrc = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
function realParseRows() {
  const store = new Map(), ctx = { location: { origin: 'https://box.example', hostname: 'box.example', href: 'https://box.example/wizard-os-home/' },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(kitSrc, ctx); return ctx.WosChat.parseRows;
}
const ts = m => new Date(NOW - 60 * H + m * 60e3).toISOString();
// One owner question and two answers he sees, with 68 tool calls, tool results and status steps in between.
function busyThread() {
  const out = [{ role: 'user', content: 'I just had a call with Jonathan. Pass the transcript to the philosopher.', timestamp: ts(0) }];
  for (let i = 0; i < 33; i++) out.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, function: { name: 'read_file' } }], timestamp: ts(1) }, { role: 'tool', tool_call_id: 'c' + i, content: 'x'.repeat(40), timestamp: ts(1) });
  out.push({ role: 'assistant', content: 'Sent it to the philosopher.', timestamp: ts(2) });
  out.push({ role: 'user', content: 'Thanks, and the summary?', timestamp: ts(3) });
  out.push({ role: 'assistant', content: 'Working on it', display_kind: 'commentary', timestamp: ts(4) });
  out.push({ role: 'assistant', content: 'Here is the summary.', timestamp: ts(5) });
  return out;
}

test('issue 1266: a post counts the agent replies James sees, never tool calls, results or steps', async () => {
  const h = busyThread(); assert.equal(h.length, 71, '71 stored messages: "70 replies" before');
  const s = row('a', 5, { messageCount: h.length });
  const f = fixture({ history: { a: h.slice(0, 50) }, full: { a: h }, sessions: { a: s } }); f.env.toTurns = realParseRows();
  f.openChannel(f.w, 'launch');
  let html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
  assert.doesNotMatch(html, /\d+ repl/, 'no count is shown until it is known');
  await new Promise(r => setImmediate(r));
  html = f.channelFeed(f.w, f.chanOpen(f.w), [s]); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a', 'full:a'], 'the first page was full, so the whole thread is read once');
  html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
  assert.match(html, /<span>2 replies<\/span>/);
  assert.doesNotMatch(html, /70 repl|71 repl/);
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a', 'full:a'], 'kept while the thread has not moved');
});

test('issue 1266: a short thread is counted from the first-message read alone; a new reply is counted again once it stops working', async () => {
  const h = [{ role: 'user', text: 'q' }, { role: 'tool', text: 't' }, { role: 'assistant', text: 'a1' }];
  const s = row('a', 5, { messageCount: 3 });
  const f = fixture({ history: { a: h }, sessions: { a: s } }); f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await new Promise(r => setImmediate(r));
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [s]), /<span>1 reply<\/span>/);
  assert.deepEqual(f.reads, ['a']);
  Object.assign(s, { status: 'running', messageCount: 9 });
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a'], 'not re-read while it works');
  h.push({ role: 'tool', text: 't2' }, { role: 'assistant', text: 'a2' }); Object.assign(s, { status: 'completed', messageCount: 11 });
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a', 'full:a']);
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [s]), /<span>2 replies<\/span>/);
});

test('issue 1269: a first page the service returned full (pagination.returned = limit) is not the whole thread, even with fewer rows', async () => {
  // Bitwarden: 14 replies; the view=wizard first page holds 46 rows (6 replies) while the service returned 50.
  const h = [{ role: 'user', text: 'Bitwarden?' }];
  for (let i = 0; i < 14; i++) h.push({ role: 'tool', text: 't' }, { role: 'tool', text: 't' }, { role: 'assistant', text: 'r' + i });
  const page = h.slice(0, 1 + 3 * 6).concat(Array.from({ length: 46 - 19 }, () => ({ role: 'tool', text: 'step' }))); page.returned = 50;
  const s = row('a', 5, { messageCount: 60 });
  const f = fixture({ history: { a: page }, full: { a: h }, sessions: { a: s } }); f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await new Promise(r => setImmediate(r));
  assert.doesNotMatch(f.channelFeed(f.w, f.chanOpen(f.w), [s]), /6 replies/, 'never the short page\'s count');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a', 'full:a'], 'the whole thread is read');
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [s]), /<span>14 replies<\/span>/);
  // A page the service returned short of the limit is the whole thread: no second read.
  const g = fixture({ history: { b: Object.assign([{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }], { returned: 2 }) }, sessions: { b: row('b', 5) } }); g.openChannel(g.w, 'launch');
  g.channelFeed(g.w, g.chanOpen(g.w), [row('b', 5)]); await new Promise(r => setImmediate(r));
  assert.deepEqual(g.reads, ['b']);
});

test('issue 1266 main vs routed: host-profile, container and restricted posts are counted from their own agent\'s history', async () => {
  for (const agent of ['host', 'container', 'restricted']) {
    const sp = { host: 'host-ops', container: 'box', restricted: 'locked' }[agent], tid = { host: 'h1', container: 'k1', restricted: 'r1' }[agent];
    const main = row(tid, 2, { owner: '' }), routed = row(tid, 1, { owner: agent, agent });
    const f = fixture({ agents: { [tid]: agent }, history: { [tid]: [{ role: 'user', text: 'm' }, { role: 'assistant', text: '1' }, { role: 'assistant', text: '2' }, { role: 'assistant', text: '3' }], [agent + '|' + tid]: [{ role: 'user', text: 'r' }, { role: 'assistant', text: 'only' }] } });
    f.w.focus = { kind: 'agent', key: agent }; f.openChannel(f.w, sp);
    f.channelFeed(f.w, f.chanOpen(f.w), [main, routed]); await new Promise(r => setImmediate(r));
    assert.deepEqual(f.chanReplies(routed).ats.length, 1, agent);
    assert.ok(f.reads.includes(agent + '|' + tid), agent + ': read with its own agent');
  }
});

// A feed laid out as painted: every post carries its row key (agent|id).
function seenDom(f, html, client = 300) {
  const d = feedDom(html, {}, client);
  for (const n of d.nodes) if (n.dataset.morphKey.startsWith('post:')) n.dataset.chrow = 'hermes|' + n.dataset.morphKey.slice(5);
  d.sc.checkVisibility = () => true; d.sc.closest = () => null;
  f.env.elOf = () => d.el; return d;
}

// Issue 1269 (overrides 1266's "seeing a post reads it"): only opening a post clears its green dot.
test('issue 1269/1316: viewing, scrolling to the end, Back, re-entering and a reload never clear a post\'s green words; the channel line is read', () => {
  const f = fixture({ spacesList: longSpaces(30), marksAt: readTo(29) }), rows = manyRows(30, 2);
  for (const r of rows) r.owner = 'hermes';
  f.openChannel(f.w, 'launch');
  const d = seenDom(f, f.channelFeed(f.w, f.chanOpen(f.w), rows));
  f.chanHold('w');                                                   // opens at the New line: posts on screen
  f.chanUser('w'); d.sc.scrollTop = d.sc.scrollHeight - d.sc.clientHeight; f.chanScrolled('w', d.sc); f.chanHold('w');
  assert.deepEqual(f.marks, [], 'the feed writes no seen record');
  assert.equal(rows.filter(r => r.fresh).length, 28, 'every unread post is still unread');
  f.channelBack(f.w);
  assert.doesNotMatch(f.channelsBody(f.w, rows), /ch-chan-dot new| unread"/, 'Back: scrolled to the end, so the channel line is read (issue 1316)');
  f.openChannel(f.w, 'launch');
  const again = f.channelFeed(f.w, f.chanOpen(f.w), rows);
  assert.equal(again.match(/class="ch-post-st new"/g)?.length, 28, 're-entered: every post\'s green words are there');
  assert.doesNotMatch(again, /ch-chan-new/, 'and no New line: it opens at the bottom');
  f.w.chan = JSON.parse(JSON.stringify(f.w.chan));                   // a reload restores the saved window
  assert.equal(f.channelFeed(f.w, f.chanOpen(f.w), rows).match(/class="ch-post-st new"/g)?.length, 28, 'and after a reload');
  assert.doesNotMatch(src, /LIVE\.markSeen\?\.\(\[\.\.\.out\.values\(\)\]\)|function chanSeeNow/, 'the feed-driven seen writer is gone');
});

test('issue 1269/1316: opening one post clears only that post (the per-chat seen path Activity uses); the channel line keeps its watermark', () => {
  const f = fixture({ spacesList: longSpaces(20), marksAt: readTo(4) }), rows = manyRows(20, 17);
  f.openChannel(f.w, 'launch'); seenDom(f, f.channelFeed(f.w, f.chanOpen(f.w), rows)); f.chanHold('w');
  f.env._rowOf = (_, sid) => rows.find(r => r.id === sid);
  f.env.LIVE.markSeen([f.chanSeenRow('w', 'p18')]);                     // what openChat does: LIVE.markSeen(chanSeenRow(wid, sid))
  assert.deepEqual(f.marks, ['p18']);
  const html = f.channelFeed(f.w, f.chanOpen(f.w), rows), post = id => html.split(/<div class="ch-post(?=[ "])/).find(p => p.includes(`data-morph-key="post:${id}"`));
  assert.doesNotMatch(post('p18'), /ch-post-st new/, 'the opened post is read');
  for (const id of ['p17', 'p19']) assert.match(post(id), /ch-post-st new/, id + ' keeps its dot');
  f.channelBack(f.w);
  assert.match(f.channelsBody(f.w, rows), /aria-label="3 unread"/, 'the channel counts what changed since its watermark, opened or not');
});

test('issue 1269 main vs routed: opening a routed post marks that row (host-profile, container, restricted), never the main twin', () => {
  for (const agent of ['host', 'container', 'restricted']) {
    const sp = { host: 'host-ops', container: 'box', restricted: 'locked' }[agent], tid = { host: 'h1', container: 'k1', restricted: 'r1' }[agent];
    const main = row(tid, 2, { owner: 'hermes', fresh: true }), routed = row(tid, 1, { owner: agent, agent, fresh: true });
    const f = fixture({ agents: { [tid]: agent }, sessions: { [tid]: main } });
    f.w.focus = { kind: 'agent', key: agent }; f.openChannel(f.w, sp);
    const html = f.channelFeed(f.w, f.chanOpen(f.w), [main, routed]);
    const d = feedDom(html, {}, 300, { keys: ['post:' + tid] }); d.nodes[0].dataset.chrow = agent + '|' + tid; f.env.elOf = () => d.el;
    f.chanHold('w'); assert.deepEqual(f.marks, [], agent + ': seeing it writes nothing');
    f.env._rowOf = () => routed; f.env.LIVE.markSeen([f.chanSeenRow('w', tid)]);
    assert.deepEqual(f.marks, [agent + '|' + tid], agent);
    assert.equal(main.fresh, true, agent + ': the main thread stays unread');
  }
});

// The real chats.css on markup the real Channels code rendered, with stand-in skin tokens (mini-dom + mini-css).
const chatsCss = readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const SKIN_TOKENS = 'html { --green: #3c9; --amber: #fb3; --ink: #eee; --ink-2: #bbb; --ink-3: #888; --violet: #93f; --violet-2: #a7f; --wz-accent: #48f; --wz-base: #012; --wz-text-secondary: #9ab; --wz-border: #345; }';
const SUPPORTS = { media: m => m.startsWith('@supports') };
function painted(html, { attrs = {} } = {}) {
  const doc = createDocument(); for (const [k, v] of Object.entries(attrs)) doc.documentElement.setAttribute(k, v);
  doc.body.innerHTML = html; const sheets = [SKIN_TOKENS + '\n' + chatsCss];
  return { doc, q: sel => { const el = doc.querySelector(sel); if (!el) throw new Error('not rendered: ' + sel); return el; }, v: (el, prop, opts) => valueOf(el, sheets, prop, opts) };
}

test('issue 1266: unread is a green dot and needs-you an amber one in Channels, on every skin; Activity keeps its own dot', async () => {
  const f = fixture(); f.channelClick(click({ 'data-chchanx': 'launch' }), 'w', f.w);
  const html = f.channelsBody(f.w, [row('a', 1, { fresh: true }), row('b', 2, { attention: { state: 'needs_you' }, fresh: true })]);
  assert.match(html, /class="ch-chan-post unread" data-chopen="a"><span>T a<\/span><span class="ch-chan-ind"><i class="ch-chan-dot new" role="img" aria-label="Unread"><\/i><\/span>/);
  assert.match(html, /data-chopen="b"><span>T b<\/span><span class="ch-chan-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you"><\/i><i class="ch-chan-dot new" role="img" aria-label="Unread"><\/i><\/span>/, 'amber, then green');
  const css = (s => s.slice(s.indexOf('/* Channels in Chats (wizard-ux issue 1254)')))(readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8'));
  for (const l of css.split('\n').filter(l => /unread|ch-chan-ind|ch-chan-new|ch-chan-dot\.new|ch-post-st\.new|ch-post-r span/.test(l))) assert.doesNotMatch(l, /--violet/, 'no violet unread marks: ' + l.slice(0, 90));
  // What the rendered Channels lines paint (the real chats.css on the real markup).
  const P = painted(`<div class="ch-list">${html}</div>`), list = P.q('.ch-list');
  const unreadDot = P.q('[data-chopen="a"] .ch-chan-dot.new'), needsDot = P.q('[data-chopen="b"] .ch-chan-dot:not(.new)');
  assert.equal(P.v(list, '--ch-new'), '#3c9', 'the skin\'s own green');
  assert.equal(P.v(list, '--ch-new', SUPPORTS), 'oklch(from #3c9 l c 150)', 'held on a green hue where a skin\'s green is gold (Ember)');
  assert.equal(P.v(unreadDot, 'background'), '#3c9', 'the green dot: the skin\'s full green, never a dark mix');
  assert.equal(P.v(needsDot, 'background'), '#fb3', 'needs you stays amber');
  assert.equal(P.v(P.q('[data-chopen="a"] .ch-chan-ind'), 'margin-left'), 'auto', 'one right-aligned slot');
  assert.doesNotMatch(css, /\.ch-chan-n\b|\.ch-post-r \.st\.unread/, 'issue 1269: no number pill, no left-side dot');
  assert.doesNotMatch(css, /\.st\.unread/, 'Activity\'s .st.unread is untouched');
  // The feed's unread post: "N new replies" in ink, the "New reply" words in that green.
  const a = [{ role: 'user', text: 'q' }, { role: 'assistant', text: '1', at: 100 }, { role: 'assistant', text: '2', at: 200 }];
  const g = fixture({ history: { a } }); g.openChannel(g.w, 'launch');
  const rows = [row('a', 3, { fresh: true, messageCount: 2, readAt: 150 })];
  g.channelFeed(g.w, g.chanOpen(g.w), rows); await settle();
  const F = painted(`<div class="ch-list">${g.channelFeed(g.w, g.chanOpen(g.w), rows)}</div>`);
  assert.equal(F.v(F.q('.ch-post-st.new'), 'color'), '#3c9', 'the feed\'s "New reply" words in that green');
  assert.equal(F.v(F.q('.ch-post-r.unread > span:not(.ch-post-st):not(.ch-post-av):not(.ch-post-sts)'), 'color'), '#eee', '"N new replies" in ink');
  // Grove's unread dot was gold like its needs-you dot; the real skins.js tokens it paints are not.
  const grove = skinPage('grove', 'phone', `<div class="ch-list">${html}</div>`), gq = s => grove.doc.querySelector(s);
  const groveNew = grove.value(gq('[data-chopen="a"] .ch-chan-dot.new'), 'background');
  assert.match(groveNew, /^rgba?\(/, 'the unread dot paints a colour'); assert.notEqual(groveNew, grove.value(gq('[data-chopen="b"] .ch-chan-dot:not(.new)'), 'background'));
});

test('issue 1266: what a feed keeps for this open never goes into the saved window (a reload restores a plain o.chan)', () => {
  const f = fixture({ spacesList: longSpaces(20) }), rows = manyRows(20, 5);
  f.openChannel(f.w, 'launch'); seenDom(f, f.channelFeed(f.w, f.chanOpen(f.w), rows)); f.chanHold('w');
  const saved = JSON.parse(JSON.stringify(f.w.chan));
  assert.deepEqual(Object.keys(saved).sort(), ['at', 'id', 'newKey', 'prev'], 'only plain fields');
  f.w.chan = saved; // the window as a reload restores it
  assert.doesNotThrow(() => f.channelFeed(f.w, f.chanOpen(f.w), rows));
});

// ---- issue 1266, fourth item: a post shows the owner's own words from its first frame, never the generated title ----
const TITLE = 'Process Jonathan call transcript for insights';
const noTitle = (html, why) => { assert.doesNotMatch(html, /class="ch-post-t[^"]*">Process Jonathan/, why); assert.doesNotMatch(html, /ch-post-h"><b>[^<]*<\/b><time>[^<]*<\/time><\/span><span class="ch-post-t[^"]*">T /, why); };

test('issue 1266: an empty first read (a chat just started) is not kept as "no owner message": read again, never the title', async () => {
  const history = { a: [] }, s = row('a', 0, { title: TITLE, status: 'running' });
  const f = fixture({ history, sessions: { a: s } }); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w);
  f.channelFeed(f.w, open, [s]); await settle();
  let html = f.channelFeed(f.w, open, [s]); await settle();
  noTitle(html, 'empty history: no title');
  assert.match(html, /ch-post-wait/, 'the loading line meanwhile');
  assert.deepEqual(f.reads, ['a'], 'not again within the short wait');
  history.a = [{ role: 'user', text: 'I just had a call with Jonathan.' }]; f.env._now = NOW + 2.1e3;
  f.channelFeed(f.w, open, [s]); await settle();
  assert.deepEqual(f.reads, ['a', 'a'], 'read again soon');
  assert.match(f.channelFeed(f.w, open, [s]), />I just had a call with Jonathan\.</);
});

test('issue 1266: the reviewer\'s sequence: empty read, then a row with firstRequest, then a stale row without it: the words stay', async () => {
  const history = { a: [] }, f = fixture({ history }); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w), stale = row('a', 0, { title: TITLE, status: 'running' });
  f.channelFeed(f.w, open, [stale]); await settle();
  noTitle(f.channelFeed(f.w, open, [stale]), 'empty history');
  const fresh = { ...stale, firstRequest: 'Jonathan transcript: we talked about virtue.' };
  assert.match(f.channelFeed(f.w, open, [fresh]), />Jonathan transcript: we talked about virtue\.</);
  for (let i = 0; i < 4; i++) {
    const html = f.channelFeed(f.w, open, [i % 2 ? fresh : stale]); await settle();
    assert.match(html, />Jonathan transcript: we talked about virtue\.</, 'refresh ' + i + ': the words stay');
    noTitle(html, 'refresh ' + i);
  }
});

test('issue 1266: a voice note says "Voice note" until its transcript is known, then the transcript; 30 s of refreshes and work never show the title', async () => {
  const history = { a: [] }, f = fixture({ history }); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w);
  // The outbox's synthetic row first (live.js addSynthetic: preview "🎙 Voice note"), then Wizard's row with its title.
  const synth = { id: 'a', title: '🎙 Voice note', status: 'submitting', at: NOW, preview: '🎙 Voice note', previewRole: 'user', synthetic: true, pendText: '🎙 Voice note' };
  const listed = row('a', 0, { title: TITLE, status: 'running', request: '', preview: '', pendText: '🎙 Voice note' });
  const seen = [];
  const paint = async (r, t) => { f.env._now = NOW + t; const html = f.channelFeed(f.w, open, [r]); seen.push(html); await settle(); return html; };
  let html = await paint(synth, 0);
  assert.match(html, /class="ch-post-t ch-post-voice">Voice note</, 'the neutral placeholder from the first frame');
  html = await paint(listed, 500);
  assert.match(html, /ch-post-voice">Voice note</);
  // History holds the voice note before its words (an audio attachment with no transcript yet).
  history.a = [{ role: 'user', text: '', files: [{ id: 'v1', name: 'voice.m4a', mime: 'audio/mp4' }] }];
  for (let t = 3e3; t < 12e3; t += 1500) assert.match(await paint(t % 3e3 ? synth : listed, t), /ch-post-voice">Voice note</, 'still the placeholder at ' + t);
  history.a = [{ role: 'user', text: 'I just had a call with Jonathan. Please pass the transcript to the philosopher.' }, { role: 'assistant', text: '' }];
  for (let t = 12e3; t <= 42e3; t += 1500) {
    const r = [listed, synth, { ...listed, status: 'completed' }, { ...listed, request: 'I just had a call with Jonathan. Please pass the transcript to the philosopher.' }][(t / 1500) % 4];
    await paint(r, t);
  }
  const last = seen.at(-1);
  assert.match(last, />I just had a call with Jonathan\. Please pass the transcript to the philosopher\.</);
  for (const h of seen) noTitle(h, 'never a frame of the generated title');
  const after = seen.slice(seen.findIndex(h => />I just had a call/.test(h)));
  assert.ok(after.length > 10 && after.every(h => />I just had a call/.test(h)), 'once shown, the words never flip back');
});

test('issue 1266: a typed post keeps the words it was sent with through stale rows and an empty first read', async () => {
  const history = { a: [] }, f = fixture({ history }); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w);
  const r1 = row('a', 0, { title: TITLE, status: 'running', request: 'Summarise the Jonathan call', preview: 'Summarise the Jonathan call', previewRole: 'user' });
  const r2 = row('a', 0, { title: TITLE, status: 'running', request: '', preview: 'Running read_file', previewRole: 'assistant' });
  for (let i = 0; i < 6; i++) { const html = f.channelFeed(f.w, open, [i % 2 ? r2 : r1]); await settle(); assert.match(html, />Summarise the Jonathan call</, 'frame ' + i); noTitle(html, 'frame ' + i); }
});

test('issue 1266: a thread the agent started itself with nothing readable yet still shows its title', async () => {
  const history = { a: [{ role: 'assistant', text: '' }] }, s = row('a', 1, { title: 'Daily roundup' });
  const f = fixture({ history, sessions: { a: s } }); f.env.toTurns = () => [];
  f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [s]), /class="ch-post-t">Daily roundup</);
});

// Alerts (wizard-agent-service issue 441): a post the agent wrote is the agent's own first message, with its avatar,
// name and a Reply button; Reply opens its thread with the composer ready.
test('issue 441: an agent-started post shows the agent\'s message, avatar and name, and a Reply button', async () => {
  const history = { a: [{ role: 'assistant', text: 'Reminder: the synthetic invoice is due today.', at: NOW - H }] }, s = row('a', 1, { title: 'Invoice reminder', attention: { state: 'needs_you' } });
  const f = fixture({ history, sessions: { a: s } }); f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  const html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
  assert.match(html, /class="ch-post-t">Reminder: the synthetic invoice is due today\.</);
  assert.match(html, /class="ch-post by-agent"/);
  assert.match(html, /<span class="ch-post-me ch-post-ag" aria-hidden="true"><i class="ag-sig" data-agent="hermes"><\/i><\/span>/, 'the agent\'s sigil, not the owner\'s initial');
  assert.match(html, /<b>Wizard<\/b>/, 'the agent\'s name, not the owner\'s');
  assert.doesNotMatch(html, /James de Fleur/);
  assert.match(html, /<button type="button" class="ch-post-reply" data-chreply="a" aria-label="Reply to Wizard">Reply<\/button>/);
  assert.doesNotMatch(html, /class="ch-post-r[ "]/, 'no reply line before any reply');
  assert.doesNotMatch(html, />Invoice reminder</, 'the post is the message, not the title');
  assert.match(html, /<span class="ch-post-st needs">.*Needs you<\/span>/, 'an alert that needs the owner keeps the amber state');
});

// Issue 1287: an agent's post renders the chat bubble's inline markdown (the real KIT.inline from core/chat-kit.js):
// a bold first line shows bold with no asterisks, links are links. The owner's own words stay plain text.
function realInline() {
  const ctx = { location: { origin: 'https://w.example', hostname: 'w.example', href: 'https://w.example/wizard-os-home/' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: {}, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(kitSrc, ctx); return ctx.WosChat.inline;
}
test('issue 1287: an agent post shows bold and links, not raw markdown; an owner post stays plain', async () => {
  const history = { a: [{ role: 'assistant', text: '**Bold point.** rest, see https://example.com/report and `code`', at: NOW - H }], b: [{ role: 'user', text: 'my **own** words', at: NOW - H }] };
  const s = row('a', 1, { title: 'Alert' }), o = row('b', 2, { title: 'Mine' });
  const f = fixture({ history, sessions: { a: s, b: o } }); f.env.KIT.inline = realInline(); f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), [s, o]); await settle();
  const html = f.channelFeed(f.w, f.chanOpen(f.w), [s, o]);
  assert.match(html, /class="ch-post-t"><strong>Bold point\.<\/strong> rest/, 'bold, with no asterisks');
  assert.doesNotMatch(html, /\*\*Bold/);
  assert.match(html, /<a href="https:\/\/example\.com\/report" target="_blank" rel="noopener noreferrer">/, 'the link can be tapped');
  assert.match(html, /<code>code<\/code>/);
  assert.doesNotMatch(html, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<a /, 'no link inside a button: each link is its own control');
  assert.match(html, /<div class="ch-post-tb" data-chopen="a"><span class="ch-post-t"><strong>/, 'a tap on the words still opens the thread');
  assert.match(html, /class="ch-post-t">my \*\*own\*\* words</, 'the owner\'s words stay as typed');
});

test('issue 1287: an agent post\'s heading lines show bold words, never a raw #', async () => {
  const history = { a: [{ role: 'assistant', text: '## Executive signal\n# Morning projects #\n### **Already bold**\nbody #not-a-heading', at: NOW - H }], b: [{ role: 'user', text: '# a hash', at: NOW - H }] };
  const s = row('a', 1, { title: 'Alert' }), o = row('b', 2, { title: 'Mine' });
  const f = fixture({ history, sessions: { a: s, b: o } }); f.env.KIT.inline = realInline(); f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), [s, o]); await settle();
  const html = f.channelFeed(f.w, f.chanOpen(f.w), [s, o]);
  assert.match(html, /<strong>Executive signal<\/strong>/);
  assert.match(html, /<strong>Morning projects<\/strong>/, 'closing hashes go too');
  assert.match(html, /<strong>Already bold<\/strong>/);
  assert.doesNotMatch(html, /#+ ?(Executive|Morning|<strong>)/, 'no raw # before a heading');
  assert.match(html, /body #not-a-heading/, 'a # inside a line stays');
  assert.match(html, /class="ch-post-t"># a hash</, 'the owner\'s words stay as typed');
});

test('issue 1287 main vs routed: host-profile, container and restricted agent posts render the same markdown', async () => {
  const inline = realInline();
  for (const [chan, agent, sid] of [['launch', '', 'a'], ['host-ops', 'host', 'h1'], ['box', 'container', 'k1'], ['locked', 'restricted', 'r1']]) {
    const k = agent ? `${agent}|${sid}` : sid, s = row(sid, 1, { owner: agent });
    const f = fixture({ agents: { [sid]: agent }, history: { [k]: [{ role: 'assistant', text: `**Alert for ${agent || 'main'}.** _soon_\n## Heading for ${agent || 'main'}\n\`\`\`\n# keep ${agent || 'main'}\n\`\`\``, at: NOW - H }] }, sessions: { [agent ? k : sid]: s } });
    f.env.KIT.inline = inline; f.openChannel(f.w, chan);
    f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
    const html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
    assert.match(html, new RegExp(`class="ch-post-t[^"]*"><strong>Alert for ${agent || 'main'}\\.</strong> <em>soon</em>\\s`), `${agent || 'main'}: bold and italics`);
    assert.match(html, new RegExp(`<strong>Heading for ${agent || 'main'}</strong>`), `${agent || 'main'}: a heading line is bold, no raw #`);
    assert.match(html, new RegExp(`# keep ${agent || 'main'}`), `${agent || 'main'}: a # line inside a code fence stays as written`);
    assert.doesNotMatch(html, /\*\*keep/);
  }
});

test('issue 441: Reply opens the thread and focuses its composer; a thread with replies shows the reply line instead', async () => {
  const opened = [], focused = [];
  const ta = { focus: o => focused.push(o) };
  const history = { a: [{ role: 'assistant', text: 'Synthetic alert', at: NOW - 2 * H }, { role: 'user', text: 'Thanks', at: NOW - H }, { role: 'assistant', text: 'Done', at: NOW - H / 2 }] };
  const s = row('a', 1, { messageCount: 3 });
  const f = fixture({ history, sessions: { a: s } });
  f.env.openChat = (wid, sid) => opened.push([wid, sid]); f.env.elOf = () => ({ querySelector: sel => sel === '.ch-compose textarea' ? ta : null });
  assert.equal(f.channelClick(click({ 'data-chreply': 'a' }), 'w', f.w), true);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [['w', 'a']]);
  assert.deepEqual(JSON.parse(JSON.stringify(focused)), [{ preventScroll: true }]);
  f.openChannel(f.w, 'launch');
  for (let i = 0; i < 3; i++) { f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle(); }
  const html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
  assert.match(html, /class="ch-post-t">Synthetic alert</);
  assert.doesNotMatch(html, /data-chreply/, 'replied: the reply line, not the Reply button');
  assert.match(html, /<span>1 reply<\/span>/, 'the agent\'s first message is the post, not a reply');
});

test('issue 441 main vs routed: host-profile, container and restricted alerts carry their own agent, history read and Reply', async () => {
  const names = { hermes: 'Wizard', host: 'Host agent', container: 'Box agent', restricted: 'Locked agent' };
  for (const [chan, agent, sid] of [['launch', '', 'a'], ['host-ops', 'host', 'h1'], ['box', 'container', 'k1'], ['locked', 'restricted', 'r1']]) {
    const k = agent ? `${agent}|${sid}` : sid;
    const history = { [k]: [{ role: 'assistant', text: `Synthetic alert for ${agent || 'main'}`, at: NOW - H }, { role: 'user', text: 'Synthetic owner reply', at: NOW - H / 2 }] };
    const s = row(sid, 1, { owner: agent, messageCount: 2 });
    const f = fixture({ agents: { [sid]: agent }, history, sessions: { [agent ? k : sid]: s } });
    f.env.agentName = id => names[id || 'hermes'];
    const opened = [], focused = [];
    f.env.openChat = (wid, id) => opened.push(id); f.env.elOf = () => ({ querySelector: sel => sel === '.ch-compose textarea' ? { focus: () => focused.push(sid) } : null });
    f.openChannel(f.w, chan);
    f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
    const html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
    assert.ok(f.reads.includes(k), `${agent || 'main'}: the history read names the row's own agent`);
    assert.match(html, new RegExp(`class="ch-post-t">Synthetic alert for ${agent || 'main'}<`), `${agent || 'main'}: the agent's message, not the owner's reply`);
    assert.doesNotMatch(html, /Synthetic owner reply/);
    assert.match(html, new RegExp(`<span class="ch-post-me ch-post-ag" aria-hidden="true"><i class="ag-sig" data-agent="${agent || 'hermes'}"></i></span>`));
    assert.match(html, new RegExp(`<b>${names[agent || 'hermes']}</b>`));
    assert.match(html, new RegExp(`data-chreply="${sid}"`));
    assert.equal(f.channelClick(click({ 'data-chreply': sid }), 'w', f.w), true);
    assert.deepEqual([...opened, ...focused], [sid, sid]);
  }
});

test('issue 441 review: an alert\'s photos open in the viewer, and a fresh alert is never "1 new reply"', async () => {
  const pic = { id: 'p1', name: 'Chart', mime: 'image/png', kind: 'image', url: '/wizard/files/p1/content' };
  const history = { a: [{ role: 'assistant', text: 'Synthetic chart alert', at: NOW - H }] };
  const s = row('a', 1, { fresh: true, messageCount: 1 });
  const f = fixture({ history, full: history, sessions: { a: s } });
  const turns = f.env.toTurns; f.env.toTurns = rows => turns(rows).map(t => t.a ? { ...t, media: [pic] } : t);
  f.openChannel(f.w, 'launch');
  for (let i = 0; i < 3; i++) { f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle(); }
  const html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
  assert.match(html, /data-chpostimg="a"/);
  assert.equal(f.channelClick(click({ 'data-chpostimg': 'a' }), 'w', f.w), true);
  assert.equal(f.viewer.length, 1, 'the alert\'s photo opens'); assert.equal(f.viewer[0][0][0].id, 'p1');
  assert.doesNotMatch(html, /new repl/, 'the opening post is not a new reply');
  assert.match(html, /<span class="ch-post-st new">[^]*?New<\/span>/);
});

test('issue 441: an agent post read before its first words is read again once the thread moves', async () => {
  const history = { a: [] }, s = row('a', 1, { title: 'Synthetic report', messageCount: 1 });
  history.a = [{ role: 'assistant', text: '' }];
  const f = fixture({ history, sessions: { a: s } }); f.openChannel(f.w, 'launch');
  const turns = f.env.toTurns; f.env.toTurns = rows => turns(rows).filter(t => t.a?.text);
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [s]), /class="ch-post-t">Synthetic report</);
  const reads = f.reads.length;
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  assert.equal(f.reads.filter(r => r === 'a').length, f.reads.slice(0, reads).filter(r => r === 'a').length, 'not re-read while the thread has not moved');
  history.a = [{ role: 'assistant', text: 'Synthetic report body' }]; s.messageCount = 2;
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [s]), /class="ch-post-t">Synthetic report body</);
});

test('issue 1266 review: a history cut short by threadRows\' page limit gives no count, never a partial one', async () => {
  const h = busyThread(), cut = h.slice(); cut.truncated = true;
  const s = row('a', 5, { messageCount: h.length });
  const f = fixture({ history: { a: h.slice(0, 50) }, full: { a: cut }, sessions: { a: s } }); f.env.toTurns = realParseRows();
  f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  assert.deepEqual(f.reads, ['a', 'full:a']);
  const html = f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  assert.doesNotMatch(html, /\d+ repl/, 'no count');
  assert.deepEqual(f.reads, ['a', 'full:a'], 'not re-read in a loop while the thread has not moved');
});

test('issue 1266: an owner message whose words are not readable yet (a voice note mid-transcription) is never taken for an agent-started thread', async () => {
  const history = { a: [{ role: 'user', text: '', content: '<helm_attachments>{"items":[{"mime":"audio/webm"}]}</helm_attachments>' }] };
  const s = row('a', 0, { title: TITLE, status: 'running' });
  const f = fixture({ history, sessions: { a: s } }); f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  const html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
  assert.match(html, /ch-post-voice">Voice note</); noTitle(html, 'no title');
  assert.equal(f.FIRST.has('|a'), false, 'not kept: read again soon');
});

test('issue 1266 review: internal user rows parseRows hides (notes, steers, run context) do not hold an agent-started post on the loading line', async () => {
  const history = { a: [{ role: 'user', display_kind: 'agent_note', content: 'From the scheduler: roundup' }, { role: 'user', content: '[Cross-thread note] internal' }, { role: 'assistant', text: 'Morning roundup' }] };
  const s = row('a', 1, { title: 'Daily roundup' });
  // The stand-in turns every user row into an owner turn; a parseRows-like one drops these internal rows.
  const f = fixture({ history, sessions: { a: s } }); f.env.toTurns = rows => rows.filter(r => r.role === 'assistant').map(r => ({ a: { text: r.text } }));
  f.openChannel(f.w, 'launch');
  f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [s]), /class="ch-post-t">Morning roundup</, 'the agent\'s own message (issue 441)');
  assert.equal(f.FIRST.get('|a')?.none, true, 'kept: no owner message');
});

test('AI apps sidebar (wizard-ux issue 1256, James 11 Nov 2026): a channel opened from the sidebar pane opens in the host\'s feed window; the sidebar list never changes', () => {
  const f = fixture({ rows: [row('a', 1), row('b', 2), row('d', 3)] });
  const main = f.w; main.focus = { kind: 'agent', key: 'hermes' };
  const side = { id: 'w::side', thread: null }, feedOwner = { id: 'feed', thread: null, focus: { kind: 'agent', key: 'hermes' } }, feed = { id: 'feed::side', thread: null };
  const wins = { w: main, 'w::side': side, feed: feedOwner, 'feed::side': feed }, opened = [];
  f.env.W = new Proxy({}, { get: (_, id) => wins[id] });
  f.env.owner = id => String(id).replace(/::side$/, '');
  f.env.setFocus = (w, x) => { (wins[f.env.owner(w.id)] || w).focus = x; return true; };
  Object.assign(f.env.H, { channelWin: w => w.id === 'w::side' ? feed : null, channelsElsewhere: w => w.id === 'w::side', channelCurrent: () => feedOwner.chan && f.chanOpen(feed)?.id || '', channelOpened: id => opened.push(id) });
  const ids = h => h.split(/<div class="ch-chan(?=[ "])/).slice(1).map(l => /data-chchan="([^"]+)"/.exec(l)[1]), before = ids(f.channelsBody(side, f.rows));
  // Opening Launch from the sidebar's pane: the feed window holds it; the window behind the sidebar is untouched.
  assert.equal(f.channelClick(click({ 'data-chchan': 'launch' }), 'w::side', side), true);
  assert.deepEqual(opened, ['feed::side'], 'the host is told the feed window opened a channel');
  assert.equal(main.chan, undefined, 'the sidebar\'s window never holds the channel');
  assert.deepEqual(main.focus, { kind: 'agent', key: 'hermes' }, 'the sidebar\'s Focus is unchanged: its channel list and Activity rows stay');
  assert.equal(feedOwner.chan.id, 'launch'); assert.deepEqual(JSON.parse(JSON.stringify(feedOwner.focus)), { kind: 'space', key: 'launch' });
  assert.equal(f.chanOpen(side), null, 'the sidebar pane has no feed open');
  assert.equal(f.chanOpen(feed).name, 'Launch', 'the feed window has');
  // The sidebar's channel list: every channel still there, Launch marked as the one open in the column.
  const html = f.channelsBody(side, f.rows), lines = html.split(/<div class="ch-chan(?=[ "])/).slice(1);
  assert.deepEqual(ids(html), before, 'the list as it was'); assert.ok(before.includes('launch') && before.length > 2);
  assert.deepEqual(lines.filter(l => /^[^"]*\bcur\b/.test(l)).map(l => /data-chchan="([^"]+)"/.exec(l)[1]), ['launch'], 'Launch marked, only Launch');
  assert.match(html, /data-chchan="launch" aria-current="true"/); assert.equal((html.match(/aria-current/g) || []).length, 1);
  // Another channel from the sidebar: the feed moves there; the sidebar still unchanged.
  f.channelClick(click({ 'data-chchan': 'voice' }), 'w::side', side);
  assert.equal(f.chanOpen(feed).name, 'Voice'); assert.equal(main.chan, undefined); assert.deepEqual(main.focus, { kind: 'agent', key: 'hermes' });
  // Back on the feed window closes it; nothing is marked in the sidebar then.
  assert.equal(f.channelBack(feed), true); assert.equal(f.chanOpen(feed), null);
  assert.ok(!f.channelsBody(side, f.rows).match(/<div class="ch-chan[^"]*"/g).some(c => /\bcur\b/.test(c)), 'no channel marked');
  assert.deepEqual(ids(f.channelsBody(side, f.rows)), before);
  // Every other window (phone, classic desktop Chats) opens a channel in place, as before.
  f.env.H.channelWin = () => null; f.env.H.channelsElsewhere = () => false;
  f.channelClick(click({ 'data-chchan': 'launch' }), 'w', main);
  assert.equal(main.chan.id, 'launch', 'in place without a feed window');
});

// wizard-ux issue 1291 follow-up (Archimedes' in-shell review, 11 Nov 2026): a feed opened at its New line, or scrolled up,
// did not show the owner's new post (voice key, orb) until he scrolled. His own post now brings the feed to its end;
// other people's and agents' posts never move it.
test('issue 1291: the owner\'s own new post brings the feed to its end from the New line or a scrolled-up place; agents\' posts do not', () => {
  const f = fixture({ spacesList: longSpaces(120), marksAt: readTo(17) }), rows = manyRows(120, 104);
  f.env.CH.w = {}; f.env.focusAgentId = w => w?.focus?.kind === 'agent' ? w.focus.key : '';
  f.openChannel(f.w, 'launch');
  const html = f.channelFeed(f.w, f.chanOpen(f.w), rows), d = feedDom(html); f.env.elOf = () => d.el;
  const bottom = () => d.sc.scrollHeight - d.sc.clientHeight;
  f.chanHold('w'); assert.notEqual(d.sc.scrollTop, bottom(), 'opened at the New line, not the end');
  assert.equal(f.chanOwnPost('voice', ''), 0, 'a post into another channel: this feed stays');
  assert.equal(f.chanOwnPost('launch', 'host'), 0, 'another agent\'s channel of the same id: stays');
  assert.equal(f.chanOwnPost('', ''), 0, 'a General post: not this feed');
  f.chanHold('w'); assert.notEqual(d.sc.scrollTop, bottom());
  // His post into this channel: the end, held while the post fills in.
  assert.equal(f.chanOwnPost('launch', ''), 1);
  assert.deepEqual({ ...f.w.chan.at }, { end: true });
  d.nodes.push({ dataset: { morphKey: 'post:mine' }, h: 140, getBoundingClientRect() { const top = d.nodes.slice(0, d.nodes.indexOf(this)).reduce((a, x) => a + x.h, 0); return { top: top - d.sc.scrollTop, bottom: top + this.h - d.sc.scrollTop }; } });
  f.chanHold('w'); assert.equal(d.sc.scrollTop, bottom(), 'the new post is in view');
  // Scrolled up again, an agent's new post arrives: the place holds (no yank).
  f.chanUser('w'); d.sc.scrollTop = 1050; f.chanScrolled('w', d.sc);
  const at = { ...f.w.chan.at }; assert.equal(at.key, 'post:p10');
  d.nodes.push({ dataset: { morphKey: 'post:agent' }, h: 200, getBoundingClientRect: () => ({ top: 99999, bottom: 99999 }) });
  f.chanHold('w'); assert.equal(d.sc.scrollTop, 1050, 'someone else\'s post never moves the feed');
  assert.deepEqual({ ...f.w.chan.at }, at);
});

test('issue 1291: General\'s feed follows the owner\'s General posts: every agent\'s from All, its own agent\'s when focused', () => {
  const f = fixture(); f.env.CH.w = {}; let focusAg = '';
  f.env.focusAgentId = () => focusAg;
  f.openChannel(f.w, '__general__'); assert.equal(f.chanOpen(f.w)?.general, true);
  f.w.chan.at = { key: 'post:a', y: 0 };
  assert.equal(f.chanOwnPost('launch', ''), 0, 'a channel post: not General');
  assert.equal(f.chanOwnPost('', 'host'), 1, 'All view: General shows every agent\'s unfiled posts (review on #1306)');
  assert.deepEqual({ ...f.w.chan.at }, { end: true });
  focusAg = 'hermes'; f.w.chan.at = { key: 'post:a', y: 0 };
  assert.equal(f.chanOwnPost('', 'host'), 0, 'an agent-focused General: another agent\'s post leaves it');
  assert.equal(f.chanOwnPost('', ''), 1); assert.deepEqual({ ...f.w.chan.at }, { end: true });
});

test('issue 1291: every owner post path calls it (box mic, voice keys and the orb via sendChat\'s channel); typed sends keep chanToEnd', async () => {
  // sendChat with a channel's Space: the owner's own post moves that channel's read mark
  const ctx = runRecording(`${fnBlock(src, '  async function sendChat(')}\nthis.sendChat = sendChat;`, {
    W: { w1: { id: 'w1', app: 'chats', thread: null } }, ch: () => ({ draft: '', files: [] }), focusOf: () => null, AGID: '', MAX_FILES: 10, window: {}, Promise, Date, Object, Array, String, JSON, Math, Error, Set, Map,
    OUTBOX: { enqueue: async it => ({ ...it, sessionId: 's9', agent: 'merlin', durable: true }) }, joinWords: (a, b) => [a, b].filter(Boolean).join('\n\n'),
    KIT: { drafts: { get: () => ({}), clear() {}, set() {} } }, isWorking: () => false, pendRef: f => f });
  await ctx.sendChat('w1', 'hello', 'voice', null, { sid: '__new__', space: 'launch', away: true });
  assert.deepEqual(ctx.calls.filter(c => c[0] === 'chanOwnPost').map(c => c.slice(1)), [['launch', 'merlin']]);
  // chat-power's box mic: a recorded post pinned to a channel calls it too
  const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
  const line = srcLine(power, "if (typeof pinned === 'string' && it?.sessionId) A.chanOwnPost?.(pinned, it.agent || '');").trim();
  const own = [], A = { chanOwnPost: (...a) => own.push(a) };
  vm.runInNewContext(line, { pinned: 'voice', it: { sessionId: 's1', agent: 'hermes' }, A }); vm.runInNewContext(line, { pinned: null, it: { sessionId: 's2' }, A });
  assert.deepEqual(own, [['voice', 'hermes']]);
  // a typed channel post: on screen and at the end on this frame, and again once sent
  const form = { querySelector: () => ({ value: 'typed' }) };
  const cs = runRecording(`${fnBlock(src, '  async function channelSend(')}\nthis.send = channelSend;`, { W: { w1: { id: 'w1' } }, chanDraftKey: () => 'chan:launch', chanOpen: () => ({ id: 'launch', name: 'Launch' }), ch: () => ({ files: [] }),
    H: {}, CHAN_SENDING: [], Date, Math, String, sendChat: async () => ({ sessionId: 's3' }), winAgent: () => '', AGS: () => null, KIT: { drafts: { clear() {} } } });
  await cs.send('w1', form);
  const order = cs.calls.map(c => c[0]).filter(n => n === 'renderChatList' || n === 'chanToEnd' || n === 'chanRepaint');
  assert.deepEqual(order.slice(0, 2), ['renderChatList', 'chanToEnd'], 'typed sends keep chanToEnd');
  assert.deepEqual(order.slice(-2), ['chanRepaint', 'chanToEnd']);
});

// wizard-ux issue 1316 (James, 12 Nov 2026, supersedes the opening place and New line of 1263 and 1269): a Slack-style
// read watermark per channel. Scrolling to the bottom reads the whole channel; a post never opened does not pull the
// feed back to it; the New line sits just below the old mark, above whatever changed after it, in posting order.
const generalRows = (n, extra = {}) => Array.from({ length: n }, (_, i) => row('g' + i, n - i, { owner: 'hermes', startedAt: new Date(NOW - (n - i) * H).toISOString(), ...(extra[i] || {}) }));
const keysOf = html => [...html.matchAll(/data-morph-key="((?:post:|chan-new)[^"]*)"/g)].map(m => m[1]);
const generalLine = (f, rows) => f.channelsBody(f.w, rows).split(/<div class="ch-chan(?=[ "])/).slice(1).find(c => c.includes('data-chchan="__general__"'));
function readToEnd(f, rows) {
  const html = f.channelFeed(f.w, f.chanOpen(f.w), rows), d = feedDom(html); f.env.elOf = () => d.el;
  f.chanHold('w'); f.chanUser('w'); d.sc.scrollTop = d.sc.scrollHeight - d.sc.clientHeight; f.chanScrolled('w', d.sc);
  return { html, d };
}

test('issue 1316: open → scroll to the bottom → Back → reopen lands at the bottom with no New line; an unopened old reply never places it', () => {
  const f = fixture({ spacesList: [], marksAt: readTo(10) }), rows = generalRows(40, { 5: { fresh: true } });
  f.openChannel(f.w, '__general__');
  let html = f.channelFeed(f.w, f.chanOpen(f.w), rows);
  assert.equal(f.w.chan.newKey, 'hermes|g31', 'the line is below the watermark, not at g5 (the post with a reply never opened)');
  assert.match(generalLine(f, rows), /^ unread"[^]*aria-label="9 unread"/, 'nine posts changed since the mark');
  readToEnd(f, rows);
  assert.equal(f.chanReadAt('general'), NOW - H, 'the end of the feed: read to its newest post');
  assert.deepEqual(f.marks, [], 'scrolling writes no per-thread seen record');
  f.channelBack(f.w);
  assert.doesNotMatch(generalLine(f, rows), /ch-chan-dot new| unread"/, 'the channel line is read');
  f.openChannel(f.w, '__general__');
  html = f.channelFeed(f.w, f.chanOpen(f.w), rows);
  assert.doesNotMatch(html, /ch-chan-new/, 'no New line');
  assert.deepEqual({ ...f.w.chan.at }, { end: true }, 'it opens at the bottom');
  assert.match(html.split(/<div class="ch-post(?=[ "])/).find(p => p.includes('data-morph-key="post:g5"')), /ch-post-st new"><i class="ch-chan-dot new" aria-hidden="true"><\/i>New reply/, 'g5 keeps its passive words');
  // Kept on this device: a reload (a fresh module) reads the same mark.
  const saved = JSON.parse(f.store.get(READ_KEY));
  assert.equal(saved.at.general, NOW - H);
  const g = fixture({ spacesList: [], marksAt: saved }); g.openChannel(g.w, '__general__');
  assert.doesNotMatch(g.channelFeed(g.w, g.chanOpen(g.w), rows), /ch-chan-new/, 'after a reload too');
});

test('issue 1316: a new post, and separately a reply to an older post, show below the New line on reopen; posting order holds', () => {
  for (const kind of ['new post', 'reply to an older post']) {
    const f = fixture({ spacesList: [], marksAt: readTo(50) }); let rows = generalRows(40);
    f.openChannel(f.w, '__general__'); readToEnd(f, rows); f.channelBack(f.w);
    const order = keysOf(f.channelFeed(f.w, (f.openChannel(f.w, '__general__'), f.chanOpen(f.w)), rows)).filter(k => k !== 'chan-new'); f.channelBack(f.w);
    if (kind === 'new post') rows = rows.concat(row('g40', 0, { owner: 'hermes', startedAt: new Date(NOW).toISOString() }));
    else rows[10].at = NOW + H / 2;                                     // a reply lands on g10: its card time moves, its start does not
    assert.match(generalLine(f, rows), /^ unread"[^]*aria-label="1 unread"/, kind + ': the channel line comes back for it');
    f.openChannel(f.w, '__general__');
    const html = f.channelFeed(f.w, f.chanOpen(f.w), rows), keys = keysOf(html), changed = kind === 'new post' ? 'post:g40' : 'post:g10';
    assert.equal(keys.filter(k => k === 'chan-new').length, 1, kind + ': one New line');
    assert.equal(keys[keys.indexOf('chan-new') + 1], changed, kind + ': directly above the changed post');
    assert.deepEqual(keys.filter(k => k !== 'chan-new' && k !== 'post:g40'), order, kind + ': the feed keeps posting order; the post did not move');
  }
});

test('issue 1316: a partial scroll reads only what passed the view, never a changed post still below it', () => {
  const f = fixture({ spacesList: [], marksAt: readTo(50) }); const rows = generalRows(40);
  f.openChannel(f.w, '__general__'); readToEnd(f, rows); f.channelBack(f.w);
  rows[10].at = NOW + H / 2; rows.push(row('g40', 0, { owner: 'hermes', startedAt: new Date(NOW).toISOString() }));
  f.openChannel(f.w, '__general__');
  const d = feedDom(f.channelFeed(f.w, f.chanOpen(f.w), rows)); f.env.elOf = () => d.el;
  f.chanHold('w');                                                    // the New line is above g10, near the top of the view
  assert.equal(f.chanReadAt('general'), NOW - H, 'opening alone moves nothing');
  f.chanUser('w'); d.sc.scrollTop += 300; f.chanScrolled('w', d.sc);  // g10 read; g40 is far below
  assert.equal(f.chanReadAt('general'), NOW - 1, 'up to just before the unseen new post');
  assert.match(generalLine(f, rows), /aria-label="2 unread"/, 'g40 is still new, and g10 with it: one time per channel never skips a post not yet seen');
  f.chanUser('w'); d.sc.scrollTop = d.sc.scrollHeight - d.sc.clientHeight; f.chanScrolled('w', d.sc);
  assert.equal(f.chanReadAt('general'), NOW + H / 2, 'the end reads the rest');
  assert.doesNotMatch(generalLine(f, rows), / unread"/);
});

test('issue 1316: the watermark only moves forward, is written at most once per ~2 s, and never writes a per-thread seen record', () => {
  const on = {}, f = fixture({ spacesList: longSpaces(40), on }), rows = manyRows(40, 0), timers = [], writes = [];
  f.env.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
  const set = f.env.localStorage.setItem; f.env.localStorage.setItem = (k, v) => { if (k === READ_KEY) writes.push(JSON.parse(v)); return set(k, v); };
  f.openChannel(f.w, 'launch');
  assert.deepEqual(writes.map(w => Object.keys(w.at).length), [], 'nothing yet');
  const html = f.channelFeed(f.w, f.chanOpen(f.w), rows), d = feedDom(html); f.env.elOf = () => d.el;
  assert.equal(writes.length, 1, 'the first look keeps since at once, so it never moves');
  assert.equal(writes[0].since, NOW);
  f.chanHold('w');                                                    // all read: the end, nothing new to read
  for (let i = 0; i < 6; i++) { f.chanUser('w'); d.sc.scrollTop = 200 + i * 300; f.chanScrolled('w', d.sc); }
  assert.equal(writes.length, 1, 'read up to since already: no write');
  rows.push(row('p40', -1, { startedAt: new Date(NOW + H).toISOString() })); f.spacesData[0].threads.push('p40');
  f.channelFeed(f.w, f.chanOpen(f.w), rows);
  const d2 = feedDom(f.channelFeed(f.w, f.chanOpen(f.w), rows)); f.env.elOf = () => d2.el;
  for (let i = 0; i < 5; i++) { f.chanUser('w'); d2.sc.scrollTop = d2.sc.scrollHeight - d2.sc.clientHeight - i * 2; f.chanScrolled('w', d2.sc); }
  const pending = timers.filter(([, ms]) => ms === 2000);
  assert.equal(pending.length, 1, 'many scrolls, one throttled write');
  assert.equal(writes.length, 1, 'not written before the timer');
  pending[0][0]();
  assert.equal(writes.length, 2); assert.equal(writes[1].at['hermes|launch'], NOW + H);
  f.chanUser('w'); d2.sc.scrollTop = 0; f.chanScrolled('w', d2.sc);
  assert.equal(f.chanReadAt('hermes|launch'), NOW + H, 'scrolling back up never moves it back');
  assert.deepEqual(f.marks, [], 'no per-thread seen write from the feed');
  // A pending write is flushed when the page goes (the block's own pagehide listener), not lost with the timer.
  on.pagehide(); assert.equal(writes.length, 2, 'nothing pending: no write');
  rows.push(row('p41', -2, { startedAt: new Date(NOW + 2 * H).toISOString() })); f.spacesData[0].threads.push('p41');
  f.channelFeed(f.w, f.chanOpen(f.w), rows);
  const d3 = feedDom(f.channelFeed(f.w, f.chanOpen(f.w), rows)); f.env.elOf = () => d3.el;
  f.chanUser('w'); d3.sc.scrollTop = d3.sc.scrollHeight - d3.sc.clientHeight; f.chanScrolled('w', d3.sc);
  assert.equal(writes.length, 2, 'throttled: waiting on its timer');
  on.pagehide();
  assert.equal(writes.length, 3, 'a pending write is flushed when the page goes'); assert.equal(writes[2].at['hermes|launch'], NOW + 2 * H);
});

test('issue 1316 review: an agent-focused General has its own mark; reading it never reads All\'s other agents', () => {
  const f = fixture({ spacesList: [], marksAt: readTo(50), agents: { h1: 'host' } });
  const focus = { ag: '' }; f.env.focusAgentId = () => focus.ag;
  const rows = generalRows(10).concat(row('h1', 0, { owner: 'host', agent: 'host', startedAt: new Date(NOW).toISOString() }));
  f.openChannel(f.w, '__general__'); readToEnd(f, rows); f.channelBack(f.w);
  rows[3].at = NOW + H / 4;                                           // a reply on a main-agent post
  rows[10].at = NOW + H / 2;                                          // and a newer one on the host's
  focus.ag = 'host';
  const hostRows = rows.filter(r => r.owner === 'host');              // the focused render path scopes General to the host
  f.openChannel(f.w, '__general__'); readToEnd(f, hostRows); f.channelBack(f.w);
  assert.equal(f.chanReadAt('general|host'), NOW + H / 2, 'the host\'s General is read');
  assert.equal(f.chanReadAt('general'), NOW, 'All\'s General did not move');
  focus.ag = '';
  assert.match(generalLine(f, rows), /aria-label="2 unread"/, 'in All, g3 (main) is still new');
  f.openChannel(f.w, '__general__'); readToEnd(f, rows); f.channelBack(f.w);
  focus.ag = 'host'; assert.equal(f.chanReadAt('general|host'), NOW + H / 2, 'reading All reads each focused General too');
});

// wizard-agent-service issue 471: with Channels on (its own wizard/channel-read-sync switch until wizard-ux issue 1358), the watermark is also kept on the box
// (/wizard/v1/channels/read, forward only), so reading a channel on one device clears it on the owner's others.
// The real LIVE.chanReads (web/live.js channelReads) runs against a fake box shared by two fixtures.
const liveSrc = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const readsBlock = (() => { const a = liveSrc.indexOf('  /* ---- channel reads'), b = liveSrc.indexOf('  /* ---- end channel reads ---- */'); assert.ok(a > 0 && b > a); return liveSrc.slice(a, b); })();
function fakeBox({ on = true } = {}) {
  const box = { at: {}, on, calls: [] };
  box.req = async (url, init = {}) => {
    box.calls.push([init.method || 'GET', url, init.body ? JSON.parse(init.body) : null]);
    if (url !== '/wizard/v1/channels/read' || !box.on) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
    if (box.offline && init.method === 'PUT') { const e = new Error('offline'); e.status = 0; throw e; }
    if (init.method === 'PUT') for (const [k, t] of Object.entries(JSON.parse(init.body).at)) if (!(box.at[k] >= t)) box.at[k] = t;
    return { json: async () => ({ schema: 'wizard.channel-reads/1', at: { ...box.at } }) };
  };
  return box;
}
async function syncDevice(box, opts = {}) {
  const f = fixture({ spacesList: [], marksAt: readTo(50), ...opts });
  const ctx = vm.createContext({}); vm.runInContext(readsBlock + ';this.channelReads=channelReads;', ctx);
  f.env.LIVE.chanReads = ctx.channelReads({ req: box.req, emit() {} });
  f.chanReadAt('general'); await settle(); await settle();       // the first look asks the box
  return f;
}

test('issue 471: reading General to the bottom on the desktop clears it on the phone; forward only', async () => {
  const box = fakeBox(), rows = generalRows(20);
  const desktop = await syncDevice(box), phone = await syncDevice(box);
  assert.match(generalLine(phone, rows), /aria-label="20 unread"/, 'the phone starts with everything new');
  desktop.openChannel(desktop.w, '__general__'); readToEnd(desktop, rows); desktop.channelBack(desktop.w);
  await settle();
  assert.equal(box.at.general, NOW - H, 'the desktop wrote its mark to the box');
  phone.env.LIVE.chanReads.fresh(); phone.chanReadAt('general'); await settle(); await settle();   // the next sync read
  assert.doesNotMatch(generalLine(phone, rows), / unread"/, 'the phone shows General read');
  phone.openChannel(phone.w, '__general__');
  assert.doesNotMatch(phone.channelFeed(phone.w, phone.chanOpen(phone.w), rows), /ch-chan-new/, 'and opens it at the bottom, no New line');
  assert.deepEqual({ ...phone.w.chan.at }, { end: true });
  // A device that read less never moves the box back; a later post still comes back as new on both.
  phone.chanReadTo('general', NOW - 5 * H); await settle();
  assert.equal(box.at.general, NOW - H);
  rows.push(row('g20', 0, { owner: 'hermes', startedAt: new Date(NOW).toISOString() }));
  assert.match(generalLine(phone, rows), /aria-label="1 unread"/);
  assert.match(generalLine(desktop, rows), /aria-label="1 unread"/);
});

test('issue 471: a box without the read sync (404): each device keeps its own mark and nothing is sent', async () => {
  const rows = generalRows(10);
  const old = fakeBox({ on: false }), a = await syncDevice(old);
  assert.equal(a.env.LIVE.chanReads.off, true);
  a.openChannel(a.w, '__general__'); readToEnd(a, rows); await settle();
  assert.deepEqual(old.calls.map(c => c[0]), ['GET'], 'after the 404 no write is tried');
  assert.equal(a.chanReadAt('general'), NOW - H, 'the device\'s own mark still works');
  assert.equal(JSON.parse(a.store.get(READ_KEY)).at.general, NOW - H);
});

test('issue 471: main, host-profile, container and restricted channels each sync under their own agent key', async () => {
  const box = fakeBox(), desktop = await syncDevice(box), phone = await syncDevice(box);
  const chans = [{ id: 'launch', agent: 'hermes' }, { id: 'host-ops', agent: 'host' }, { id: 'box', agent: 'container' }, { id: 'locked', agent: 'restricted' }];
  chans.forEach((c, i) => desktop.chanReadTo(desktop.chanReadKey(c), NOW - (10 - i) * H));
  desktop.chanReadTo(desktop.chanReadKey({ general: true }, 'host'), NOW - 2 * H);
  await settle();
  assert.deepEqual(Object.keys(box.at).sort(), ['container|box', 'general|host', 'hermes|launch', 'host|host-ops', 'restricted|locked']);
  phone.env.LIVE.chanReads.fresh(); phone.chanReadAt('general'); await settle(); await settle();
  chans.forEach((c, i) => assert.equal(phone.chanReadAt(phone.chanReadKey(c)), NOW - (10 - i) * H, c.agent + ': the phone reads the desktop\'s mark'));
  assert.equal(phone.chanReadAt('general|host'), NOW - 2 * H, 'a focused General keeps its own agent');
  assert.equal(phone.chanReadAt('general|restricted'), NOW - 50 * H, 'another agent\'s General is not read by it');
});

test('issue 471: marks read on a device before the switch go to the box once, the first time it answers', async () => {
  const box = fakeBox(); box.at['hermes|launch'] = NOW - 3 * H;
  const marks = { since: NOW - 50 * H, at: { general: NOW - 2 * H, 'hermes|launch': NOW - 4 * H } };
  const f = await syncDevice(box, { marksAt: marks });
  f.chanReadAt('general'); await settle();
  assert.deepEqual(box.at, { general: NOW - 2 * H, 'hermes|launch': NOW - 3 * H }, 'only the mark ahead of the box went up; the box kept its newer one');
  assert.equal(box.calls.filter(c => c[0] === 'PUT').length, 1, 'once');
  assert.equal(f.chanReadAt('hermes|launch'), NOW - 3 * H, 'the device reads the newer of its own and the box\'s');
});

test('issue 471 review: a mark whose write failed, or one read before the box kept marks, still reaches the box later', async () => {
  const box = fakeBox(), rows = generalRows(10), f = await syncDevice(box);
  box.offline = true;
  f.openChannel(f.w, '__general__'); readToEnd(f, rows); await settle();
  assert.equal(box.at.general, undefined, 'the write failed');
  box.offline = false; f.env._now = NOW + 31e3; f.env.LIVE.chanReads.fresh();
  f.chanReadAt('general'); await settle(); await settle(); f.chanReadAt('general'); await settle();
  assert.equal(box.at.general, NOW - H, 'sent again once the box answers');
  const puts = box.calls.filter(c => c[0] === 'PUT').length;
  f.env._now = NOW + 62e3; f.chanReadAt('general'); await settle();
  assert.equal(box.calls.filter(c => c[0] === 'PUT').length, puts, 'nothing more once the box has it');
  // Read while the box had no read sync yet (Channels just turned on, the service not caught up), then it answers:
  // the mark goes up.
  const box2 = fakeBox({ on: false }), g = await syncDevice(box2);
  g.openChannel(g.w, '__general__'); readToEnd(g, rows); await settle();
  assert.deepEqual(box2.calls.map(c => c[0]), ['GET'], 'the box said 404: nothing sent');
  box2.on = true; g.env.LIVE.chanReads.fresh();
  g.chanReadAt('general'); await settle(); await settle(); g.chanReadAt('general'); await settle();
  assert.equal(box2.at.general, NOW - H);
});

// wizard-ux issue 1317: Mark done (switch wizard/mark-done, with Channels on) in the post and row menu clears a thread's
// amber Needs you and green New reply in the feed, Activity and the channel row, never archives or moves it, and a
// later reply brings the markers back. The chats side here; the synced seen record (web/live.js) below.
const MD_ON = 'wizard/desktop-chats'; // Mark done comes with Channels, on for everyone (issues 1358, 1258)
const realAttOf = src.match(/\n  const attOf = (s => [^\n]+);\n/)[1];
function doneFixture(opts = {}) {
  const f = fixture({ marksAt: readTo(2.5), ...opts });
  f.env.document.documentElement.dataset.tweaks = MD_ON;
  vm.runInContext('attOf = ' + realAttOf, f.env); // the real status read, so Activity's \"Needs you:\" follows it too
  const handled = new Map(), key = s => (f.env.LIVE.ownerOf(s) || 'hermes') + '|' + s.id;
  // The seen layer's two calls (their real code is tested below): handled through the reply the row shows.
  Object.assign(f.env.LIVE, {
    markHandled: s => { handled.set(key(s), s.lastAssistantAt); s.fresh = false; return Promise.resolve(true); },
    handled: s => handled.has(key(s)) && Date.parse(s.lastAssistantAt) <= Date.parse(handled.get(key(s))),
  });
  f.env.paintListsNow = () => f.renders.push('paint');
  f.markDone = (wid, sid) => vm.runInContext('markDone', f.env)(wid, sid);
  f.canMarkDone = s => vm.runInContext('canMarkDone', f.env)(s);
  f.attOf = s => vm.runInContext('attOf', f.env)(s);
  return f;
}
const lineOf = (f, rows, id) => f.channelsBody(f.w, rows).split(/<div class="ch-chan(?=[ "])/).slice(1).find(c => c.includes(`data-chchan="${id}"`));

test('issue 1317: Mark done is offered on a settled thread not already handled', async () => {
  const s = row('b', 2, { fresh: true, attention: { state: 'needs_you', ask: 'Pick one' }, lastAssistantAt: new Date(NOW - 2 * H).toISOString() });
  const f = doneFixture({ sessions: { b: s } });
  assert.equal(f.canMarkDone(s), true, 'Mark done is always offered (issue 1358: no wizard/mark-done switch; issue 1258: no Channels switch)');
  assert.equal(f.canMarkDone({ ...s, status: 'running' }), false, 'a working thread');
  assert.equal(f.canMarkDone({ ...s, archived: true }), false, 'an archived thread');
  // The menus: Chats' row sheet (feed posts and Activity rows) and the AI apps sidebar's Activity rows.
  // The real row sheet offers it on a thread row (never on a notification row) as canMarkDone says.
  const rs = rowSheet({ rows: { t1: s } }); rs.ctx.canMarkDone = f.canMarkDone;
  assert.ok(rs.open('t1').includes('data-rsmarkdone'), 'the row sheet offers Mark done');
  assert.ok(!rs.open('t1', 'n1').includes('data-rsmarkdone'), 'not on a notification row');
  rs.ctx.canMarkDone = () => false; assert.ok(!rs.open('t1').includes('data-rsmarkdone'));
  // Its tap (the real click handler) closes the sheet and marks that thread done.
  const md = bindClick({ chatVars: { rowSheet: { wid: 'w1', sid: 'b' } } });
  assert.equal(md.click(tap({ '[data-rsmarkdone]': {} }), 'w1'), true);
  assert.deepEqual(plain(md.calls.filter(c => ['closeRowSheet', 'markDone'].includes(c[0]))), [['closeRowSheet'], ['markDone', 'w1', 'b']]);
  // The layouts' sessionAct reaches it through the real threadAct.
  const ta = runRecording(`${fnBlock(src, '  async function threadAct(wid, sid, a) {')}\nthis.act = threadAct;`, { W: { w1: { id: 'w1', thread: null } }, owner: id => id, rowOf: () => ({ id: 'b' }), window: {}, Promise, Date, Object });
  await ta.act('w1', 'b', 'markdone');
  assert.deepEqual(plain(ta.calls.filter(c => c[0] === 'markDone')), [['markDone', 'w1', 'b']], 'the layouts\' sessionAct reaches it through threadAct');
  // The AI apps sidebar's rows (the real list model's sessionRow) carry it as an action.
  const acts = x => f.env.WizChatsListModel.sessionRow(x, 'ready', { live: {}, chats: { canMarkDone: f.canMarkDone, threadActions: () => [] } }).actions;
  assert.ok(acts(s).includes('markdone')); assert.ok(!acts({ ...s, archived: true }).includes('markdone'));
});

test('issue 1317: Mark done clears amber and green in the feed, Activity and the channel row; a new reply brings them back (main and routed)', async () => {
  for (const [kind, agent] of [['main', ''], ['host-profile', 'host'], ['container', 'container'], ['restricted', 'restricted']]) {
    const cid = agent ? { host: 'host-ops', container: 'box', restricted: 'locked' }[agent] : 'launch', sid = agent ? { host: 'h1', container: 'k1', restricted: 'r1' }[agent] : 'b';
    const own = agent ? { owner: agent } : {};
    const s = row(sid, 2, { ...own, fresh: true, messageCount: 2, attention: { state: 'needs_you', ask: 'Pick one' }, lastAssistantAt: new Date(NOW - 2 * H).toISOString() });
    const other = row('a', 3, { messageCount: 2, lastAssistantAt: new Date(NOW - 3 * H).toISOString() });
    const rows = [s, other];
    const f = doneFixture({ history: { [(agent ? agent + '|' : '') + sid]: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'pick', at: NOW - 2 * H }] } });
    f.env._rowOf = (wid, id) => id === sid ? s : null;
    // Before: amber + green on the channel line, the post and the Activity status.
    assert.match(lineOf(f, rows, cid), /^ unread"[^]*aria-label="Needs you"><\/i><i class="ch-chan-dot new" role="img" aria-label="1 unread">/, kind);
    f.openChannel(f.w, cid);
    f.channelFeed(f.w, f.chanOpen(f.w), rows); await settle();
    let feed = f.channelFeed(f.w, f.chanOpen(f.w), rows);
    assert.match(feed, /Needs you<\/span><span class="ch-post-st new">/, kind + ': the post shows both');
    assert.equal(f.attOf(s)?.state, 'needs_you');
    // Mark done.
    assert.equal(f.markDone('w', sid), true, kind);
    assert.deepEqual(f.toasts.at(-1), 'Cleared');
    assert.equal(s.archived, undefined, kind + ': never archived'); assert.deepEqual(f.ops, [], kind + ': never moved');
    feed = f.channelFeed(f.w, f.chanOpen(f.w), rows);
    assert.doesNotMatch(feed, /Needs you<\/span>|ch-post-st new|new repl/, kind + ': the feed post is clear');
    assert.equal(f.attOf(s), null, kind + ': Activity\'s Needs you status is clear too');
    f.channelBack(f.w); f.w.focus = null;
    assert.doesNotMatch(lineOf(f, rows, cid), /^ unread"|ch-chan-ind/, kind + ': the channel line is clear');
    assert.equal(f.canMarkDone(s), false, kind + ': nothing left to clear');
    // Mark unread after Mark done: green is back, and Mark done is offered again to clear it (Codex P2).
    s.fresh = true; assert.equal(f.canMarkDone(s), true, kind + ': offered again after Mark unread');
    assert.equal(f.markDone('w', sid), true); assert.equal(s.fresh, false, kind + ': and it reads the thread');
    // A later reply: green and amber come back as normal.
    Object.assign(s, { fresh: true, at: NOW - 0.5 * H, lastAssistantAt: new Date(NOW - 0.5 * H).toISOString() });
    assert.match(lineOf(f, rows, cid), /^ unread"[^]*aria-label="Needs you"><\/i><i class="ch-chan-dot new" role="img" aria-label="1 unread">/, kind + ': back after a new reply');
    assert.equal(f.attOf(s)?.state, 'needs_you', kind);
  }
});

test('issue 1317: an approval gate is not a marker; it stays amber after Mark done', () => {
  const s = row('b', 2, { fresh: true, status: 'waiting_for_approval', lastAssistantAt: new Date(NOW - 2 * H).toISOString() });
  const f = doneFixture({ sessions: { b: s } });
  // Mark done reads it (no green), but the approval still waits on the owner.
  f.markDone('w', 'b');
  assert.match(lineOf(f, [s], 'launch'), /aria-label="Needs you"/);
});

test('issue 1317: Mark channel read moves the channel\'s read point to now and clears its green words, not amber', () => {
  const b = row('b', 2, { fresh: true, attention: { state: 'needs_you', ask: 'Pick' }, lastAssistantAt: new Date(NOW - 2 * H).toISOString() });
  const c = row('c', 1, { fresh: true, lastAssistantAt: new Date(NOW - H).toISOString() }), d = row('d', 1, { fresh: true });
  const rows = [b, c, d];
  const f = doneFixture();
  f.env.LIVE.sessionsFor = () => rows;
  f.openChannelSheet('w', 'launch');
  assert.match(f.sheets.at(-1), /data-rschread>[^]*Mark channel read<\/button>/);
  assert.equal(f.channelClick(click({ 'data-rschread': '' }), 'w', f.w), true);
  assert.deepEqual([...f.marks].sort(), ['b', 'c'], 'only Launch\'s unread posts are marked read (d is in Voice)');
  assert.equal(f.chanReadAt(f.chanReadKey({ id: 'launch', agent: 'hermes' })), NOW);
  const launch = lineOf(f, rows, 'launch');
  assert.doesNotMatch(launch, /^ unread"|ch-chan-dot new/, 'no green');
  assert.match(launch, /aria-label="Needs you"/, 'amber is cleared only per thread');
});

// The synced half: the real seen record writer in web/live.js (LIVE.markHandled / LIVE.handled).
const liveCut = (a, b) => { const i = liveSrc.indexOf(a); assert.ok(i >= 0, a); const j = liveSrc.indexOf(b, i); assert.ok(j > i, b); return liveSrc.slice(i, j); };
function seenHarness({ put = async s => s } = {}) {
  const store = new Map(), puts = [];
  const ctx = {
    otherAgent: id => !!id && id !== 'hermes', MAX: 500, READY_OR_ATTENTION: new Set(['completed', 'failed', 'interrupted', 'waiting_for_approval', 'unknown']),
    SEEN_BASE: 'wos.seen', SEEN_KEY: 'wos.seen:t', localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    putSeen: s => { puts.push(JSON.parse(JSON.stringify(s))); return put(s); },
  };
  vm.createContext(ctx);
  vm.runInContext(liveCut('  /* ---- thread-seen', '  /* ---- network') + `;this.L={ seen: null, emit() {}, rows: {}, session(id) { return this.rows[id] || null; },
${liveCut('    markSeen(ids) {', '    async markUnread(ids) {')}
};this.api={hasNew,merge,readLocal};`, ctx);
  return { ...ctx.api, L: ctx.L, puts, store };
}
const T0 = Date.UTC(2026, 10, 12, 4);
const seenRow = (n, extra = {}) => ({ id: 'plan', runtime: 'direct', status: 'completed', messageCount: n, updatedAt: new Date(T0 + n * 1000).toISOString(), lastAssistantAt: new Date(T0 + n * 1000).toISOString(), preview: 'reply ' + n, attention: { state: 'needs_you', ask: 'Pick' }, ...extra });

test('issue 1317: LIVE.markHandled reads the thread and keeps what it was handled through, also when the box drops the field', async () => {
  // Today's box keeps only the fields it knows (wizard-agent-service thread-seen validRecord): it echoes the record
  // without handledThrough. This device still keeps it, and a box that keeps it shares it.
  const strip = async s => ({ ...s, threads: Object.fromEntries(Object.entries(s.threads).map(([k, { handledThrough, ...r }]) => [k, r])) });
  const h = seenHarness({ put: strip }), r = seenRow(4);
  assert.equal(h.L.handled(r), false); assert.equal(h.hasNew(r, h.L.seen || { initializedAt: 0, threads: {} }), true);
  assert.equal(await h.L.markHandled(r), true);
  assert.equal(h.L.handled(r), true, 'handled'); assert.equal(h.hasNew(r, h.L.seen), false, 'and read (no green)');
  assert.equal(h.L.handled(r), true, 'kept after the box\'s echo');
  assert.equal(h.puts.at(-1).threads['direct:plan'].handledThrough, r.lastAssistantAt, 'sent to the box with the record');
  assert.equal(h.hasNew(r, h.readLocal()), false);
  h.L.seen = h.merge(h.readLocal(), await strip(h.L.seen)); // a later list poll
  assert.equal(h.L.handled(r), true, 'a poll from the box does not forget it');
  // A later reply: unread and not handled again.
  const r5 = seenRow(5);
  assert.equal(h.L.handled(r5), false); assert.equal(h.hasNew(r5, h.L.seen), true);
  // A stale row (an older list read) never moves the mark back.
  await h.L.markHandled(r5); await h.L.markHandled(seenRow(3));
  assert.equal(h.L.handled(r5), true);
  // A failed write keeps the mark on this device.
  const off = seenHarness({ put: async () => { throw new Error('offline'); } });
  assert.equal(await off.L.markHandled(r), false); assert.equal(off.L.handled(r), true);
});

test('issue 1317: a second device gets the handled mark through the seen record; routed rows keep their own', async () => {
  const box = { state: null };
  const keep = async s => { box.state = box.state ? a.merge(box.state, s) : s; return box.state; };
  const a = seenHarness({ put: keep }), b = seenHarness({ put: keep });
  for (const agent of ['', 'host', 'container', 'restricted']) {
    const r = seenRow(4, agent ? { agent } : {}), main = seenRow(4);
    await a.L.markHandled(r);
    b.L.seen = b.merge(b.L.seen, box.state); // the other device's next list poll
    assert.equal(b.L.handled(r), true, (agent || 'main') + ': handled on the other device');
    assert.equal(b.hasNew(r, b.L.seen), false);
    if (agent) assert.equal(b.L.handled(main), false, agent + ': the main thread sharing its id is untouched');
    box.state = null; a.L.seen = null; b.L.seen = null; a.store.clear(); b.store.clear();
  }
});

// wizard-ux issue 1331: Needs you in the thread (switch wizard/needs-you-in-thread, with Channels on). The agent's reply
// whose status line said needs_you gets the feed's amber Needs you line above its bubble, with Mark done beside it. It
// clears on Mark done, on Reply to that message, or when the agent's next status line drops the ask; a plain owner
// message never clears it. One marker state (attOf), so the thread, feed, Activity and channel line agree.
const NT_ON = 'wizard/desktop-chats'; // Needs you in the thread comes with Channels, on for everyone (issues 1358, 1258)
function needsFixture(opts = {}) {
  const f = doneFixture(opts);
  f.env.document.documentElement.dataset.tweaks = NT_ON;
  const fn = name => vm.runInContext(name, f.env);
  Object.assign(f, { line: s => fn('needsLineHtml')(s), mark: (sid, s, turns) => fn('needsMark')('w', sid, s, turns), replied: (sid, reply) => fn('needsReplied')('w', sid, reply),
    land: (w, nav) => fn('needsLand')(w, nav), replyStd: a => fn('replyStd')(a) });
  return f;
}
const askRow = (sid, extra = {}) => row(sid, 2, { fresh: true, messageCount: 4, attention: { state: 'needs_you', ask: 'Pick the boot logo' }, lastAssistantAt: new Date(NOW - 2 * H).toISOString(), ...extra });
const turnsOf = (...ats) => ats.map(([who, at]) => who === 'u' ? { u: { text: 'q', at }, a: null } : { u: null, a: { text: 'a', at } });
const KINDS_1331 = [['main', '', 'launch', 'b'], ['host-profile', 'host', 'host-ops', 'h1'], ['container', 'container', 'box', 'k1'], ['restricted', 'restricted', 'locked', 'r1']];

test('issue 1331: the Needs you line shows on an open ask, and brings Mark done with it', () => {
  const s = askRow('b'), f = needsFixture({ sessions: { b: s } });
  const html = f.line(s);
  assert.match(html, /^<div class="ch-needs-line" data-needs-line role="status"><span class="ch-post-st needs"><i class="ch-chan-dot" aria-hidden="true"><\/i>Needs you<\/span><span class="ch-needs-ask">Pick the boot logo<\/span><button type="button" class="ch-needs-done" data-chmarkdone><svg[^]*<\/svg>Mark done<\/button><\/div>$/);
  assert.equal(f.canMarkDone(s), true, 'Mark done is in the menus too (issue 1358)');
  assert.match(f.line({ ...s, attention: { state: 'check', ask: 'See it' } }), />Your call<\/span>/, 'Your call waits on the owner too (issue 1360), in its own words');
  assert.equal(f.line({ ...s, attention: { state: 'fyi', ask: 'See it' } }), '', 'FYI never waits on the owner');
  assert.equal(f.line({ ...s, attention: null }), '', 'no ask: nothing');
  assert.equal(f.line({ ...s, archived: true }), '', 'an archived thread');
  assert.match(f.line({ ...s, status: 'running' }), /Needs you/, 'the agent working on a plain owner message keeps it');
  assert.match(f.line({ ...s, attention: { state: 'needs_you', ask: '<b>x</b>' } }), /&lt;b>x&lt;\/b>/, 'the ask is text');
});

test('issue 1331: the line sits on the agent\'s newest reply; Mark done there clears it in the thread, feed, Activity and channel line (main and routed)', async () => {
  for (const [kind, agent, cid, sid] of KINDS_1331) {
    const s = askRow(sid, agent ? { owner: agent } : {}), rows = [s, row('a', 3, { messageCount: 2 })];
    const f = needsFixture({ history: { [(agent ? agent + '|' : '') + sid]: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'pick', at: NOW - 2 * H }] } });
    f.env._rowOf = (wid, id) => id === sid ? s : null;
    const turns = turnsOf(['u', 1], ['a', 2], ['u', 3], ['a', 4], ['u', 5]); // an owner message after it: still that reply
    let m = f.mark(sid, s, turns);
    assert.equal(m.k, 3, kind + ': the newest agent reply'); assert.match(m.html, /Pick the boot logo/);
    assert.equal(f.env._c.w.needsAt, 4); assert.equal(f.env._c.w.needsFor, sid);
    f.openChannel(f.w, cid); f.channelFeed(f.w, f.chanOpen(f.w), rows); await settle();
    assert.match(f.channelFeed(f.w, f.chanOpen(f.w), rows), /ch-post-st needs/, kind + ': the post is amber too');
    // The thread's own Mark done (also while the agent works on a plain owner message).
    s.status = 'running';
    assert.equal(vm.runInContext('markDone', f.env)('w', sid, true), true, kind);
    s.status = 'completed';
    m = f.mark(sid, s, turns);
    assert.equal(m.k, -1, kind + ': the line is gone'); assert.equal(f.env._c.w.needsFor, '');
    assert.equal(f.attOf(s), null, kind + ': Activity\'s Needs you is clear');
    assert.doesNotMatch(f.channelFeed(f.w, f.chanOpen(f.w), rows), /ch-post-st needs/, kind + ': the feed post is clear');
    f.channelBack(f.w); f.w.focus = null;
    assert.doesNotMatch(lineOf(f, rows, cid), /aria-label="Needs you"/, kind + ': the channel line is clear');
    assert.equal(s.archived, undefined, kind + ': never archived'); assert.deepEqual(f.ops, [], kind + ': never moved');
  }
});

test('issue 1331: Mark done (and Reply) repaints the open thread on the tap, so its line and Mark done buttons go at once', () => {
  // AI review of 1331: the toast showed and the lists cleared, but the open thread kept the amber line and both Mark
  // done buttons until a reopen. Every window showing that thread repaints in the same tap, already reading handled.
  for (const [kind, agent, , sid] of KINDS_1331) {
    const s = askRow(sid, agent ? { owner: agent } : {}), f = needsFixture();
    f.env._rowOf = (wid, id) => id === sid ? s : null;
    const turns = turnsOf(['u', 1], ['a', 4000]), painted = [];
    f.env.CH = { w: {}, other: {} }; f.w.thread = sid;
    f.env.renderThreadNow = x => painted.push([x.id, f.mark(sid, s, turns).html, !!(vm.runInContext('needsAsk', f.env)(s) && vm.runInContext('canMarkDone', f.env)(s))]);
    f.mark(sid, s, turns);
    assert.equal(vm.runInContext('markDone', f.env)('w', sid, true), true, kind);
    assert.deepEqual(painted, [['w', '', false]], kind + ': the open thread repainted, with no line and no Mark done button');
    // Reply on that message: the same repaint.
    Object.assign(s, { lastAssistantAt: new Date(NOW - H).toISOString() }); painted.length = 0;
    assert.match(f.mark(sid, s, turns).html, /Needs you/, kind + ': a new ask');
    assert.equal(f.replied(sid, { quote: { role: 'assistant', at: 4000 } }), true, kind);
    assert.deepEqual(painted.map(p => p.slice(0, 2)), [['w', '']], kind + ': Reply repaints it too');
    // Another thread in the window: nothing to repaint.
    painted.length = 0; f.w.thread = 'zz'; Object.assign(s, { lastAssistantAt: new Date(NOW - 0.5 * H).toISOString() });
    vm.runInContext('markDone', f.env)('w', sid, true); assert.deepEqual(painted, [], kind + ': a window on another thread stays');
    // Codex P2: another window on the same id but another agent's row (a routed thread) is left alone.
    const other = { id: 'other', thread: sid }, wins = { w: f.w, other }, alt = { ...s };
    f.env.W = new Proxy({}, { get: (_, id) => wins[id] }); f.w.thread = sid; painted.length = 0;
    f.env._rowOf = (wid, id) => id === sid ? (wid === 'other' ? alt : s) : null;
    Object.assign(s, { lastAssistantAt: new Date(NOW - 0.25 * H).toISOString() });
    vm.runInContext('markDone', f.env)('w', sid, true);
    assert.deepEqual(painted.map(p => p[0]), ['w'], kind + ': only the window showing that row');
    f.env._rowOf = (wid, id) => id === sid ? s : null; painted.length = 0;
    Object.assign(s, { lastAssistantAt: new Date(NOW - 0.2 * H).toISOString() });
    vm.runInContext('markDone', f.env)('w', sid, true);
    assert.deepEqual(painted.map(p => p[0]), ['w', 'other'], kind + ': a second window on the same row repaints too');
    f.w.thread = null;
  }
});

test('issue 1331: Reply on the Needs you message clears it; a plain owner message or a reply to another message does not', () => {
  for (const [kind, agent, , sid] of KINDS_1331) {
    const s = askRow(sid, agent ? { owner: agent } : {}), f = needsFixture();
    f.env._rowOf = (wid, id) => id === sid ? s : null;
    const turns = turnsOf(['u', 1], ['a', 2], ['u', 3], ['a', 4000]);
    f.mark(sid, s, turns);
    assert.equal(f.replied(sid, null), false, kind + ': a plain owner message');
    assert.equal(f.replied(sid, { key: 'n', title: 'Notifications' }), false, kind + ': an app item reply');
    assert.equal(f.replied(sid, { quote: { role: 'assistant', at: 2 } }), false, kind + ': a reply to an older agent message');
    assert.equal(f.replied(sid, { quote: { role: 'user', at: 4000 } }), false, kind + ': a reply to the owner\'s own message');
    assert.equal(f.replied('other', { quote: { role: 'assistant', at: 4000 } }), false, kind + ': another thread');
    assert.match(f.mark(sid, s, turns).html, /Needs you/, kind + ': still there after all of those');
    assert.equal(f.replied(sid, { quote: { role: 'assistant', at: 4000, message_id: '9' } }), true, kind + ': Reply on that message');
    assert.equal(f.mark(sid, s, turns).html, '', kind + ': cleared'); assert.equal(f.attOf(s), null);
    assert.equal(f.replied(sid, { quote: { role: 'assistant', at: 4000 } }), false, kind + ': nothing left to clear');
  }
});

// wizard-ux issue 1360: Your call (check) waits on the owner like Needs you, so the thread carries the same amber line
// (worded Your call) and Reply on that message, or Mark done, clears it (Codex P2 on PR 1369).
test('issue 1360: a Your call thread shows the line, and Reply on it or Mark done clears it (main and routed)', () => {
  for (const [kind, agent, , sid] of KINDS_1331) {
    const own = agent ? { owner: agent } : {}, turns = turnsOf(['u', 1], ['a', 4000]);
    let s = askRow(sid, { ...own, attention: { state: 'check', ask: 'Try it and say what to tweak' } }), f = needsFixture();
    f.env._rowOf = (wid, id) => id === sid ? s : null;
    assert.match(f.mark(sid, s, turns).html, /<span class="ch-post-st needs"><i class="ch-chan-dot" aria-hidden="true"><\/i>Your call<\/span><span class="ch-needs-ask">Try it and say what to tweak<\/span>/, kind);
    assert.equal(f.replied(sid, null), false, kind + ': a plain owner message never clears it');
    assert.equal(f.replied(sid, { quote: { role: 'assistant', at: 4000 } }), true, kind + ': Reply on that message');
    assert.equal(f.mark(sid, s, turns).html, '', kind + ': cleared'); assert.equal(f.attOf(s), null, kind + ': Activity too');
    s = askRow(sid, { ...own, attention: { state: 'check', ask: 'Try it' } }); f = needsFixture();
    f.env._rowOf = (wid, id) => id === sid ? s : null; f.mark(sid, s, turns);
    assert.equal(f.markDone('w', sid), true, kind + ': Mark done'); assert.equal(f.attOf(s), null, kind + ': Mark done cleared it');
  }
});

test('issue 1331: the agent\'s next status line that drops the ask clears it; one that asks again brings it back', () => {
  for (const [kind, agent, , sid] of KINDS_1331) {
    const s = askRow(sid, agent ? { owner: agent } : {}), f = needsFixture();
    f.env._rowOf = (wid, id) => id === sid ? s : null;
    assert.match(f.line(s), /Needs you/);
    // The owner's message resolved it: the agent's next reply's status line no longer lists it.
    Object.assign(s, { attention: { state: 'done', ask: 'Logo shipped' }, lastAssistantAt: new Date(NOW - H).toISOString() });
    assert.equal(f.line(s), '', kind + ': dropped by the agent'); assert.equal(f.mark(sid, s, turnsOf(['a', 1], ['a', 2])).k, -1);
    // After a Mark done, a later reply that asks again is a new Needs you.
    Object.assign(s, { attention: { state: 'needs_you', ask: 'Which size?' } });
    vm.runInContext('markDone', f.env)('w', sid, true); assert.equal(f.line(s), '', kind);
    s.lastAssistantAt = new Date(NOW - 0.5 * H).toISOString();
    assert.match(f.line(s), /Which size\?/, kind + ': back after a new reply that asks');
  }
});

test('issue 1331: opening a thread with an open Needs you lands on that message once per open', async () => {
  const s = askRow('b'), f = needsFixture();
  // A phone: the document scrolls and the thread's header (56px) is fixed over it. The line starts 900px down.
  const doc = { scrollTop: 0, scrollTo(o) { scrolled.push(o); this.scrollTop = o.top; } };
  const head = { getBoundingClientRect: () => ({ bottom: 56 }) }, thread = { querySelector: q => q === '.ch-head' ? head : null };
  const nb = { getBoundingClientRect: () => ({ top: 56 - doc.scrollTop }), closest: q => q === '.ch-thread' ? thread : null };
  const scrolled = [], line = { isConnected: true, getBoundingClientRect: () => ({ top: 900 - doc.scrollTop }), closest: q => q === '.ch-msgs' ? nb : q === '.ch-thread' ? thread : null, scrollIntoView: o => scrolled.push(o) };
  f.env.requestAnimationFrame = fn => fn();
  f.env.scrollBox = () => doc; f.env.threadViewportTop = (_, base) => base;
  f.env.elOf = () => ({ querySelector: q => q === '.ch-msgs [data-needs-line]' ? line : null });
  const w = { id: 'w', thread: 'b' }; f.env._c.w = { readNav: 3 };
  f.mark('b', s, turnsOf(['u', 1], ['a', 2]));
  f.land(w, 3); f.land(w, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(scrolled)), [{ top: 836, behavior: 'auto' }], 'once, the amber line just under the header');
  assert.equal(line.getBoundingClientRect().top, 64, 'AI review of 1331: the line is on screen, 8px under the fixed header, not hidden above it');
  doc.scrollTop = 0; f.env._c.w.readNav = 4; f.land(w, 4); assert.equal(scrolled.length, 2, 'again on the next open');
  // Desktop: the messages box scrolls itself; the line lands 8px under the box's top, so the whole ask shows.
  const box = { scrollTop: 0, scrollTo(o) { scrolled.push(o); this.scrollTop = o.top; }, getBoundingClientRect: () => ({ top: 120 }), closest: nb.closest };
  const head2 = { getBoundingClientRect: () => ({ bottom: 131 }) }; thread.querySelector = q => q === '.ch-head' ? head2 : null;
  line.closest = q => q === '.ch-msgs' ? box : q === '.ch-thread' ? thread : null; line.getBoundingClientRect = () => ({ top: 700 - box.scrollTop });
  f.env.scrollBox = n => n; f.env._c.w.readNav = 6; f.land(w, 6);
  assert.equal(line.getBoundingClientRect().top, 139, 'under whichever is lower: the box top or the header (it overlapped by 11px)');
  // Both opens call it: a fresh history read and a reopen inside the 60-second history cache (Codex P2).
  const outboxSrc = readFileSync(new URL('../web/core/chats-outbox.js', import.meta.url), 'utf8'); // loadThread lives in core/chats-outbox.js (issue 1665)
  // The real loadThread: a fresh read lands, then a reopen served from the 60-second cache lands too.
  const lw = { id: 'w9', thread: 't1' }, lc = { readNav: 1 }, landed = [];
  const lt = runRecording(`${fnBlock(outboxSrc, '  async function loadThread(w, force) {')}\nthis.load = loadThread;`, {
    INC: null, ch: () => lc, CH: { w9: lc }, W: { w9: lw }, Date, JSON, Number, Object, Promise, globalThis: {},
    LIVE: { session: () => ({ id: 't1', status: 'completed', messageCount: 2 }), busy: () => false, messages: async () => [] },
    toTurns: () => [], turnsCurrent: () => true, isWorking: () => false, pendingFor: () => [], retireLanded: () => false, loadApproval: async () => false,
    needsLand: (w, nav) => landed.push([w.id, nav]) });
  await lt.load(lw); assert.deepEqual(landed, [['w9', 1]], 'a fresh history read lands');
  assert.equal(lc.loadedFor, 't1');
  lc.readNav = 2; await lt.load(lw);
  assert.deepEqual(landed, [['w9', 1], ['w9', 2]], 'a reopen inside the history cache lands too (no second read)');
});

test('issue 1331: the landing becomes the reading place for main and routed threads alike (second AI review)', () => {
  // chat-power's opening settle restored the saved spot over the landing. needsLand now hands the placed line to
  // PW.landAt for the window showing the thread, whichever agent owns its row (tests/needs-you-landing.test.mjs runs
  // landAt itself through the real settle).
  for (const [kind, agent, , sid] of KINDS_1331) {
    const s = askRow(sid, agent ? { owner: agent } : {}), f = needsFixture(), lands = [];
    f.env._rowOf = (wid, id) => id === sid ? s : null;
    const doc = { scrollTop: 0, scrollTo(o) { this.scrollTop = o.top; } }, thread = { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 56 }) }) };
    const nb = { getBoundingClientRect: () => ({ top: 56 - doc.scrollTop }), closest: q => q === '.ch-thread' ? thread : null };
    const line = { isConnected: true, getBoundingClientRect: () => ({ top: 900 - doc.scrollTop }), closest: q => q === '.ch-msgs' ? nb : q === '.ch-thread' ? thread : null };
    Object.assign(f.env, { requestAnimationFrame: fn => fn(), scrollBox: () => doc, threadViewportTop: (_, base) => base, PW: { landAt: (wid, n) => { lands.push([wid, n === line]); return true; } },
      elOf: () => ({ querySelector: q => q === '.ch-msgs [data-needs-line]' ? line : null }) });
    const w = { id: 'w', thread: sid }; f.env._c.w = { readNav: 7 };
    f.mark(sid, s, turnsOf(['u', 1], ['a', 2]));
    f.land(w, 7);
    assert.deepEqual(lands[0], ['w', true], kind + ': the landed line is handed to the reading place');
    assert.equal(line.getBoundingClientRect().top, 64, kind);
  }
});

test('issue 1331: the real turnHtml draws the line right above the reply bubble, and only there', () => {
  const lines = src.split('\n'), pick = t => lines.find(l => l.startsWith(t)) + '\n';
  const ctx = { getComputedStyle: () => ({ getPropertyValue: () => '' }), document: { documentElement: {} }, window: { WizConfig: { agent: () => 'Wizard' }, WosSkinHost: {} }, KIT: { time: { full: String, stamp: String } },
    esc: s => String(s), md: s => `<p>${s}</p>`, PW: null, replyCard: () => '', msgIds: () => '', quoteBtn: () => '', userMedia: () => '', mediaBlock: () => '', clip: s => s, CHECK_SVG: '', COPY_SVG: '', SHARE_SVG: '', noteHtml: () => '', runContextHtml: () => '' };
  vm.createContext(ctx);
  vm.runInContext(['  const regenOn = ', '  const summaryOn = ', '  const SUMMARY_WORDS = ', '  const summaryOf = ', '  const summaryStartsOpen = ', '  const leadText = ', '  const COG_SVG = ', '  const CHEV_SVG = ', '  const timeTag = '].map(pick).join('')
    + src.slice(src.indexOf('  function turnHtml('), src.indexOf('  const turnAt = ')) + 'this.turnHtml = turnHtml;', ctx);
  const tn = { u: { text: 'Which logo?', at: 1 }, a: { text: 'Pick one', at: 2 }, media: [], notes: [], steers: [], steps: 0 };
  const need = '<div class="ch-needs-line" data-needs-line>N</div>';
  const html = ctx.turnHtml({ texts: [] }, tn, true, false, null, null, true, need);
  assert.match(html, /<div class="msg u"[^]*<\/div><div class="ch-needs-line" data-needs-line>N<\/div><div class="msg a"/, 'between the owner\'s message and the reply');
  assert.equal(ctx.turnHtml({ texts: [] }, tn, true, false, null, null, true), html.replace(need, ''), 'without it the turn is unchanged');
});

test('issue 1331: Reply on any message is standard for the main agent; the Thread tracker strip and dots retire', () => {
  const f = needsFixture();
  assert.equal(f.replyStd(''), true); assert.equal(f.replyStd('hermes'), true);
  for (const a of ['host', 'container', 'restricted']) assert.equal(f.replyStd(a), false, a + ': as with the tracker, the main agent only');
  // msgIds / quoteBtn: turnHtml's tt says which agent.
  const lines = src.split('\n'), pick = t => lines.find(l => l.includes(t));
  const c = vm.createContext({ esc: String, isFinite, WosThreadTracker: { on: () => false } });
  vm.runInContext(pick('const msgIds =') + '\n' + pick('const quoteBtn =') + '\nthis.f = { msgIds, quoteBtn };', c);
  assert.match(c.f.quoteBtn(true), /data-mquote/); assert.match(c.f.msgIds({ id: 4, at: 5 }), /data-mid="4" data-mat="5"/);
  assert.equal(c.f.quoteBtn(false), '', 'another agent\'s bubbles: none');
  // The tracker itself is retired (strip, dropdown, chats-list dots): Channels are on for everyone (issue 1258).
  const tt = readFileSync(new URL('../web/core/thread-tracker.js', import.meta.url), 'utf8').split('\n');
  const onOf = tweaks => { const x = vm.createContext({ document: { documentElement: { dataset: { tweaks } } } }); vm.runInContext(tt.find(l => l.includes("const ID = 'wizard/thread-tracker'")) + '\n' + tt.find(l => l.includes('const on = ()')) + '\nthis.on = on;', x); return x.on(); };
  assert.equal(onOf('wizard/thread-tracker'), false, 'retired, even with its own id saved');
  assert.equal(onOf('wizard/thread-tracker wizard/needs-you-in-thread'), false);
  // Its Reply and the thread's Mark done are handled by Chats.
  // (the real click handler, core/chats-bind.js)
  const tw = { id: 'w1', thread: 't1' }, msgEl = { msg: true };
  const quote = std => { const c = bindClick({ replyStd: () => std, LIVE: { agentOf: () => '' }, H: { win: () => tw } }); const r = c.click(tap({ '[data-mquote]': { closest: sel => sel === '.msg' ? msgEl : null } }), 'w1'); return [r, c.calls.filter(x => x[0] === 'quoteMessage').map(x => [x[1].thread, x[2] === msgEl])]; };
  assert.deepEqual(plain(quote(true)), [true, [['t1', true]]], 'Reply quotes that message');
  assert.deepEqual(plain(quote(false)[1]), [], 'another agent\'s thread: no Reply');
  const mdc = bindClick({ H: { win: () => tw } });
  assert.equal(mdc.click(tap({ '[data-chmarkdone]': {} }), 'w1'), true);
  assert.deepEqual(plain(mdc.calls.filter(x => x[0] === 'markDone')), [['markDone', 'w1', 't1', true]], 'the thread\'s Mark done');
  // A reply sent from the Needs you message clears it (the real statement in chats-send.js sendChat, after the save).
  const sendText = readFileSync(new URL('../web/core/chats-send.js', import.meta.url), 'utf8');
  const repliedLine = stmt(sendText, "typeof needsReplied === 'function') needsReplied(");
  const replied = (isNew, reply) => { const got = []; runRecording(repliedLine, { isNew, reply, wid: 'w1', sid: 't1', needsReplied: (...a) => got.push(a) }); return plain(got); };
  assert.deepEqual(replied(false, { id: 'm1' }), [['w1', 't1', { id: 'm1' }]]);
  assert.deepEqual(replied(true, { id: 'm1' }), [], 'a new chat is no reply'); assert.deepEqual(replied(false, null), [], 'no quoted message');
});

test('issue 1331: Archive turns quiet; Mark done is the strong button, only while a Needs you is open', () => {
  // Moved into the Channels package (issue 1358); the rules come after its Needs you comment.
  const all = (s => s.slice(s.indexOf('/* Channels in Chats (wizard-ux issue 1254)')))(readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8'));
  const css = all.slice(all.indexOf('/* Needs you in the thread (wizard-ux issue 1331'));
  const S = 'html:root';
  for (const rule of css.split('\n').filter(l => l.includes('{'))) assert.ok(rule.startsWith(S), 'scoped: ' + rule.slice(0, 60));
  const s = askRow('b'), f = needsFixture();
  // The thread's action row (the real statement in core/chats-threadpaint.js) with the real needsAsk / canMarkDone.
  const paintText = readFileSync(new URL('../web/core/chats-threadpaint.js', import.meta.url), 'utf8');
  const tactsLine = stmt(paintText, 'const tacts = NV ?');
  const tactsOf = row => runRecording(`${tactsLine}\nthis.out = tacts;`, { NV: null, acts: ['done'], turns: [{}], pend: [], s: row, needsAsk: vm.runInContext('needsAsk', f.env), canMarkDone: f.canMarkDone,
    MARK_DONE_SVG: '', ACT: { done: { hint: 'Archive', icon: '' } }, actionLabel: () => 'Archive' }).out;
  const T = painted(`<div class="ch-thread">${tactsOf(s)}</div>`), md = T.q('.ch-tacts button.ch-tact-md[data-chmarkdone]'), ar = T.q('.ch-tacts button[data-chact="done"]');
  assert.deepEqual([T.v(ar, 'color'), T.v(ar, 'border-color'), T.v(ar, 'background')], ['#9ab', '#345', 'transparent'], 'Archive: neutral ink, no accent fill');
  assert.deepEqual([T.v(md, 'background'), T.v(md, 'color')], ['#48f', '#012'], 'Mark done: the accent fill');
  assert.ok(!tactsOf({ ...s, attention: { state: 'fyi', ask: 'x' } }).includes('data-chmarkdone'), 'no open Needs you: no Mark done');
  assert.ok(vm.runInContext('needsAsk', f.env)(s) && f.canMarkDone(s), 'shown on an open Needs you');
  assert.equal(vm.runInContext('needsAsk', f.env)({ ...s, attention: { state: 'fyi', ask: 'x' } }), null, 'nothing prominent otherwise');
  const cat = JSON.parse(readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8'));
  assert.ok(!cat.tweaks.includes('wizard/chat-channels') && !cat.defaults.includes('wizard/chat-channels'), 'Channels are no longer a tweak: on for everyone (issue 1258)');
  for (const gone of ['wizard/needs-you-in-thread', 'wizard/mark-done', 'wizard/channel-read-sync']) assert.ok(!cat.tweaks.includes(gone), gone + ': one visible toggle (issue 1358)');
});

/* Issue 1336: Activity as a short what-needs-me list, behind the same switch. The real Channels block helpers (Needs you,
 * unread, the row marker, the agent name, Agents in the Channels list, the agent's feed, Undo) with the real list model. */
const actFn = (f, name) => vm.runInContext(name, f.env);
function actGroups(f, rows, opts = {}) {
  const M = f.env.WizChatsListModel;
  return M.activityGroups({ ready: rows }, { needs: actFn(f, 'actNeeds'), unread: actFn(f, 'actUnread'), at: s => s.at }, { now: NOW, ...opts });
}
const actIds = list => [...list].map(s => s.id);

test('issue 1336: green leaves Ready once opened; amber stays in Ready until it is addressed (Mark done)', () => {
  const green = row('g', 1, { fresh: true }), amber = row('y', 2, { fresh: true, attention: { state: 'needs_you', ask: 'Pick one' }, lastAssistantAt: new Date(NOW - 2 * H).toISOString() }), plain = row('p', 3);
  const f = doneFixture({ sessions: { y: amber } });
  let g = actGroups(f, [green, amber, plain]);
  assert.deepEqual(actIds(g.ready), ['g', 'y']); assert.deepEqual(actIds(g.recent), ['p']);
  // Opening both threads reads them (openChat → LIVE.markSeen): green goes to Recent, amber stays (James: "It should stay in ready").
  f.env.LIVE.markSeen([green, amber]);
  g = actGroups(f, [green, amber, plain]);
  assert.deepEqual(actIds(g.ready), ['y'], 'opening a yellow thread keeps it in Ready');
  assert.deepEqual(actIds(g.recent), ['g', 'p'], 'the opened green thread is in Recent, newest first');
  // Addressed: Mark done (the one rule of issue 1331/1317) takes it out of Ready.
  assert.equal(f.markDone('w', 'y'), true);
  g = actGroups(f, [green, amber, plain]);
  assert.deepEqual(actIds(g.ready), []); assert.deepEqual(actIds(g.recent), ['g', 'y', 'p']);
});

test('issue 1336: one marker per row, amber over green, spinner for working; the purple dot is gone', () => {
  const f = fixture();
  const mark = actFn(f, 'actMark'), html = actFn(f, 'actRowMark');
  const both = row('b', 1, { fresh: true, attention: { state: 'needs_you', ask: 'x' } });
  assert.equal(mark(both), 'needs', 'yellow wins when a thread qualifies for both');
  assert.equal(mark(row('n', 1, { fresh: true })), 'new');
  assert.equal(mark(row('w', 1, { status: 'running', fresh: true })), 'working');
  assert.equal(mark(row('a', 1, { status: 'waiting_for_approval' })), 'needs', 'an approval waits on the owner too');
  assert.equal(mark(row('r', 1)), '');
  assert.match(html(both), /^<span class="ch-act-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you"><\/i><\/span>$/);
  assert.match(html(row('n', 1, { fresh: true })), /ch-chan-dot new" role="img" aria-label="Unread"/);
  // Painted (the real chats.css): an Activity row's unread time stays quiet ink, never violet; the AI apps unread dot is green.
  const P = painted(`<div class="ch-list"><div class="ch-row unread">${html(row('n', 1, { fresh: true }))}<div class="tp"><time>1h</time></div></div></div>`);
  assert.deepEqual([P.v(P.q('.ch-row.unread .tp time'), 'color'), P.v(P.q('.ch-row.unread .tp time'), 'font-weight')], ['#888', '400'], 'no violet unread time with the switch on');
  const A = painted('<div class="aad-rw"><div class="aad-row"><span class="aad-st is-new"></span></div></div>', { attrs: { 'data-layout': 'ai-apps' } }), dot = A.q('.aad-st.is-new');
  assert.deepEqual([A.v(dot, 'background'), A.v(dot, 'width')], ['#3c9', '8px'], 'the AI apps unread dot is green, not the accent');
});

test('issue 1497 main vs routed: every Activity row has one marker slot, drawn left of the title, for each agent kind', () => {
  const agents = { a: '', h1: 'host', k1: 'container', r1: 'restricted' };
  for (const [sid, kind] of [['a', 'main'], ['h1', 'host-profile'], ['k1', 'container'], ['r1', 'restricted']]) {
    const f = fixture({ agents }), html = actFn(f, 'actRowMark');
    assert.match(html(row(sid, 1, { attention: { state: 'needs_you', ask: 'x' } })), /^<span class="ch-act-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you"><\/i><\/span>$/, `${kind}: amber`);
    assert.match(html(row(sid, 1, { status: 'running' })), /^<span class="ch-act-ind"><i class="ch-spin" role="img" aria-label="Working"><\/i><\/span>$/, `${kind}: spinner`);
    assert.equal(html(row(sid, 1)), '<span class="ch-act-ind" aria-hidden="true"></span>', `${kind}: no marker keeps an empty slot so titles line up`);
  }
  const css = (s => s.slice(s.indexOf('/* Channels in Chats (wizard-ux issue 1254)')))(readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8'));
  // Painted (the real chats.css): the rendered marker sits before the title, in Chats and in the AI apps sidebar.
  const P = painted(`<div class="ch-list"><div class="ch-row">${actFn(fixture({ agents }), 'actRowMark')(row('a', 1, { status: 'running' }))}<div class="tp"></div></div></div>`);
  assert.equal(P.v(P.q('.ch-row > .ch-act-ind'), 'order'), '-1', 'the marker sits before the title');
  const A = painted('<div class="aad-rw"><div class="aad-row"><span class="aad-st"></span><b>T</b></div></div>', { attrs: { 'data-layout': 'ai-apps' } });
  assert.equal(A.v(A.q('.aad-row > .aad-st'), 'order'), '-1', 'the AI apps marker leads the row');
  assert.doesNotMatch(css, /\.ch-act-ind \{ order: 6;/, 'nothing puts it back at the right end');
});

test('issue 1336: the three sorts (Newest first, Oldest first, Needs you first); Recent is always newest first', () => {
  const f = fixture();
  const rows = [row('old-needs', 5, { attention: { state: 'needs_you', ask: 'x' } }), row('mid', 3, { fresh: true }), row('new', 1, { fresh: true }), row('r1', 2), row('r2', 4)];
  assert.deepEqual([...f.env.WizChatsListModel.ACTIVITY_SORTS].map(([, l]) => l), ['Newest first', 'Oldest first', 'Needs you first']);
  assert.deepEqual(actIds(actGroups(f, rows).ready), ['new', 'mid', 'old-needs'], 'Newest first is the default');
  assert.deepEqual(actIds(actGroups(f, rows, { order: 'oldest' }).ready), ['old-needs', 'mid', 'new']);
  assert.deepEqual(actIds(actGroups(f, rows, { order: 'priority' }).ready), ['old-needs', 'new', 'mid'], 'Needs you first, then newest');
  for (const order of ['newest', 'oldest', 'priority']) assert.deepEqual(actIds(actGroups(f, rows, { order }).recent), ['r1', 'r2']);
  assert.equal(f.env.WizChatsListModel.activitySortOf('subject'), 'newest', 'a By subject order reads as Newest first');
});

test('issue 1336: Recent goes back about a week, then Show older lists the rest of the live window', () => {
  const f = fixture();
  const rows = [row('d1', 24), row('d6', 6 * 24), row('d9', 9 * 24), row('d20', 20 * 24)];
  const g = actGroups(f, rows);
  assert.deepEqual(actIds(g.recent), ['d1', 'd6']); assert.equal(g.older, 2);
  const all = actGroups(f, rows, { older: true });
  assert.deepEqual(actIds(all.recent), ['d1', 'd6', 'd9', 'd20']); assert.equal(all.older, 0);
  // Snoozed and Archived are their own folded sections at the bottom.
  const M = f.env.WizChatsListModel, sn = row('s', 1, { deferred: true }), ar = row('x', 1, { archived: true });
  const g2 = M.activityGroups({ ready: [sn], archive: [ar], working: [] }, { needs: actFn(f, 'actNeeds'), unread: actFn(f, 'actUnread'), at: s => s.at }, { now: NOW });
  assert.deepEqual([actIds(g2.snoozed), actIds(g2.archive), actIds(g2.ready), actIds(g2.recent)], [['s'], ['x'], [], []]);
});

test('issue 1336: Agents sits folded just above Archive and is hidden with one agent; an agent opens its own feed', () => {
  const agentsList = [{ id: 'host', label: 'Host' }, { id: 'hermes', label: 'Archimedes', is_default: true }, { id: 'container', label: 'Box' }];
  const f = fixture({ agents: { h1: 'host', k1: 'container' } });
  f.env.focusAgents = () => [agentsList[1]];
  f.env.agentName = id => (agentsList.find(a => a.id === id) || { label: id }).label;
  const archived = [row('a', 1)];
  f.store.set('wos.chats.channel-prefs.v1', JSON.stringify({ archived: { voice: new Date(NOW).toISOString() } }));
  assert.doesNotMatch(f.channelsBody(f.w, archived), /data-chchanagents/, 'one agent: no Agents section');
  f.env.focusAgents = () => agentsList;
  let html = f.channelsBody(f.w, archived);
  assert.match(html, /<button type="button" class="ch-sec-h" data-chchanagents aria-expanded="false"><span>Agents<\/span><small>3<\/small>/);
  assert.ok(html.indexOf('data-chchanagents') < html.indexOf('data-chchanarch') && html.indexOf('data-chchanagents') > html.indexOf('data-chchannew'), 'after + New channel, before Archive');
  assert.doesNotMatch(html, /data-chchan="@agent:/, 'collapsed by default');
  assert.equal(f.channelClick(click({ 'data-chchanagents': '' }), 'w', f.w), true);
  html = f.channelsBody(f.w, [row('h1', 1, { fresh: true }), row('a', 2)]);
  assert.deepEqual([...html.matchAll(/data-chchan="@agent:([^"]+)"/g)].map(m => m[1]), ['hermes', 'host', 'container'], 'the main agent first');
  assert.match(html.split('data-chchan="@agent:host"')[1].split('</button>')[0], /ch-chan-dot new/, 'each agent row has the aggregate marker');
  // Open: the agent's Focus, a feed of every thread with that agent, whatever channel it is in; Back returns.
  f.w.focus = null;
  assert.equal(f.channelClick(click({ 'data-chchan': '@agent:host' }), 'w', f.w), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.w.focus)), { kind: 'agent', key: 'host' });
  const open = f.chanOpen(f.w);
  assert.deepEqual(JSON.parse(JSON.stringify(open)), { id: '@agent:host', name: 'Host', agent: 'host', agentFeed: true });
  assert.equal(f.inChannel(open, row('h1', 1)), true, 'a thread in the host-ops channel'); assert.equal(f.inChannel(open, row('h9', 1, { owner: 'host' })), true, 'and one in General');
  assert.equal(f.inChannel(open, row('a', 1)), false, 'never another agent\'s');
  assert.equal(f.chanSpaceOf(f.w), '', 'its message box starts the new thread in General');
  assert.equal(f.chanReadKey(open), '', 'no channel watermark of its own');
  assert.equal(f.channelBack(f.w), true); assert.equal(f.w.focus, null);
  assert.equal(f.openChannel(f.w, '@agent:nobody'), false, 'only a visible agent');
});

test('issue 1336: main vs routed: host-profile, container and restricted threads name their agent after the channel; Ready and marks per row', () => {
  const f = fixture({ agents: { h1: 'host', k1: 'container', r1: 'restricted' } });
  f.env.agentName = id => ({ host: 'Host ops agent', container: 'Box agent', restricted: 'Locked agent' })[id] || 'Archimedes';
  const label = actFn(f, 'agentLabelOf');
  assert.equal(label(row('a', 1)), '', 'the main agent says nothing');
  for (const [id, owner, name] of [['h1', 'host', 'Host ops agent'], ['k1', 'container', 'Box agent'], ['r1', 'restricted', 'Locked agent']]) {
    assert.equal(label(row(id, 1, { owner })), name, owner);
    // A routed row sharing a main thread's id is still its own agent's (the row's owner, never the id).
    assert.equal(label(row('a', 1, { owner })), name, owner + ' with a shared id');
    const g = actGroups(f, [row(id, 1, { owner, fresh: true }), row('a', 2, { owner: '' })]);
    assert.deepEqual(actIds(g.ready), [id]); assert.deepEqual(actIds(g.recent), ['a']);
    assert.equal(actFn(f, 'actMark')(row(id, 1, { owner, attention: { state: 'needs_you', ask: 'x' } })), 'needs');
  }
});

test('issue 1336: Undo after an archive (about 5 s) restores; Activity shows every agent', () => {
  const f = fixture();
  const appended = [], timers = [];
  const mk = () => { const btn = { listeners: {}, addEventListener(k, fn) { this.listeners[k] = fn; } }; return { className: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelector: () => btn, btn, removed: 0, remove() { this.removed++; } }; };
  Object.assign(f.env.document, { createElement: () => mk(), body: { append: el => appended.push(el) } });
  f.env.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
  let undone = 0;
  assert.equal(actFn(f, 'actUndo')('Archived', () => undone++), true);
  assert.equal(appended.length, 1); assert.match(appended[0].innerHTML, /<span>Archived<\/span><button type="button" data-chundo>Undo<\/button>/);
  assert.equal(appended[0].attrs.role, 'status'); assert.equal(timers.at(-1)[1], 5000);
  appended[0].btn.listeners.click(); assert.equal(undone, 1); assert.equal(appended[0].removed, 1);
  // Activity drops an old agent / Space Focus (the chips are gone); a channel's or agent's feed keeps it.
  f.w.focus = { kind: 'agent', key: 'host' };
  assert.equal(actFn(f, 'actAllAgents')(f.w), true); assert.equal(f.w.focus, null);
  f.w.focus = { kind: 'space', key: 'launch' }; f.w.chan = { id: 'launch', prev: null };
  assert.equal(actFn(f, 'actAllAgents')(f.w), false, 'a channel feed is open');
  f.w.chan = null;
});

test('issue 1336: the renderer draws Activity, archive toasts offer Undo, and Activity takes its own taps', async () => {
  assert.doesNotMatch(src, /<h5>Layout<\/h5>|data-chgroupday aria-pressed/, 'the By day / By status layout choices went with the switch (issue 1258)');
  // the real list renderer with Channels loaded draws Activity in place of the sections
  const { render } = channelsList({ activityBody: () => '<div class="ch-activity">Activity</div>' });
  assert.match(render(''), /<div class="ch-activity">Activity<\/div>/);
  assert.doesNotMatch(render('match'), /ch-activity/, 'a search shows its results instead');
  // threadAct: an archive offers Undo (actUndo) in place of the plain toast
  const act = async (undo) => {
    const ctx = runRecording(`${fnBlock(src, '  async function threadAct(wid, sid, a) {')}\nthis.act = threadAct;`, { W: { w1: { id: 'w1', thread: null } }, owner: id => id, rowOf: () => ({ id: 't1' }), ACT: { done: 1 }, keepThreadOpen: () => true, followUpActive: () => false, actUndo: undo, window: {}, Promise, Date, Object });
    try { await ctx.act('w1', 't1', 'done'); } catch (_) { /* the write after the toast is not under test */ }
    return ctx.calls.filter(c => c[0] === 'toast' && c[2] === 'Archived').map(c => c[0]);
  };
  const offered = [];
  assert.ok(!(await act((m, fn) => { offered.push(m); return true; })).includes('toast'), 'Undo replaces the plain toast');
  assert.deepEqual(offered, ['Archived']);
  assert.ok((await act(undefined)).includes('toast'), 'no Undo (Channels not loaded): the plain toast');
  // Activity's taps: never on an open thread
  const ac = runRecording(`${fnBlock(src, '  function activityClick(e, w) {')}\nthis.click = activityClick;`, {});
  assert.equal(ac.click({ target: { closest: () => null } }, { id: 'w1', thread: 't1' }), false);
  assert.equal(ac.click({ target: { closest: () => null } }, null), false);
});

test('issue 1336 (Codex P2): Undo waits for the archive still in flight, then restores; a refused restore says so', async () => {
  const f = fixture(), order = [];
  let settle; const pending = new Promise(r => { settle = r; });
  f.env.paintListsNow = () => order.push('paint');
  let restoreOk = true;
  f.env.LIVE.restore = async sid => { order.push('restore:' + sid); return restoreOk; };
  const run = actFn(f, 'actRestore')('b', pending.then(() => order.push('archived')));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(order, [], 'nothing restores while the archive write is in flight');
  settle(true); assert.equal(await run, true);
  assert.deepEqual(order, ['archived', 'restore:b', 'paint']);
  restoreOk = false; order.length = 0;
  assert.equal(await actFn(f, 'actRestore')('b', Promise.reject(new Error('offline'))), false, 'a failed archive still lets Undo try');
  assert.deepEqual(order, ['restore:b', 'paint']); assert.equal(f.toasts.at(-1), 'Couldn’t undo · still archived');
});

test('draft marks (issue 1445): a Channels line whose box holds a draft wears the pencil, per agent (no switch since issue 1604)', () => {
  const f = fixture({ rows: [row('a', 1), row('d', 2), row('h1', 1, { owner: 'host' }), row('k1', 1, { owner: 'container' }), row('r1', 1, { owner: 'restricted' })] });
  const keys = new Set(['chan:hermes:launch', 'chan:host:host-ops', 'chan:restricted:locked']);
  f.env.KIT.drafts.keys = () => keys;
  const lines = () => Object.fromEntries(f.channelsBody(f.w, f.rows).split(/<div class="ch-chan(?=[ "])/).slice(1).map(h => [/data-chchan="([^"]+)"/.exec(h)?.[1], h.includes('class="ch-chan-draft"')]));
  const word = () => /<span class="ch-chan-draft" title="Unsent draft"><span aria-hidden="true">✎<\/span> Draft<\/span>/.test(f.channelsBody(f.w, f.rows)); // issue 1709: the word too
  const on = lines();
  assert.deepEqual({ launch: on.launch, voice: on.voice, host: on['host-ops'], box: on.box, locked: on.locked }, { launch: true, voice: false, host: true, box: false, locked: true });
  assert.ok(word(), 'the pencil says Draft (issue 1709)');
  keys.delete('chan:hermes:launch'); keys.add('chan::__general__');
  const after = lines();
  assert.equal(after.launch, false, 'sent or discarded: gone');
  assert.equal(Object.entries(after).find(([k]) => /general/i.test(k))?.[1], true, 'General (main agent) box key chan::<id>');
});

test('issue 1709: a channel feed\'s thread card says ✎ Draft on its reply line while its thread (direct:<id>) holds a draft, main and routed alike, (no switch since issue 1604)', async () => {
  const f = fixture({ rows: [], history: { a: [{ role: 'user', text: 'Plan the launch' }, { role: 'assistant', text: 'ok' }], b: [{ role: 'user', text: 'Voice keys' }, { role: 'assistant', text: 'done' }] } });
  // The real draft-mark read (core/chats-daily.js rowDraft: the drafts store's keys) is in the block.
  assert.equal(vm.runInContext('typeof rowDraft', f.env), 'function');
  const keys = new Set(); f.env.KIT.drafts.keys = () => keys;
  f.openChannel(f.w, 'launch'); const open = f.chanOpen(f.w), rows = [row('a', 3), row('b', 2)];
  f.channelFeed(f.w, open, rows); await new Promise(r => setImmediate(r));
  const feed = () => f.channelFeed(f.w, open, rows);
  const cards = h => Object.fromEntries(h.split(/<div class="ch-post(?=[ "])/).slice(1).map(p => [/data-morph-key="post:([^"]+)"/.exec(p)?.[1], p]).filter(([k]) => k));
  const marked = h => Object.entries(cards(h)).filter(([, p]) => p.includes('class="ch-post-draft ch-draft-tag"')).map(([k]) => k);
  const off = feed();
  keys.add('direct:a'); keys.add('direct:h1');
  const on = feed();
  assert.deepEqual(marked(on), ['a'], 'the drafted thread is marked, the other is not');
  assert.match(cards(on).a, /data-chopen="a">[^]*?<time>[^<]*<\/time><span class="ch-post-draft ch-draft-tag"><span aria-hidden="true">✎<\/span> Draft<\/span><\/button>/, 'on the reply line, right after its time');
  assert.deepEqual(Object.keys(cards(on)), Object.keys(cards(off)), 'posts keep their order');
  keys.delete('direct:a');
  assert.deepEqual(marked(feed()), [], 'sent or discarded: gone');
  keys.add('chan:hermes:launch');
  assert.deepEqual(marked(feed()), [], 'the channel\'s own box draft marks no thread card');
  // A routed agent's channel (host): its thread's box saves under the same direct:<id> key.
  f.channelBack(f.w); f.openChannel(f.w, 'host-ops'); const hostOpen = f.chanOpen(f.w), hostRows = [row('h1', 1, { owner: 'host' })];
  assert.deepEqual(marked(f.channelFeed(f.w, hostOpen, hostRows)), ['h1'], 'routed thread card marked');
  keys.delete('direct:h1');
  assert.deepEqual(marked(f.channelFeed(f.w, hostOpen, hostRows)), [], 'routed: gone');
});

// Issue 1506: a channel's emoji where the # was. The emoji is the start of the channel's own name; General is #️⃣ and a
// name with no emoji gets 💬. The real top-level helpers (window.WizCore.channelFace / channelEmojiName) run here.
const coreTop = (() => { const i = src.indexOf('/* Channel emoji (wizard-ux issue 1506'); return src.slice(i, src.indexOf('window.WizCore.chats = function', i)); })();
function emojiCore() { const ctx = { window: { WizCore: {} } }; vm.createContext(ctx); vm.runInContext(coreTop, ctx); return ctx.window.WizCore; }
function emojiFixture(opts = {}) {
  const f = fixture({ spacesList: [
    { id: 'launch', name: '🚀 Launch', threads: ['a'] },
    { id: 'voice', name: 'Voice', threads: ['d'] },
    { id: 'apple', name: '🍎Zeta', threads: [] },
    { id: 'host-ops', name: '🛠️ Host ops', agent: 'host', threads: ['h1'] },
    { id: 'box', name: 'Box', agent: 'container', threads: ['k1'] },
    { id: 'locked', name: '🔒 Locked', agent: 'restricted', threads: ['r1'] },
  ], agents: { h1: 'host', k1: 'container', r1: 'restricted' }, ...opts });
  f.env.window.WizCore = emojiCore();
  return f;
}
const chanLines = html => [...html.matchAll(/data-chchan="([^"]+)"[^>]*><span class="ch-chan-hash ch-chan-emo" aria-hidden="true">([^<]*)<\/span><b>([^<]*)<\/b>/g)].map(m => [m[1], m[2], m[3]]);

test('issue 1506: channelFace reads the emoji at the start of a name; channelEmojiName puts or takes it off', () => {
  const C = emojiCore(), face = (n, g) => { const x = C.channelFace(n, g); return [x.emoji, x.label]; };
  assert.deepEqual(face('🚀 Launch'), ['🚀', 'Launch']);
  assert.deepEqual(face('🚀Launch'), ['🚀', 'Launch']);
  assert.deepEqual(face('Launch'), ['💬', 'Launch'], 'no emoji: the default');
  assert.deepEqual(face('General', true), ['#️⃣', 'General']);
  assert.deepEqual(face('🇳🇱 Dutch'), ['🇳🇱', 'Dutch'], 'a flag');
  assert.deepEqual(face('👩‍💻 Code'), ['👩‍💻', 'Code'], 'a joined emoji');
  assert.deepEqual(face('1️⃣ First'), ['1️⃣', 'First'], 'a keycap');
  assert.deepEqual(face('2024 plans'), ['💬', '2024 plans'], 'plain digits are words');
  assert.deepEqual(face('#launch'), ['💬', '#launch']);
  assert.deepEqual(face('🚀'), ['🚀', ''], 'an emoji-only name has no words (issue 1523: never "🚀 🚀")');
  assert.equal(C.channelFace('🚀').title, '🚀'); assert.equal(C.channelFace('🚀 Launch').title, '🚀 Launch'); assert.equal(C.channelFace('Launch').title, '💬 Launch');
  assert.equal(C.channelEmojiName('Launch', '🎯'), '🎯 Launch');
  assert.equal(C.channelEmojiName('🚀 Launch', '🎯'), '🎯 Launch', 'replaces the one in front');
  assert.equal(C.channelEmojiName('🚀 Launch', ''), 'Launch', 'takes it off');
  assert.equal(C.channelEmojiName('🚀', ''), 'Channel', 'never an empty name: an emoji-only one taken off is Channel (issue 1523)');
  assert.equal(C.channelEmojiName('🚀', '🎯'), '🎯', 'an emoji-only name swaps its emoji');
  assert.equal(C.channelEmojiName('x'.repeat(60), '🎯'), '', 'no room for the emoji: never cuts the name (issue 1523)');
  assert.equal(C.channelEmojiName('x'.repeat(59), '🎯'), '');
  assert.equal(C.channelEmojiName('x'.repeat(57), '🎯'), '🎯 ' + 'x'.repeat(57), 'exactly 60 fits');
  // Codex P2s: a subdivision flag (tag sequence) is one emoji; near the limit a trailing astral character is dropped whole.
  assert.deepEqual(face('🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} Scots'), ['🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', 'Scots']);
  assert.equal(C.channelEmojiName('🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} Scots', ''), 'Scots', 'no tag characters left behind');
  assert.equal(C.channelEmojiName('x'.repeat(56) + '😀', '🎯'), '', 'never half of a character either');
  assert.equal(C.channelEmojiName('🚀 ' + 'x'.repeat(57), '🎯'), '🎯 ' + 'x'.repeat(57), 'swapping one emoji for another of the same length fits');
  assert.ok(C.CHANNEL_EMOJI.length >= 12 && C.CHANNEL_EMOJI.every(e => C.channelFace(e + ' x').own), 'every picker emoji reads back as one');
});

test('issue 1506: the Channels list shows each channel\'s emoji where the # was, sorted by its words; General is #️⃣', () => {
  const f = emojiFixture();
  // All agents: A–Z by the words, not the emoji (🍎Zeta sorts last), General last.
  assert.deepEqual(chanLines(f.channelsBody(f.w, [])), [['box', '💬', 'Box'], ['host-ops', '🛠️', 'Host ops'], ['launch', '🚀', 'Launch'], ['locked', '🔒', 'Locked'], ['voice', '💬', 'Voice'], ['apple', '🍎', 'Zeta'], ['__general__', '#️⃣', 'General']]);
  // The main agent's own list.
  f.w.focus = { kind: 'agent', key: 'hermes' };
  assert.deepEqual(chanLines(f.channelsBody(f.w, [])), [['launch', '🚀', 'Launch'], ['voice', '💬', 'Voice'], ['apple', '🍎', 'Zeta'], ['__general__', '#️⃣', 'General']]);
  // The open feed's header and the channel sheet's title carry it too.
  f.openChannel(f.w, 'launch');
  assert.match(f.chanHead(f.w, f.chanOpen(f.w)), /<span class="ch-chan-hash ch-chan-emo" aria-hidden="true">🚀<\/span>Launch<\/b>/);
  f.openChannelSheet('w', 'voice'); assert.match(f.sheets.at(-1), /<div class="ch-sheet-t">💬 Voice<\/div>/);
  f.openChannelSheet('w', '__general__'); assert.match(f.sheets.at(-1), /<div class="ch-sheet-t">#️⃣ General<\/div>/);
  assert.doesNotMatch(f.channelsBody(f.w, []), /aria-hidden="true">#<\/span>/, 'no # left on a channel');
});

test('issue 1506 main vs routed: host-profile, container and restricted channels show their own emoji in their agent\'s list and feed', () => {
  const f = emojiFixture();
  for (const [agent, id, emoji, words] of [['host', 'host-ops', '🛠️', 'Host ops'], ['container', 'box', '💬', 'Box'], ['restricted', 'locked', '🔒', 'Locked']]) {
    f.w.focus = { kind: 'agent', key: agent };
    assert.deepEqual(chanLines(f.channelsBody(f.w, [])), [[id, emoji, words], ['__general__', '#️⃣', 'General']], agent);
    f.openChannel(f.w, id);
    assert.match(f.chanHead(f.w, f.chanOpen(f.w)), new RegExp(`aria-hidden="true">${emoji}</span>${words}</b>`), agent);
    f.channelBack(f.w);
  }
  // Setting an emoji renames that agent's own channel (one item edit), never a main one with the same words.
  f.chanSetEmoji('box', '🎯');
  assert.deepEqual(JSON.parse(JSON.stringify(f.ops.at(-1))), { op: 'set', key: 'spaces/box/name', item: '🎯 Box' });
});

test('issue 1506: Rename has the emoji row; a tap puts that emoji in front, a tap on the chosen one takes it off; Emoji… opens the full sheet', () => {
  const f = emojiFixture();
  f.openChannelSheet('w', 'launch');
  assert.match(f.sheets.at(-1), /data-rschemoji><span class="ch-sheet-emo" aria-hidden="true">🚀<\/span>Emoji…/);
  f.channelClick(click({ 'data-rschrename': '' }), 'w', f.w);
  const html = f.sheets.at(-1);
  assert.match(html, /data-chrnform[^]*value="🚀 Launch"[^]*class="ch-emoji-pick" role="group" aria-label="Channel emoji"/);
  assert.match(html, /data-chemoji="🚀" aria-pressed="true"/); assert.match(html, /data-chemoji="🎯" aria-pressed="false"/);
  // A fake form: the tap edits the field, fires input (the New channel form keeps its Create button in step) and rings the pick.
  const fired = [], field = { value: '🚀 Launch', disabled: false, dispatchEvent: evt => fired.push(evt.type) };
  const btns = ['🚀', '🎯'].map(e => ({ dataset: { chemoji: e }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, closest: sel => sel === 'form' ? formEl : null }));
  const formEl = { querySelector: () => field, querySelectorAll: () => btns };
  f.env.Event = class { constructor(t) { this.type = t; } };
  const tap = b => f.channelClick({ target: { closest: sel => sel === '[data-chemoji]' ? b : null } }, 'w', f.w);
  assert.equal(tap(btns[1]), true); assert.equal(field.value, '🎯 Launch'); assert.deepEqual(fired, ['input']);
  assert.deepEqual(btns.map(bt => bt.attrs['aria-pressed']), ['false', 'true']);
  tap(btns[1]); assert.equal(field.value, 'Launch', 'the chosen one again: off (the list shows 💬)');
  f.submitChannelRename({ querySelector: () => ({ value: field.value, focus() {} }) });
  assert.deepEqual(JSON.parse(JSON.stringify(f.ops.at(-1))), { op: 'set', key: 'spaces/launch/name', item: 'Launch' });
  // Emoji… = the existing emoji sheet (search + categories), keyed to this channel; its pick renames with that emoji.
  const opened = []; f.env.openEmojiSheet = (...a) => opened.push(a);
  f.openChannelSheet('w', 'voice'); f.channelClick(click({ 'data-rschemoji': '' }), 'w', f.w);
  assert.deepEqual(opened, [['w', 'chanemoji:voice', 'Emoji for Voice']]);
  assert.equal(f.chanSetEmoji('voice', '🎵'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.ops.at(-1))), { op: 'set', key: 'spaces/voice/name', item: '🎵 Voice' });
});

// Issue 1523 (AI review of 1519): an emoji-only channel name, a name with no room for an emoji, and the toast/pin words.
test('issue 1523: an emoji-only channel shows its emoji once in the list, feed header and sheet', () => {
  const f = emojiFixture({ spacesList: [{ id: 'solo', name: '🚀', threads: ['a'] }, { id: 'voice', name: 'Voice', threads: ['d'] }] });
  const body = f.channelsBody(f.w, []);
  assert.match(body, /data-chchan="solo"[^>]*><span class="ch-chan-hash ch-chan-emo">🚀<\/span><b><\/b>/, 'once, and read out (no words beside it)');
  assert.doesNotMatch(body, /🚀[^<]*<\/span><b>🚀/);
  assert.match(body, /recent posts in 🚀"/);
  f.openChannel(f.w, 'solo');
  assert.match(f.chanHead(f.w, f.chanOpen(f.w)), /<span class="ch-chan-hash ch-chan-emo">🚀<\/span><\/b>/);
  f.channelBack(f.w);
  f.openChannelSheet('w', 'solo'); assert.match(f.sheets.at(-1), /<div class="ch-sheet-t">🚀<\/div>/);
  // Its composer says it once too.
  f.openChannel(f.w, 'solo'); assert.match(f.chanComposer(f.w, f.chanOpen(f.w)), /placeholder="Message 🚀"/);
});

test('issue 1523: the picker clears an emoji-only name (💬 Channel), main vs routed; Channel taken gets Channel 2', () => {
  const f = emojiFixture({ spacesList: [
    { id: 'solo', name: '🚀', threads: [] }, { id: 'old', name: 'Channel', threads: [] },
    { id: 'h', name: '🎯', agent: 'host', threads: [] }, { id: 'k', name: '🎯', agent: 'container', threads: [] }, { id: 'r', name: '🎯', agent: 'restricted', threads: [] },
  ] });
  // The emoji sheet: tapping the emoji it already has takes it off.
  assert.equal(f.chanSetEmoji('solo', '🚀'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.ops.at(-1))), { op: 'set', key: 'spaces/solo/name', item: 'Channel 2' }, 'the main agent already has a Channel');
  assert.deepEqual(chanLines(f.channelsBody(f.w, [])).find(x => x[0] === 'solo'), ['solo', '💬', 'Channel 2']);
  for (const [agent, id] of [['host', 'h'], ['container', 'k'], ['restricted', 'r']]) {
    assert.equal(f.chanSetEmoji(id, '🎯'), true, agent);
    assert.deepEqual(JSON.parse(JSON.stringify(f.ops.at(-1))), { op: 'set', key: `spaces/${id}/name`, item: 'Channel' }, `${agent}: its own list has no Channel yet`);
  }
  // The Rename form's emoji row does the same to the field.
  f.env.rowSheet = { wid: 'w', chan: 'solo', rename: true };
  const fired = [], field = { value: '🚀', disabled: false, dispatchEvent: evt => fired.push(evt.type), focus() {} };
  const btn = { dataset: { chemoji: '🚀' }, setAttribute() {}, closest: sel => sel === 'form' ? formEl : null };
  const formEl = { querySelector: () => field, querySelectorAll: () => [btn] };
  f.env.Event = class { constructor(t) { this.type = t; } };
  f.channelClick({ target: { closest: sel => sel === '[data-chemoji]' ? btn : null } }, 'w', f.w);
  assert.equal(field.value, 'Channel'); assert.deepEqual(fired, ['input']);
});

test('issue 1523: clearing finds a free Channel N past 99 (Codex P2: 200 channels per agent)', () => {
  const taken = [{ id: 'c1', name: 'Channel', threads: [] }].concat(Array.from({ length: 120 }, (_, i) => ({ id: 'c' + (i + 2), name: `Channel ${i + 2}`, threads: [] })));
  const f = emojiFixture({ spacesList: [{ id: 'solo', name: '🚀', threads: [] }, ...taken] });
  assert.equal(f.chanSetEmoji('solo', '🚀'), true);
  assert.equal(f.ops.at(-1).item, 'Channel 122');
});

test('issue 1523: a name with no room for the emoji is kept whole and the owner is told', () => {
  const long = 'x'.repeat(59), f = emojiFixture({ spacesList: [{ id: 'long', name: long, threads: [] }] });
  assert.equal(f.chanSetEmoji('long', '🎯'), false);
  assert.equal(f.ops.length, 0, 'no rename');
  assert.match(f.toasts.at(-1), /too long for an emoji/);
  const fired = [], field = { value: long, disabled: false, dispatchEvent: evt => fired.push(evt.type), focus() { this.focused = true; } };
  const btn = { dataset: { chemoji: '🎯' }, setAttribute() {}, closest: sel => sel === 'form' ? formEl : null };
  const formEl = { querySelector: () => field, querySelectorAll: () => [btn] };
  f.env.Event = class { constructor(t) { this.type = t; } };
  f.env.rowSheet = { wid: 'w', chan: 'long', rename: true };
  assert.equal(f.channelClick({ target: { closest: sel => sel === '[data-chemoji]' ? btn : null } }, 'w', f.w), true);
  assert.equal(field.value, long, 'the field keeps every character'); assert.deepEqual(fired, []); assert.ok(field.focused);
  // 60 characters with an emoji already in front: swapping it still fits.
  const full = emojiFixture({ spacesList: [{ id: 'full', name: '🚀 ' + 'x'.repeat(57), threads: [] }] });
  assert.equal(full.chanSetEmoji('full', '🎯'), true);
  assert.equal(full.ops.at(-1).item, '🎯 ' + 'x'.repeat(57));
});

test('issue 1523: Mark channel read says the channel by its emoji; the voice pin and orb hint do too', () => {
  const f = emojiFixture({ spacesList: [{ id: 'launch', name: '🚀 Launch', threads: [] }, { id: 'voice', name: 'Voice', threads: [] }, { id: 'solo', name: '🎯', threads: [] }] });
  f.env.LIVE.sessionsFor = () => []; f.env.paintListsNow = () => {};
  const read = vm.runInContext('chanMarkRead', f.env);
  for (const [cid, words] of [['launch', '🚀 Launch read'], ['voice', '💬 Voice read'], ['solo', '🎯 read'], ['__general__', '#️⃣ General read']]) {
    assert.equal(read(f.w, cid), true, cid); assert.equal(f.toasts.at(-1), words);
  }
  assert.ok(!f.toasts.some(t => /^# /.test(t)), 'never #');
  // The voice view of a channel's feed (app.js viewOf) and the orb's hint name it by its title.
  const app = withAppParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));
  const C = emojiCore();
  const viewOfFn = fnBlock(readFileSync(new URL('../web/app-viewvoice.js', import.meta.url), 'utf8'), '  function viewOf(id) {');
  const pinName = chan => runRecording(viewOfFn + '\nglobalThis.viewOf = viewOf;', { appVars: { W: { w1: { id: 'w1', app: 'chats', thread: null } } }, window: { WizCore: C },
    CHATS: { chanOpen: () => chan, chanBox: id => 'chan:' + id, winAgent: () => '' }, agentWin: () => false, winTitle: () => 'T' }).viewOf('w1').name;
  assert.equal(pinName({ id: 'launch', name: '🚀 Launch' }), '🚀 Launch channel');
  assert.equal(pinName({ id: 'solo', name: '🎯' }), '🎯 channel');
  assert.equal(pinName({ id: 'general', name: 'General', general: true }), '#️⃣ General channel');
  // The orb's hint while a channel take records (the real statement in app.js).
  const hintLine = stmt(app, "const want = q === 'cmd'");
  const hint = channel => runRecording(`${hintLine}\nthis.out = want;`, { q: '', agent: 'Wizard', V: { snap: { view: { channel } } }, window: { WizCore: C } }).out;
  assert.equal(hint('🚀 Launch'), 'To 🚀 Launch · tap to send'); assert.equal(hint('Voice'), 'To 💬 Voice · tap to send');
  assert.equal(hint('General'), 'To #️⃣ General · tap to send');
});
