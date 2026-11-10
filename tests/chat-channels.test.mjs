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
function fixture({ on = true, rows = [], spacesList, agents = {} } = {}) {
  const spacesData = spacesList || [
    { id: 'launch', name: 'Launch', threads: ['a', 'b', 'c'] },
    { id: 'voice', name: 'Voice', threads: ['d'] },
    { id: 'host-ops', name: 'Host ops', agent: 'host', threads: ['h1'] },
    { id: 'box', name: 'Box', agent: 'container', threads: ['k1'] },
    { id: 'locked', name: 'Locked', agent: 'restricted', threads: ['r1'] },
  ];
  const wins = { w: { id: 'w', thread: null, focus: null } };
  const store = new Map(), renders = [], focusCalls = [];
  const agentOf = id => agents[id] || '';
  const env = {
    document: { documentElement: { dataset: { tweaks: on ? 'wizard/desktop-chats wizard/chat-channels' : 'wizard/desktop-chats' } } },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    requestAnimationFrame: () => {}, Date: class extends Date { static now() { return NOW; } },
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
    LIVE: { agentOf, cardAt: s => new Date(s.at).toISOString() },
    AGS: () => ({ defaultId: () => 'hermes', isPrivate: a => a.id === 'restricted', sigil: a => `<i class="ag-sig" data-agent="${a.id}"></i>` }), agentRec: id => ({ id }),
    orderBar: (label, attr, orders, cur, word) => `<div class="ch-rdy-bar" aria-label="${label}">${orders.map(o => `<button ${attr}="${o}" aria-pressed="${cur === o}">${word(o)}</button>`).join('')}</div>`,
  };
  vm.createContext(env);
  vm.runInContext(block + ';this.api={channelsOn,chanOpen,channelsFor,inChannel,chanName,openChannel,channelBack,channelsBody,channelFeed,chanHead,channelClick,get view(){return chanView}};', env);
  return { ...env.api, get view() { return env.api.view; }, w: wins.w, rows, renders, focusCalls, store, env };
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

test('Channels lists Spaces in stored order, General last, with one aggregate marker each', () => {
  const rows = [row('a', 1, { status: 'running' }), row('b', 2, { attention: { state: 'needs_you' } }), row('d', 3, { status: 'running' }), row('g', 4), row('old', 40, { archived: true })];
  const f = fixture();
  assert.deepEqual(f.channelsFor(f.w).map(c => c.name), ['Launch', 'Voice', 'Host ops', 'Box', 'Locked', 'General']);
  const html = f.channelsBody(f.w, rows);
  const chans = html.split('class="ch-chan"').slice(1);
  assert.deepEqual(chans.map(c => c.match(/data-chchan="([^"]+)"/)[1]), ['launch', 'voice', 'host-ops', 'box', 'locked', '__general__']);
  assert.match(chans[0], /ch-chan-dot[^>]*Needs you/, 'needs you beats working');
  assert.doesNotMatch(chans[0], /aria-label="Working"/);
  assert.match(chans[1], /aria-label="Working"/);
  assert.doesNotMatch(chans[5], /ch-chan-dot|ch-spin/, 'General: g is done, so no marker');
  assert.doesNotMatch(html, /<time>/, 'no timestamps or previews on channel lines');
});

test('the chevron expands working, needs-you and last-24h posts, newest first; tapping one opens the thread', () => {
  const rows = [row('a', 30, { status: 'running' }), row('b', 2), row('c', 50), row('g', 1)];
  const f = fixture();
  assert.equal(f.channelClick(click({ 'data-chchanx': 'launch' }), 'w', f.w), true);
  const html = f.channelsBody(f.w, rows);
  const launch = html.split('class="ch-chan"')[1];
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
  assert.ok(!html.includes(long));
  f.channelClick(click({ 'data-chpostmore': 'a' }), 'w', f.w);
  assert.ok(f.channelFeed(f.w, open, rows).includes(long));
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
  assert.match(src, /const spaceKey = isNew && !opts\.away && focusOf\(w\)\?\.kind === 'space' \? focusOf\(w\)\.key : '';/);
  assert.match(src, /if \(spaceKey && it\?\.sessionId\) spaceMember\(spaceKey, it\.sessionId, true\);/);
  // Back on the desktop list goes through clearFilter, which closes a feed after search and chips.
  assert.match(src, /if \(!c\.filter\) return typeof channelBack === 'function' && channelBack\(w\) \? 'channel' : false;/);
});
