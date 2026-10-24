// A main thread and a routed agent thread can share one id. Every watcher control must act on the row the owner
// pressed, never on whichever owner an id-only lookup happens to find first.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const ROUTED = 'qa-routed';

function slice(source, from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a > 0 && b > a, `source block ${from}`);
  return source.slice(a, b);
}

function harness({ stopped = 1 } = {}) {
  const main = { id: 'X', status: 'completed', followUp: { active: true, count: 1 } };
  const routed = { id: 'X', agent: ROUTED, status: 'completed', followUp: { active: true, count: 1 } };
  const calls = [];
  const ctx = {
    main, routed, calls, J: {}, DETAIL: new Map(), AGENT_OF: new Map([['X', ROUTED]]),
    otherAgent: a => !!a && a !== 'hermes',
    setTimeout: () => 0,
    req: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { json: async () => ({ ok: true, stopped }) }; },
  };
  vm.createContext(ctx);
  const rows = slice(live, '    session(id) {', '    chatUrl(id)');
  const stop = slice(live, '    async stopWatching(id, agent) {', '    async _defer(id, deferred)');
  const agentOf = slice(live, '    agentOf(id) {', '    pinAgent(id, agent)');
  vm.runInContext(`this.LIVE = { sessions: [main], agentSessions: { '${ROUTED}': [routed] }, busy() { return false; }, emit() {}, refresh() {},
${agentOf}${rows}${stop} };`, ctx);
  return ctx;
}

test('the id-only pin map points at the routed agent, the shape that used to misroute main Stop', () => {
  const h = harness();
  assert.equal(h.LIVE.agentOf('X'), ROUTED);
  assert.equal(h.LIVE.session('X'), h.main, 'an id-only read still resolves the main row first');
});

test('rows resolve inside the window owner: main and routed never borrow each other', () => {
  const h = harness();
  assert.equal(h.LIVE.sessionFor('X', ''), h.main);
  assert.equal(h.LIVE.sessionFor('X', ROUTED), h.routed);
  assert.equal(h.LIVE.sessionFor('X', 'qa-other'), null);
  assert.equal(h.LIVE.ownerOf(h.main), '');
  assert.equal(h.LIVE.ownerOf(h.routed), ROUTED);
  assert.equal(h.LIVE.ownerOf({ id: 'X' }), '', 'an unlisted row without an agent is main');
  const listed = { id: 'Y' }; h.LIVE.agentSessions[ROUTED].push(listed);
  assert.equal(h.LIVE.ownerOf(listed), ROUTED, 'list membership names the owner even without a row agent field');
});

test('main Stop watching on a same-id thread cancels only the main watcher', async () => {
  const h = harness();
  assert.equal(await h.LIVE.stopWatching('X', ''), true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/wizard/follow-ups/stop');
  assert.deepEqual({ ...h.calls[0].body }, { session_id: 'X' }, 'no routed agent_id rides on a main stop');
  assert.equal(h.main.followUp, null);
  assert.equal(h.routed.followUp.active, true, 'the routed watcher is untouched');
});

test('routed Stop watching on a same-id thread cancels only the routed watcher', async () => {
  const h = harness();
  assert.equal(await h.LIVE.stopWatching('X', ROUTED), true);
  assert.deepEqual({ ...h.calls[0].body }, { session_id: 'X', agent_id: ROUTED });
  assert.equal(h.routed.followUp, null);
  assert.equal(h.main.followUp.active, true, 'the main watcher is untouched');
});

test('a zero-count stop is a failure and keeps the watcher visible', async () => {
  const h = harness({ stopped: 0 });
  assert.equal(await h.LIVE.stopWatching('X', ROUTED), false);
  assert.equal(h.routed.followUp.active, true);
});

test('Chats windows resolve their own row before acting and Stop scopes to that row\'s owner', () => {
  const winAgent = slice(chats, '  function winAgent(w) {', '  function agentRec(id) {');
  const W = { mainWin: { id: 'mainWin', app: 'chats' }, routedWin: { id: 'routedWin', app: 'chats', agent: ROUTED },
    focusedWin: { id: 'focusedWin', app: 'chats', focus: { kind: 'agent', key: ROUTED } } };
  // focusOf mirrors chats.js: a window focused on an agent lists that agent's rows.
  const ctx = { LIVE: harness().LIVE, W, owner: id => id, AGS: () => ({ isOther: a => !!a && a !== 'hermes' }),
    focusOf: w => (w?.focus && ['agent', 'space'].includes(w.focus.kind) ? w.focus : null) };
  const mainOnly = { id: 'M', status: 'completed' }; ctx.LIVE.sessions.push(mainOnly);
  vm.createContext(ctx);
  vm.runInContext(`${winAgent}\nthis.api = { winAgent, rowOf };`, ctx);
  assert.equal(ctx.api.rowOf('mainWin', 'X'), ctx.LIVE.sessions[0]);
  assert.equal(ctx.api.rowOf('routedWin', 'X'), ctx.LIVE.agentSessions[ROUTED][0]);
  assert.equal(ctx.api.rowOf('focusedWin', 'X'), ctx.LIVE.agentSessions[ROUTED][0], 'an agent-focused window resolves the routed row');
  assert.equal(ctx.api.rowOf('focusedWin', 'M'), mainOnly, 'a main thread opened while an agent is focused keeps its main row');
  assert.equal(ctx.LIVE.ownerOf(ctx.api.rowOf('focusedWin', 'M')), '', 'so its Stop carries no routed scope');
  // Every watcher-visible surface reads the window's row, and Stop carries that row's own owner.
  assert.match(chats, /async function threadAct\(wid, sid, a\) \{\n    wid = owner\(wid\);\n    const s = rowOf\(wid, sid\);/);
  assert.match(chats, /LIVE\.stopWatching\(sid, LIVE\.ownerOf \? LIVE\.ownerOf\(s\) : undefined\)/);
  assert.match(chats, /function openRowSheet\(wid, sid\) \{\n    const s = rowOf\(wid, sid\)/);
  assert.match(chats, /s = isNew \? null : rowOf\(w\.id, w\.thread\)/);
});
