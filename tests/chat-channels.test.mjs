// Channels view (wizard/chat-channels, wizard-ux issue 1254): the real block from core/chats.js on fake Spaces/rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); return src.slice(i, src.indexOf(b, i)); };
const block = cut('  /* Channels view (switch wizard/chat-channels', '  function clearAll(w)');

const H = 3600e3, NOW = Date.UTC(2026, 10, 10, 12);
function fixture({ on = true, rows = [], spacesList, agents = {}, history = {}, sessions = {}, owner = 'James de Fleur' } = {}) {
  const spacesData = spacesList || [
    { id: 'launch', name: 'Launch', threads: ['a', 'b', 'c'] },
    { id: 'voice', name: 'Voice', threads: ['d'] },
    { id: 'host-ops', name: 'Host ops', agent: 'host', threads: ['h1'] },
    { id: 'box', name: 'Box', agent: 'container', threads: ['k1'] },
    { id: 'locked', name: 'Locked', agent: 'restricted', threads: ['r1'] },
  ];
  const wins = { w: { id: 'w', thread: null, focus: null } };
  const store = new Map(), renders = [], focusCalls = [], sheets = [], toasts = [], ops = [], reads = [], viewer = [], drafts = [];
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
    LIVE: { agentOf, ownerOf: s => s.owner ?? agents[s.id] ?? '', cardAt: s => new Date(s.at).toISOString(), session: id => sessions[id] || null, sessionFor: (id, a) => sessions[a ? a + '|' + id : id] || null,
      firstMessages: async (id, agent) => { reads.push(agent ? agent + '|' + id : id); const h = history[agent ? agent + '|' + id : id]; if (h instanceof Error) throw h; return h || []; }, prefOps: o => { ops.push(...o); for (const x of o) { const sp = spacesData.find(s => x.key === `spaces/${s.id}/name`); if (sp) sp.name = x.item; } return Promise.resolve(true); } },
    // KIT.parseRows stand-in: a row {role:'user', text, files} is an owner turn.
    toTurns: rows => rows.map(r => r.role === 'user' ? { u: { text: r.text || '', files: r.files || [], images: r.images || [], at: r.at } } : { a: { text: r.text } }),
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
  vm.createContext(env);
  vm.runInContext(block + ';this.api={channelsOn,chanOpen,channelsFor,inChannel,chanName,openChannel,channelBack,channelsBody,channelFeed,chanHead,channelClick,chanSwitchedOff,chanPruned,openChannelSheet,submitChannelRename,firstPost,chanComposer,chanDraftKey,chanSpaceOf,channelSend,CHAN_SENDING,FIRST,CHAN_ARCHIVE_PRUNE_DAYS,get view(){return chanView}};', env);
  const setOn = v => { env.document.documentElement.dataset.tweaks = v ? 'wizard/desktop-chats wizard/chat-channels' : 'wizard/desktop-chats'; };
  return { ...env.api, get view() { return env.api.view; }, w: wins.w, rows, renders, focusCalls, store, env, sheets, toasts, ops, reads, viewer, drafts, setOn, spacesData };
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
  assert.match(chans[2], /ch-chan-dot[^>]*Needs you/, 'needs you beats working');
  assert.doesNotMatch(chans[2], /aria-label="Working"/);
  assert.match(chans[4], /aria-label="Working"/);
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

test('feed filters Open (default) / Needs you / All, posts truncate at about 240 characters with more', () => {
  const long = 'x'.repeat(300);
  const rows = [row('a', 5, { request: long, messageCount: 5 }), row('b', 3, { attention: { state: 'needs_you' }, messageCount: 2 }), row('c', 1, { archived: true })];
  const f = fixture(); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w), ids = h => [...h.matchAll(/class="ch-post-b" data-chopen="([^"]+)"/g)].map(m => m[1]);
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
  assert.match(f.channelFeed(f.w, f.chanOpen(f.w), [row('r1', 1, { status: 'running', messageCount: 3 })]), /data-agent="restricted"[^]*2 replies[^]*Working/);
});

test('posting reuses the Space-fixed-at-send path: a new chat sent from a channel files into its Space Focus', () => {
  assert.match(src, /const spaceKey = isNew && typeof opts\.space === 'string' \? opts\.space : isNew && !opts\.away && focusOf\(w\)\?\.kind === 'space' \? focusOf\(w\)\.key : '';/);
  assert.match(src, /if \(spaceKey && it\?\.sessionId\) spaceMember\(spaceKey, it\.sessionId, true\);/);
  // Back on the desktop list goes through clearFilter, which closes a feed after search and chips.
  assert.match(src, /if \(!c\.filter\) return typeof channelBack === 'function' && channelBack\(w\) \? 'channel' : false;/);
});

const ids = html => [...html.matchAll(/data-chchan="([^"]+)"/g)].map(m => m[1]);
const sheetButtons = html => [...html.matchAll(/data-(rsch\w+)>(?:<svg[^]*?<\/svg>)?([^<]*)</g)].map(m => m[2]);

test('a post is the owner\'s first message with photo thumbnails, never a title card; read once per thread', async () => {
  const history = { a: [{ role: 'user', text: 'Please fix the boot logo\non the phone', files: [{ id: 'f1', name: 'shot.png', mime: 'image/png' }, { id: 'f2', name: 'notes.pdf', mime: 'application/pdf' }], at: NOW - 5 * H }, { role: 'assistant', text: 'On it' }] };
  const sessions = { a: row('a', 5, { messageCount: 3 }) };
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
  assert.match(html, /2 replies/);
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

test('a failed first-message read is not kept: the title stands in, and a repaint after 30 s reads again', async () => {
  const history = { a: new Error('offline') }, s0 = row('a', 2);
  const f = fixture({ history, sessions: { a: s0 } }); f.openChannel(f.w, 'launch');
  const open = f.chanOpen(f.w);
  f.channelFeed(f.w, open, [s0]); await new Promise(r => setImmediate(r));
  const html = f.channelFeed(f.w, open, [s0]); await new Promise(r => setImmediate(r));
  assert.deepEqual(f.reads, ['a'], 'no retry storm within 30 s');
  assert.match(html, /class="ch-post-t">T a</, 'offline: the title rather than an endless skeleton');
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
  assert.match(src, /const key = spaceInFront\(it\.agent \|\| ''\);\n\s*if \(key\) spaceMember\(key, it\.sessionId, true\);/);
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
