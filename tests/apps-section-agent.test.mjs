// wizard-ux issue 2007: an agent opened from the phone Apps panel (or the Apps sheet, the nine bubbles, the Apps
// sideways swipe) opens in the Apps section as its own window, locked to that agent, like any other app. The main Chats
// window keeps its list, Focus and thread. Browser proof: tests/qa-apps-section-agent.cjs.
// 1. openApp(agent tile) places an agent-locked Chats window ({ app: 'chats', agent }) and never touches main Chats;
//    the Chats switcher, the Agents app and links still go through openAgentChats (Chats' own Focus).
// 2. That window survives a reload on the phone (migrateChatsFocus keepAgents); the desktop still folds old ones.
// 3. The Apps sideways swipe steps through an agent's chats like any recent app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';

const phone = withShellParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));
const slice = (code, from, to) => { const a = code.indexOf(from), b = code.indexOf(to, a); assert.ok(a > 0 && b > a, `${from.trim()} found`); return code.slice(a, b); };

function shell() {
  const W = { main: { id: 'main', app: 'chats', thread: 'main-1', focus: null } }, calls = [];
  const AG = { get: id => (['philosopher', 'private'].includes(id) ? { id } : null), load: async () => {} };
  const ctx = vm.createContext({
    window: { WosAgents: AG }, APP: {}, CHATS: { views: { defaultId: () => 'wizard-chats', providerFor: () => 'wizard-chats' }, setFocus: (w, f) => calls.push('focus ' + w.id + ' ' + JSON.stringify(f)) },
    LIVE: null, toast() {}, closeSheets() {}, HOME: 0, appVars: { idx: 1 }, mainChats: w => w.app === 'chats' && !w.agent,
    placeApp(mine, obj) { const here = Object.values(W).find(mine); if (here) { calls.push('reuse ' + here.id); return here; } const w = { id: 'w' + Object.keys(W).length, ...obj }; W[w.id] = w; calls.push('open ' + JSON.stringify(obj)); return w; },
  });
  const code = slice(phone, '  async function openAgentChats(', '  window.WosAppSetup?.init(') + slice(phone, '  function openApp(a, extra = {}, opts = {}) {', '  /* Move an open window to where a new app would open');
  vm.runInContext(code.replace('window.WizOpenAgentChats = openAgentChats;', '') + '\nthis.openApp = openApp; this.openAgentChats = openAgentChats;', ctx);
  return { W, calls, ctx };
}

test('an agent tile opens its own agent-locked window; main Chats keeps its thread and Focus', async () => {
  const s = shell();
  assert.equal(await s.ctx.openApp({ id: 'agent:philosopher', kind: 'chats', agent: 'philosopher' }), true);
  assert.deepEqual(s.calls, ['open {"app":"chats","agent":"philosopher","thread":null}']);
  assert.deepEqual(s.W.main, { id: 'main', app: 'chats', thread: 'main-1', focus: null }, 'main Chats untouched');
  // Opened again (Recent, Favorites, the swipe): the same window comes back, nothing new.
  await s.ctx.openApp({ id: 'agent:philosopher', kind: 'chats', agent: 'philosopher' });
  assert.equal(s.calls.at(-1), 'reuse w1');
  await s.ctx.openApp({ id: 'agent:private', kind: 'chats', agent: 'private' });
  assert.equal(s.calls.at(-1), 'open {"app":"chats","agent":"private","thread":null}', 'each agent its own window');
  assert.ok(!s.calls.some(c => c.startsWith('focus')), 'no Focus set on any window');
  assert.equal(await s.ctx.openApp({ id: 'agent:gone', kind: 'chats', agent: 'gone' }), false, 'an agent not on this Wizard opens nothing');
});

test('the Chats switcher, Agents app and links keep focusing the agent in main Chats', async () => {
  const s = shell();
  await s.ctx.openAgentChats('philosopher');
  assert.deepEqual(s.calls, ['reuse main', 'focus main {"kind":"agent","key":"philosopher"}']);
});

test('the phone keeps agent windows through a reload; the desktop still folds them into main Chats', () => {
  const ctx = vm.createContext({ window: {} }); ctx.window.window = ctx.window; vm.createContext(ctx.window);
  vm.runInContext('window.WizCore = {};' + slice(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'), 'window.WizCore.migrateChatsFocus', '/* Channel emoji'), ctx.window);
  const mk = () => ({ wins: { m: { id: 'm', app: 'chats' }, a: { id: 'a', app: 'chats', agent: 'philosopher' } }, desks: [{ id: 'home', home: true, wins: [] }, { id: 'd1', wins: ['m'], focus: 'm' }, { id: 'd2', wins: ['a'], focus: 'a' }] });
  const migrate = o => { const x = mk(), desks = vm.runInContext('WizCore.migrateChatsFocus', ctx.window)(x.wins, x.desks, o); return { desks: desks.map(d => d.id), agent: x.wins.a?.agent || '' }; };
  assert.deepEqual(migrate({ keepAgents: true }), { desks: ['home', 'd1', 'd2'], agent: 'philosopher' }, 'phone (app-seed.js): kept');
  assert.deepEqual(migrate(), { desks: ['home', 'd1'], agent: '' }, 'desktop: the old agent window is folded away');
});

test('the Apps sideways swipe steps through an agent\'s chats like any recent app', () => {
  const src = readFileSync(new URL('../web/app-appspanel.js', import.meta.url), 'utf8');
  const front = slice(src, '  function apFront() {', '  function apStepList() {');
  const list = slice(src, '  function apStepList() {', '  // step +1');
  const APP = { notes: { id: 'notes', kind: 'wizard', url: '/notes/' }, 'agent:philosopher': { id: 'agent:philosopher', kind: 'chats', agent: 'philosopher' }, wizard: { id: 'wizard', kind: 'chats' }, messenger: { id: 'messenger', kind: 'wizard', url: '/m/' } };
  const appVars = { desks: [{ id: 'da', wins: ['w1'], focus: 'w1' }], W: { w1: { id: 'w1', app: 'chats', agent: 'philosopher' } } };
  const ctx = vm.createContext({ APP, appVars, CHATS_APP: { id: 'wizard' }, apRecentAll: () => ['agent:philosopher', 'wizard', 'messenger', 'notes'],
    window: { WizCore: { phoneSections: { sections: () => ({ apps: 'da' }), slotId: () => 'messenger' } } } });
  vm.runInContext(front + list + '\nthis.f = apFront; this.l = apStepList;', ctx);
  assert.deepEqual([...ctx.l()], ['agent:philosopher', 'notes']);
  assert.equal(ctx.f(), 'agent:philosopher', 'the agent window in front is that agent\'s tile');
});

test('an agent window stays on its phone: never sent to the box, kept when another device\'s desks arrive', () => {
  const sb = { console, JSON, Map, Set, Math, Date, setTimeout() {}, clearTimeout() {}, addEventListener() {}, navigator: { userAgent: 'iPhone' }, localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(readFileSync(new URL('../web/core/features.js', import.meta.url), 'utf8'), { window: sb });
  sb.window = sb; vm.runInNewContext(readFileSync(new URL('../web/core/workspace-sync.js', import.meta.url), 'utf8'), sb);
  const S = sb.WosWorkspaceSync, plain = x => JSON.parse(JSON.stringify(x));
  const agentWin = { id: 'a1', app: 'chats', agent: 'philosopher' }, music = { id: 'm1', app: 'frame', appId: 'music' };
  assert.deepEqual(plain(S.norm({ desks: [{ id: 'd2', wins: [agentWin] }, { id: 'd3', wins: [music] }] })).desks, [{ id: 'd3', wins: [{ id: 'm1', app: 'frame', appId: 'music' }] }], 'only Music travels');
  const W = { a1: agentWin, m1: music }, local = [{ id: 'home', home: true, wins: [] }, { id: 'd2', wins: ['a1'], focus: 'a1' }, { id: 'd3', wins: ['m1'], focus: 'm1' }];
  const r = S.reconcile(local, W, { desks: [{ id: 'd3', wins: [{ id: 'm1', app: 'frame', appId: 'music' }] }] }, { fresh: id => ({ id, wins: [] }) });
  assert.deepEqual(plain(r.desks).map(d => [d.id, d.wins]), [['home', []], ['d2', ['a1']], ['d3', ['m1']]], 'the agent window keeps its desk');
  assert.deepEqual(plain(r.removed), []);
});
