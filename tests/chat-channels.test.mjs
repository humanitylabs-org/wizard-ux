// Channels view (wizard/chat-channels, wizard-ux issue 1254): the real block from core/chats.js on fake Spaces/rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); return src.slice(i, src.indexOf(b, i)); };
const block = cut('  /* Channels view (switch wizard/chat-channels', '  function clearAll(w)');

const H = 3600e3, NOW = Date.UTC(2026, 10, 10, 12);
function fixture({ on = true, rows = [], spacesList, agents = {}, history = {}, full = {}, sessions = {}, owner = 'James de Fleur' } = {}) {
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
  const env = {
    document: { documentElement: { dataset: { tweaks: on ? 'wizard/desktop-chats wizard/chat-channels' : 'wizard/desktop-chats' } } },
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
    window: { WizConfig: { owner: () => owner } }, PIN_SVG: '<svg pin></svg>', RENAME_SVG: '<svg rn></svg>', ACT: { done: { icon: '<svg ar></svg>' } },
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
  vm.runInContext(block + ';this.api={channelsOn,chanOpen,channelsFor,inChannel,chanName,openChannel,channelBack,channelsBody,channelFeed,chanHead,channelClick,chanSwitchedOff,chanPruned,openChannelSheet,submitChannelRename,firstPost,chanComposer,chanDraftKey,chanSpaceOf,channelSend,chanSeenPaint,chanSeenRow,chanHold,chanScrolled,chanUser,chanToEnd,chanReplies,chanEditUnsent,REPLIES,CHAN_SENDING,FIRST,CHAN_ARCHIVE_PRUNE_DAYS,get view(){return chanView}};', env);
  const setOn = v => { env.document.documentElement.dataset.tweaks = v ? 'wizard/desktop-chats wizard/chat-channels' : 'wizard/desktop-chats'; };
  return { ...env.api, get view() { return env.api.view; }, w: wins.w, rows, renders, focusCalls, store, env, sheets, toasts, ops, reads, viewer, drafts, marks, setOn, spacesData };
}
const row = (id, at, extra = {}) => ({ id, title: 'T ' + id, status: 'completed', at: NOW - at * H, ...extra });
const click = attrs => ({ target: { closest: sel => { const k = sel.slice(1, -1); return k in attrs ? { dataset: { [k.replace(/^data-/, '').replace(/-./g, m => m[1].toUpperCase())]: attrs[k] } } : null; } } });

test('switch off: no tabs, no feed, no channel taps, and the phone Back hook is inert', () => {
  const f = fixture({ on: false });
  assert.equal(f.channelsOn(), false);
  f.w.chan = { id: 'launch', prev: null }; f.w.focus = { kind: 'space', key: 'launch' };
  assert.equal(f.chanOpen(f.w), null);
  assert.equal(f.channelClick(click({ 'data-chview': 'channels' }), 'w', f.w), false);
  assert.equal(f.view, 'activity');
  assert.match(app, /CHATS\.channelBack\?\.\(f\)\) return 'channel'/);
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

test('feed filters Open (default) / Needs you / All, posts truncate at about 240 characters with more', async () => {
  const long = 'x'.repeat(300), say = (...t) => [{ role: 'user', text: long }, ...t.map(x => ({ role: 'assistant', text: x }))];
  const rows = [row('a', 5, { request: long, messageCount: 5 }), row('b', 3, { attention: { state: 'needs_you' }, messageCount: 2 }), row('c', 1, { archived: true })];
  const f = fixture({ history: { a: say('one', 'two', 'three', 'four'), b: say('ok') } }); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w), ids = h => [...h.matchAll(/class="ch-post-b" data-chopen="([^"]+)"/g)].map(m => m[1]);
  f.channelFeed(f.w, open, rows); await new Promise(r => setImmediate(r));
  let html = f.channelFeed(f.w, open, rows);
  assert.deepEqual(ids(html), ['a', 'b']); assert.match(html, /data-chchanf="open" aria-pressed="true"/);
  assert.match(html, /4 replies/); assert.match(html, /1 reply</); assert.match(html, /Needs you/);
  assert.match(html, /data-chpostmore="a" aria-expanded="false">more/);
  assert.match(html, /class="ch-post-t clamp">x{300}</, 'long text is clamped at 4 lines by CSS');
  f.channelClick(click({ 'data-chpostmore': 'a' }), 'w', f.w);
  assert.match(f.channelFeed(f.w, open, rows), /class="ch-post-t">x{300}</);
  f.channelClick(click({ 'data-chchanf': 'needs' }), 'w', f.w);
  assert.deepEqual(ids(f.channelFeed(f.w, open, rows)), ['b']);
  f.channelClick(click({ 'data-chchanf': 'all' }), 'w', f.w);
  html = f.channelFeed(f.w, open, rows);
  assert.deepEqual(ids(html), ['a', 'b', 'c']); assert.match(html, /Done/);
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

test('posting reuses the Space-fixed-at-send path: a new chat sent from a channel files into its Space Focus', () => {
  assert.match(src, /const spaceKey = isNew && typeof opts\.space === 'string' \? opts\.space : isNew && !opts\.away && focusOf\(w\)\?\.kind === 'space' \? focusOf\(w\)\.key : '';/);
  // Issue 1261: the send's own agent rides along, so the channel store files the chat by agent plus id.
  assert.match(src, /if \(spaceKey && it\?\.sessionId\) spaceMember\(spaceKey, it\.sessionId, true, it\.agent \?\? AGID \?\? ''\);/);
  // Back on the desktop list goes through clearFilter, which closes a feed after search and chips.
  assert.match(src, /if \(!c\.filter\) return typeof channelBack === 'function' && channelBack\(w\) \? 'channel' : false;/);
});

const ids = html => [...html.matchAll(/data-chchan="([^"]+)"/g)].map(m => m[1]);
const sheetButtons = html => [...html.matchAll(/data-(rsch\w+)>(?:<svg[^]*?<\/svg>)?([^<]*)</g)].map(m => m[2]);

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

test('long-press sheet on a channel: Pin, Rename, Archive channel, New post; General gets New post only', () => {
  const f = fixture();
  f.openChannelSheet('w', 'launch');
  assert.match(f.sheets.at(-1), /aria-label="Channel actions"[^]*# Launch/);
  assert.deepEqual(sheetButtons(f.sheets.at(-1)), ['Pin', 'Rename', 'Archive channel', 'New post']);
  assert.doesNotMatch(f.sheets.at(-1), /Delete/i);
  f.openChannelSheet('w', '__general__');
  assert.deepEqual(sheetButtons(f.sheets.at(-1)), ['New post']);
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
  f.setOn(false); assert.equal(f.openChannelSheet('w', 'launch'), false, 'switch off: no channel sheet');
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
  f.openChannelSheet('w', 'voice'); assert.deepEqual(sheetButtons(f.sheets.at(-1)), ['Pin', 'Rename', 'Restore']);
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

test('switching off with a channel open returns the list to the Focus it had, unfiltered', () => {
  const f = fixture();
  f.w.focus = null; f.openChannel(f.w, 'launch');
  assert.deepEqual(JSON.parse(JSON.stringify(f.w.focus)), { kind: 'space', key: 'launch' });
  assert.equal(f.chanSwitchedOff(f.w), false, 'switch on: nothing to undo');
  f.setOn(false);
  assert.equal(f.chanSwitchedOff(f.w), true);
  assert.equal(f.w.focus, null, 'back to All, not the Launch Space'); assert.equal(f.w.chan, null);
  assert.equal(f.chanSwitchedOff(f.w), false);
  assert.match(src, /if \(!chanOn && typeof chanSwitchedOff === 'function' && chanSwitchedOff\(w\)\)/, 'the list renderer runs it');
  assert.match(src, /window\.addEventListener\('wos:experience'/, 'and the switch repaints the lists at once');
});

test('the channel name shows once in an open feed: no focus strip, no title-bar label', () => {
  assert.match(src, /\$\{feed \? '' : focusStrip\(w\)\}/);
  assert.match(src, /function listTitle\(w\) \{ return focusAgents\(\)\.length === 1 && focusOf\(w\)\?\.kind === 'space' && !\(typeof chanOpen === 'function' && chanOpen\(w\)\)/);
});

test('Channels wording with the switch on: Move to channel, Remove from channel; today\'s words with it off', () => {
  assert.match(src, /SPACE\.ch \? 'Move to channel…' : spacesOf\(sid\)\.length \? `Move to \$\{SPACE\.one\}…` : `Add to a \$\{SPACE\.one\}…`/);
  assert.match(src, /Remove from \$\{SPACE\.ch \? 'channel' : SPACE\.one\}/);
  assert.match(src, /get ch\(\) \{ return typeof channelsOn === 'function' && channelsOn\(\); \}/);
  for (const w of ['New channel', 'Channel name', 'Already a channel', 'Maximum 50 channels', 'Couldn’t create channel']) assert.ok(src.includes(w), w);
});

test('long-press, right-click and Shift+F10 on a channel open the channel sheet through one rowMenu', () => {
  assert.match(src, /const ROW_MENU = '[^']*\.ch-list \[data-chchan\]';/);
  assert.equal((src.match(/rowMenu\((lp\.wid, lp\.row|q\.wid, q\.row|idOf\(row\), row)\)/g) || []).length, 4);
  assert.match(src, /justPressed\(\) && e\.target\.closest\('\[data-chopen\], \[data-chnotif\], \[data-chchan\]'\)/);
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
  assert.match(src, /const fab = feed \? \(typeof chanComposer === 'function' \? chanComposer\(w, feed\) : ''\) :/);
  assert.equal(f.chanComposer(f.w, f.chanOpen(f.w)), '', 'no message box on an archived channel');
});

// ---- wizard-ux issue 1258: a message box at the bottom of a channel posts straight into it ----
const form = value => { const ta = { value }; return { ta, querySelector: () => ta }; };
const settle = () => new Promise(r => setImmediate(r));

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
  // The Channels list itself (no feed open) and the switch off: no box.
  f.channelBack(f.w); assert.equal(f.chanDraftKey(f.w), '');
  f.openChannel(f.w, 'launch'); f.setOn(false); assert.equal(f.chanDraftKey(f.w), '');
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

test('a model picked in the channel box rides along; the needs-you filter opens so the post is seen', async () => {
  const f = fixture(); f.openChannel(f.w, 'launch'); f.env.ch('w').chanFilter = 'needs';
  f.env.ch('w').newModel = { model: 'opus', provider: 'anthropic' }; f.env._sendResult = Promise.resolve({ sessionId: 'n2' });
  await f.channelSend('w', form('hi'));
  assert.deepEqual(JSON.parse(JSON.stringify(f.env._sends[0][4].route)), { model: 'opus', provider: 'anthropic' });
  assert.equal(f.env.ch('w').chanFilter, 'open');
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
  assert.match(src, /if \(it && !\(typeof chanEditUnsent === 'function' && chanEditUnsent\(id, it\)\)\) H\.editUnsent\(it\)/);
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
  // Phone orb: a channel feed is an auto view whose take goes to a new chat ('__new__'), never the cloud router.
  assert.match(app, /const chan = w\.app === 'chats' && !w\.thread \? CHATS\.chanOpen\?\.\(w\) : null, pin = chan \? \{ kind: 'chat thread', thread: '__new__', channel: chan\.name, space: chan\.general \? '' : chan\.id, box: CHATS\.chanBox\?\.\(id\) \|\| '' \} : \{\};/);
  assert.match(app, /if \(chan\) return \{ id, mode: 'auto', \.\.\.pin, name:/);
  // A routed agent's channel (host-profile, container, restricted) keeps its agent's own voice path, pinned the same way.
  const viewOf = app.slice(app.indexOf('function viewOf(id)'), app.indexOf('// Unified Chats: a private agent'));
  assert.ok(viewOf.indexOf('const chan =') < viewOf.indexOf('if (agentWin(w)'), 'the channel is read before the routed-agent branch');
  assert.match(viewOf, /: `\$\{a\.name\} chats`, \.\.\.pin \};/);
  // The take's composer (words, photos) is this channel's box, not the New chat draft.
  assert.match(src, /const chanBoxOf = \(wid, sid\) => sid === '__new__' && W\[wid\] && !W\[wid\]\.thread && typeof chanDraftKey === 'function' \? chanDraftKey\(W\[wid\]\) : '';/);
  assert.match(src, /const P = peekComposer\(wid, sid, box\), dkey = boxKey\(wid, sid, box\);/);
  // ...the box of the channel the take STARTED in (Codex P1): phone sealTarget and desktop sealAt carry it.
  assert.match(app, /return \{ wid: V\.replyTo\.wid, sid: V\.replyTo\.sid, box: V\.replyTo\.box \};/);
  assert.match(app, /CHATS\.takeComposer\(sealAt\.wid, sealAt\.sid, sealAt\.box\)/);
  assert.match(app, /if \(typeof snap\.view\?\.space === 'string' && snap\.route && \(live\?\.agent \|\| ''\) !== \(snap\.route\.agent \|\| ''\)\) return snap\.route;/);
  // The box mic records a new chat from this channel; the model label opens the new-chat model menu.
  const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
  assert.match(power, /const boxThread = w => w\?\.thread \|\| \(w && A\.chanOpen\?\.\(w\) \? '__new__' : ''\);/);
  assert.match(power, /const sid = boxThread\(w\); if \(!sid \|\| !H\.recordReply\) return true;/);
  assert.match(power, /openModels\(id, boxThread\(ww\) === '__new__' \? 'new' : 'thread'/);
  // An orb take is pinned to the channel it started in (Codex P1): phone viewOf carries its Space to every send path,
  // the desktop orb keeps it from the start of the take.
  assert.match(app, /const pinSpace = v => typeof v\?\.space === 'string' && v\.thread === '__new__' \? \{ space: v\.space \} : \{\};/);
  assert.equal((app.match(/\.\.\.pinSpace\(s?v\)/g) || []).length, 4, 'the agent path, deliverToView, the take with files, and an interrupted take');
  const desk = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  assert.match(desk, /vSpace = !forceNew && vTarget \? CHATS\.chanSpaceOf\?\.\(W\[vTarget\]\) \?\? null : null;/);
  assert.match(desk, /\.\.\.\(aimSid === '__new__' && !rp && typeof vSpace === 'string' \? \{ space: vSpace \} : \{\}\)/);
  // Those takes are filed into the channel the way every new chat from a Space in front is (outbox onNew).
  assert.match(src, /const key = spaceInFront\(it\.agent \|\| ''\);\n\s*if \(key\) spaceMember\(key, it\.sessionId, true, it\.agent \|\| ''\);/); // issue 1261: with its agent
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
  f.env.ch('w').newModel = { model: 'tinfoil', provider: 'tinfoil', agent: 'restricted' };
  await f.channelSend('w', form('private?'));
  assert.equal(f.env._sends[0][4].route, null, 'default route instead of another agent');
  const g = fixture(); g.openChannel(g.w, 'host-ops'); g.env._sendResult = Promise.resolve({ sessionId: 'p2' });
  g.env.ch('w').newModel = { model: 'h-model', provider: 'h', agent: 'host' };
  await g.channelSend('w', form('host ask'));
  assert.equal(g.env._sends[0][4].route?.model, 'h-model');
});

test('a model picked for another agent never rides into a channel (box, mic or orb all read it): it is dropped on paint', () => {
  const f = fixture(); f.openChannel(f.w, 'launch');
  f.env.ch('w').newModel = { model: 'tinfoil', provider: 'tinfoil', agent: 'restricted' };
  f.chanComposer(f.w, f.chanOpen(f.w)); assert.equal(f.env.ch('w').newModel, null);
  f.env.ch('w').newModel = { model: 'opus', provider: 'anthropic' };
  f.chanComposer(f.w, f.chanOpen(f.w)); assert.equal(f.env.ch('w').newModel?.model, 'opus', 'a main pick stays in a main channel');
  const g = fixture(); g.openChannel(g.w, 'box');
  g.env.ch('w').newModel = { model: 'h', provider: 'h', agent: 'host' };
  g.chanComposer(g.w, g.chanOpen(g.w)); assert.equal(g.env.ch('w').newModel, null, 'a host pick never rides into the container channel');
  g.env.ch('w').newModel = { model: 'c', provider: 'c', agent: 'container' };
  g.chanComposer(g.w, g.chanOpen(g.w)); assert.equal(g.env.ch('w').newModel?.model, 'c');
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
test('an unread post makes its channel bold with a green dot (no number pill) after the amber one, in the right-hand slot', () => {
  const rows = [row('a', 1, { fresh: true, messageCount: 4 }), row('b', 2, { fresh: true, attention: { state: 'needs_you' } }), row('c', 3), row('d', 2), row('g', 1, { fresh: true })];
  const f = fixture();
  const chans = f.channelsBody(f.w, rows).split(/<div class="ch-chan(?=[ "])/).slice(1);
  const by = Object.fromEntries(chans.map(c => [c.match(/data-chchan="([^"]+)"/)[1], c]));
  assert.match(by.launch, /^ unread"/, 'Launch is bold');
  assert.match(by.launch, /<span class="ch-chan-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you"><\/i><i class="ch-chan-dot new" role="img" aria-label="2 unread"><\/i><\/span>/, 'count of posts, not messages, in the green dot\'s label; amber first');
  assert.doesNotMatch(by.launch, /ch-chan-n|<small/, 'no bare number pill');
  assert.doesNotMatch(by.voice, /unread|ch-chan-ind/, 'a read channel stays as it is');
  assert.match(by.__general__, /^ unread"[^]*aria-label="1 unread"><\/i>/);
  // The same tally as Activity's section counts.
  const L = rows.filter(s => f.inChannel({ id: 'launch', agent: 'hermes' }, s));
  assert.equal(f.env.window.WizChatsListModel.unreadThreads(L, s => !!s.fresh), 2);
});

test('working, archived and snoozed-last rows are not unread posts (Activity rule)', () => {
  const rows = [row('a', 1, { fresh: true, status: 'running' }), row('b', 1, { fresh: true, archived: true }), row('c', 1, { fresh: true, deferred: true })];
  const f = fixture();
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

test('reading a post (markSeen clears isNew) clears both the feed marker and the channel line on the next paint', () => {
  const a = row('a', 1, { fresh: true, messageCount: 2 }), rows = [a];
  const f = fixture();
  assert.match(f.channelsBody(f.w, rows), /ch-chan-dot new/);
  a.fresh = false;                                    // what LIVE.markSeen does to isNew when the thread opens
  assert.doesNotMatch(f.channelsBody(f.w, rows), /ch-chan-dot new| unread"/);
  f.openChannel(f.w, 'launch');
  assert.doesNotMatch(f.channelFeed(f.w, f.chanOpen(f.w), rows), /unread|new repl/);
});

test('unread marks follow each row\'s own agent: main and routed (host-profile, container, restricted) alike', () => {
  const rows = [row('h1', 1, { fresh: true, owner: 'host' }), row('k1', 1, { fresh: true, owner: 'container' }), row('r1', 1, { owner: 'restricted' }), row('a', 1, { fresh: true })];
  const f = fixture({ agents: { h1: 'host', k1: 'container', r1: 'restricted' } });
  const chans = Object.fromEntries(f.channelsBody(f.w, rows).split(/<div class="ch-chan(?=[ "])/).slice(1).map(c => [c.match(/data-chchan="([^"]+)"/)[1], c]));
  for (const k of ['host-ops', 'box', 'launch']) assert.match(chans[k], /^ unread"[^]*aria-label="1 unread"/, k);
  assert.doesNotMatch(chans.locked, /ch-chan-dot new/, 'read restricted chat');
  // A main chat that shares the routed id is not counted in the routed channel.
  const twin = [row('h1', 1, { fresh: true, owner: 'hermes' })];
  const ho = f.channelsBody(f.w, twin).split(/<div class="ch-chan(?=[ "])/).slice(1).find(c => c.includes('data-chchan="host-ops"'));
  assert.doesNotMatch(ho, /ch-chan-dot new/);
});

test('switch off: none of the unread markup is drawn (channels are not drawn at all)', () => {
  const f = fixture({ on: false });
  assert.equal(f.channelsOn(), false);
  assert.equal(f.chanOpen(f.w), null);
});

test('opening a post repaints every open feed at once (the desktop list pane beside the thread); switch off: nothing', () => {
  const f = fixture();
  f.env.CH.w = {}; f.env.elOf = () => ({});
  f.chanSeenPaint(); assert.deepEqual(f.renders, [], 'no feed open: no paint');
  f.openChannel(f.w, 'launch'); f.renders.length = 0;
  f.chanSeenPaint(); assert.deepEqual(f.renders, ['list']);
  f.env.holdList = () => true; f.renders.length = 0;
  f.chanSeenPaint(); assert.deepEqual(f.renders, [], 'a held list keeps the hold (it repaints when let go)');
  f.env.holdList = () => false; f.setOn(false); f.renders.length = 0;
  f.chanSeenPaint(); assert.deepEqual(f.renders, []);
  assert.match(src, /LIVE\.markSeen\(typeof chanSeenRow === 'function' \? chanSeenRow\(wid, sid\) : sid\); if \(typeof chanSeenPaint === 'function'\) chanSeenPaint\(\);/, 'openChat marks the window\'s own row, then paints');
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
  f.env._rowOf = () => routed; f.setOn(false);
  assert.equal(f.chanSeenRow('w', 'h1'), 'h1', 'switch off: the id, as today');
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

test('issue 1263: unread posts, it opens at the first unread under one "New" line that holds its place as posts fill in', () => {
  const f = fixture({ spacesList: longSpaces(120) }), rows = manyRows(120, 104);
  f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w), html = f.channelFeed(f.w, open, rows);
  assert.equal(html.match(/class="ch-chan-new"/g)?.length, 1, 'one New line');
  assert.match(html, /data-morph-key="chan-new"><span>New<\/span><\/div><div class="ch-post unread" data-morph-key="post:p104"/, 'directly above the first unread post');
  const d = feedDom(html); f.env.elOf = () => d.el;
  const lineY = () => d.nodes.find(n => n.dataset.morphKey === 'chan-new').getBoundingClientRect().top;
  f.chanHold('w'); assert.equal(lineY(), 8, 'the New line near the top of the view');
  d.grow('post:p10', 400); d.grow('post:p103', 180);
  f.chanHold('w'); assert.equal(lineY(), 8, 'posts above filled in: the line did not move');
  // Reading the posts does not take the line away while the channel is open; the next open does.
  for (const r of rows) r.fresh = false;
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
    const f = fixture({ agents: { [tid]: agent } });
    f.w.focus = { kind: 'agent', key: agent }; f.openChannel(f.w, sp);
    const html = f.channelFeed(f.w, f.chanOpen(f.w), [row(tid, 2, { owner: 'hermes', fresh: true }), row(tid, 1, { owner: agent, agent, fresh: true })]);
    assert.equal(f.w.chan.newKey, agent + '|' + tid, agent + ': the routed row, never the main one sharing its id');
    assert.match(html, /ch-chan-new/);
  }
});

test('issue 1263: every list paint and every rerender put the feed back in its place; switch off: nothing moves', () => {
  assert.match(src, /if \(sc\) sc\.scrollTop = 0; if \(typeof chanHold === 'function'\) chanHold\(w\.id\); \} \}/, 'rerenderList');
  assert.match(src, /if \(chanOn && typeof chanHold === 'function'\) chanHold\(w\.id\);/, 'renderChatList, only with the switch on');
  assert.match(src, /if \(typeof chanScrolled === 'function'\) chanScrolled\(id, e\.target\)/, 'the list scroll listener');
  const f = fixture({ on: false }); f.w.chan = { id: 'launch', prev: null, at: { end: true } };
  const d = feedDom(''); f.env.elOf = () => d.el; f.chanUser('w'); d.sc.scrollTop = 5; f.chanScrolled('w', d.sc);
  assert.deepEqual({ ...f.w.chan.at }, { end: true }, 'switch off: scrolls are not read');
});

test('issue 1263: the tap that opens an unread channel and the hold\'s own scroll never replace the New line as the place', () => {
  const f = fixture({ spacesList: longSpaces(120) }), rows = manyRows(120, 104);
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
  const f = fixture({ spacesList: longSpaces(120) }), rows = manyRows(120, 104);
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
test('issue 1269: viewing, scrolling to the end, Back, re-entering and a reload never clear a green dot', () => {
  const f = fixture({ spacesList: longSpaces(30) }), rows = manyRows(30, 2);
  for (const r of rows) r.owner = 'hermes';
  f.openChannel(f.w, 'launch');
  const d = seenDom(f, f.channelFeed(f.w, f.chanOpen(f.w), rows));
  f.chanHold('w');                                                   // opens at the New line: posts on screen
  f.chanUser('w'); d.sc.scrollTop = d.sc.scrollHeight - d.sc.clientHeight; f.chanScrolled('w', d.sc); f.chanHold('w');
  assert.deepEqual(f.marks, [], 'the feed writes no seen record');
  assert.equal(rows.filter(r => r.fresh).length, 28, 'every unread post is still unread');
  f.channelBack(f.w);
  assert.match(f.channelsBody(f.w, rows), /aria-label="28 unread"/, 'Back: the channel still has its green dot');
  f.openChannel(f.w, 'launch');
  const again = f.channelFeed(f.w, f.chanOpen(f.w), rows);
  assert.equal(again.match(/class="ch-post-st new"/g)?.length, 28, 're-entered: every green dot is there');
  f.w.chan = JSON.parse(JSON.stringify(f.w.chan));                   // a reload restores the saved window
  assert.equal(f.channelFeed(f.w, f.chanOpen(f.w), rows).match(/class="ch-post-st new"/g)?.length, 28, 'and after a reload');
  assert.doesNotMatch(src, /LIVE\.markSeen\?\.\(\[\.\.\.out\.values\(\)\]\)|function chanSeeNow/, 'the feed-driven seen writer is gone');
});

test('issue 1269: opening one post clears only that post (the per-chat seen path Activity uses), and the channel updates', () => {
  const f = fixture({ spacesList: longSpaces(20) }), rows = manyRows(20, 17);
  f.openChannel(f.w, 'launch'); seenDom(f, f.channelFeed(f.w, f.chanOpen(f.w), rows)); f.chanHold('w');
  f.env._rowOf = (_, sid) => rows.find(r => r.id === sid);
  f.env.LIVE.markSeen([f.chanSeenRow('w', 'p18')]);                     // what openChat does: LIVE.markSeen(chanSeenRow(wid, sid))
  assert.deepEqual(f.marks, ['p18']);
  const html = f.channelFeed(f.w, f.chanOpen(f.w), rows), post = id => html.split(/<div class="ch-post(?=[ "])/).find(p => p.includes(`data-morph-key="post:${id}"`));
  assert.doesNotMatch(post('p18'), /ch-post-st new/, 'the opened post is read');
  for (const id of ['p17', 'p19']) assert.match(post(id), /ch-post-st new/, id + ' keeps its dot');
  f.channelBack(f.w);
  assert.match(f.channelsBody(f.w, rows), /aria-label="2 unread"/, 'the channel counts what is still unread');
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

test('issue 1266: unread is a green dot and needs-you an amber one in Channels, on every skin; Activity keeps its own dot', () => {
  const f = fixture(); f.channelClick(click({ 'data-chchanx': 'launch' }), 'w', f.w);
  const html = f.channelsBody(f.w, [row('a', 1, { fresh: true }), row('b', 2, { attention: { state: 'needs_you' }, fresh: true })]);
  assert.match(html, /class="ch-chan-post unread" data-chopen="a"><span>T a<\/span><span class="ch-chan-ind"><i class="ch-chan-dot new" role="img" aria-label="Unread"><\/i><\/span>/);
  assert.match(html, /data-chopen="b"><span>T b<\/span><span class="ch-chan-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you"><\/i><i class="ch-chan-dot new" role="img" aria-label="Unread"><\/i><\/span>/, 'amber, then green');
  const css = readFileSync(new URL('../web/tweaks/wizard/chat-channels/tweak.css', import.meta.url), 'utf8');
  const rules = css.split('\n').filter(l => /unread|ch-chan-ind|ch-chan-new|ch-chan-dot\.new|ch-post-st\.new|ch-post-r span/.test(l));
  assert.ok(rules.length >= 5);
  for (const l of rules) assert.doesNotMatch(l, /--violet/, 'no violet unread marks: ' + l.slice(0, 90));
  assert.match(css, /--ch-new: var\(--green\)/, 'the skin\'s own green');
  assert.match(css, /oklch\(from var\(--green\) l c 150\)/, 'held on a green hue where a skin\'s green is gold (Ember)');
  assert.match(css, /\.ch-chan-dot\.new \{[^}]*background: var\(--ch-new\)/, 'the green dot: the skin\'s full green, never a dark mix');
  assert.match(css, /\.ch-post-st\.new \{[^}]*color: var\(--ch-new\)/, 'the feed\'s "New reply" words in that green');
  assert.match(css, /\.ch-chan-ind \{[^}]*margin-left: auto/, 'one right-aligned slot');
  assert.doesNotMatch(css, /\.ch-chan-n\b|\.ch-post-r \.st\.unread/, 'issue 1269: no number pill, no left-side dot');
  assert.match(css, /\.ch-chan-dot \{[^}]*background: var\(--amber\)/, 'needs you stays amber');
  assert.match(css, /\.ch-post-r\.unread span:not\(\.ch-post-st\) \{[^}]*color: var\(--ink\)/, '"N new replies" in ink');
  assert.ok(css.split('\n').every(l => !/\.st\.unread/.test(l)), 'Activity\'s .st.unread is untouched');
  // Grove's unread dot was gold like its needs-you dot; its green token is not.
  const skins = readFileSync(new URL('../web/core/skins.js', import.meta.url), 'utf8'), grove = skins.slice(skins.indexOf("id: 'grove'"), skins.indexOf("id: 'tide'"));
  assert.notEqual(grove.match(/ green: '([^']+)'/)[1], grove.match(/ amber: '([^']+)'/)[1]);
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

test('issue 1287 main vs routed: host-profile, container and restricted agent posts render the same markdown', async () => {
  const inline = realInline();
  for (const [chan, agent, sid] of [['launch', '', 'a'], ['host-ops', 'host', 'h1'], ['box', 'container', 'k1'], ['locked', 'restricted', 'r1']]) {
    const k = agent ? `${agent}|${sid}` : sid, s = row(sid, 1, { owner: agent });
    const f = fixture({ agents: { [sid]: agent }, history: { [k]: [{ role: 'assistant', text: `**Alert for ${agent || 'main'}.** _soon_`, at: NOW - H }] }, sessions: { [agent ? k : sid]: s } });
    f.env.KIT.inline = inline; f.openChannel(f.w, chan);
    f.channelFeed(f.w, f.chanOpen(f.w), [s]); await settle();
    const html = f.channelFeed(f.w, f.chanOpen(f.w), [s]);
    assert.match(html, new RegExp(`class="ch-post-t"><strong>Alert for ${agent || 'main'}\\.</strong> <em>soon</em><`), `${agent || 'main'}: bold and italics`);
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
