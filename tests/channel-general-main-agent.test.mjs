// wizard-ux issue 1312: a voice take in #General (no agent picked) goes to the main agent on the model picked in the
// General box. A model or agent left over from another agent's thread (Philosopher), or another agent in front of the
// window by Send, never decides where it goes. Same rule for a routed agent's own channel (host profile, container,
// restricted): the take keeps the channel's agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)

const app = withAppParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));
const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

// Fake model catalogue: an agent's route names its agent; a pick for another agent is not a choice (chat-models.js).
const snapshot = (sid, choice, agent) => agent
  ? { model: choice && choice.agent === agent ? choice.model : agent + '-default', provider: agent + '-p', agent }
  : { model: choice && !choice.agent ? choice.model : 'main-default', provider: 'main-p' };

function tapRoute({ live, newModel }) {
  const ctx = { CHATS: { modelRoute: () => live, boxModel: k => (k ? newModel : null) || null }, window: { WosModels: { snapshot } } };
  vm.createContext(ctx);
  vm.runInContext(cut(app, '  function sendTapRoute(', '  // A take that sends nothing') + ';this.sendTapRoute=sendTapRoute;', ctx);
  return ctx.sendTapRoute;
}

test('phone: a #General take with no agent goes to the main agent on the General box pick', () => {
  const view = { id: 'win', thread: '__new__', space: '', channel: 'General', chanAgent: '' };
  const pin = { wid: 'win', sid: '__new__', box: 'chan::General' };
  const philosopher = { model: 'claude-fable-5-1', provider: 'philosopher-p', agent: 'philosopher' };
  const opus = { model: 'claude-opus', provider: 'main-p' };
  // The reported case: the route from the start of the take and the live read both came out as Philosopher.
  let r = tapRoute({ live: philosopher, newModel: { model: 'claude-opus', provider: 'main-p' } })({ view, route: philosopher }, pin);
  assert.equal(r.agent || '', '', 'never Philosopher');
  assert.equal(r.model, 'claude-opus', 'the model picked in the General box');
  // A stale start route never beats a live pick for the right agent.
  r = tapRoute({ live: opus, newModel: null })({ view, route: philosopher }, pin);
  assert.deepEqual({ ...r }, opus);
  // Nothing picked and both reads point elsewhere: the main agent's default model.
  r = tapRoute({ live: philosopher, newModel: { model: 'claude-fable-5-1', provider: 'philosopher-p', agent: 'philosopher' } })({ view, route: philosopher }, pin);
  assert.deepEqual({ ...r }, { model: 'main-default', provider: 'main-p' });
  // Start route already right, another agent in front by Send: the start route.
  r = tapRoute({ live: philosopher, newModel: null })({ view, route: opus }, pin);
  assert.deepEqual({ ...r }, opus);
});

test('phone: a routed agent\'s channel keeps its agent (host profile, container, restricted)', () => {
  for (const [space, agent] of [['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']]) {
    const view = { id: 'win', thread: '__new__', space, chanAgent: agent };
    const pin = { wid: 'win', sid: '__new__', box: 'chan:' + agent + ':' + space };
    const own = { model: agent + '-picked', provider: agent + '-p', agent };
    const other = { model: 'claude-fable-5-1', provider: 'philosopher-p', agent: 'philosopher' };
    assert.deepEqual({ ...tapRoute({ live: own, newModel: null })({ view, route: other }, pin) }, own, agent + ': live pick for this agent');
    assert.deepEqual({ ...tapRoute({ live: other, newModel: null })({ view, route: own }, pin) }, own, agent + ': start route');
    const r = tapRoute({ live: other, newModel: null })({ view, route: { model: 'claude-opus', provider: 'main-p' } }, pin);
    assert.equal(r.agent, agent, agent + ': its own default, never the main or another agent');
  }
});

// The phone's real viewOf (app-viewvoice.js) for a window showing a channel's feed.
function viewOf({ chan, agent = '' }) {
  const window = { WizCore: {} };
  vm.runInNewContext(readFileSync(new URL('../web/app-viewvoice.js', import.meta.url), 'utf8'), { window });
  const w = { id: 'win', app: 'chats', thread: null };
  const V = window.WizCore.appParts.viewvoice({ appVars: { W: { win: w } }, agentWin: () => false, agentApp: x => ({ agent: x.agent, name: 'Agent ' + x.agent }), mainChats: () => true, winTitle: () => 'Chats', winApp: () => ({}), frameHref: () => '', LIVE: null,
    CHATS: { chanOpen: () => chan, chanBox: id => (id === 'win' ? 'chan:' + agent + ':' + (chan?.id || '') : ''), winAgent: () => agent, isHosted: () => false, ch: () => ({}) } });
  return V.viewOf('win');
}

test('phone viewOf pins the channel\'s agent with the take', () => {
  const general = viewOf({ chan: { id: 'general', name: 'General', general: true } });
  assert.equal(general.thread, '__new__'); assert.equal(general.space, '', '#General files into no Space'); assert.equal(general.chanAgent, '', 'the main agent');
  assert.equal(general.box, 'chan::general'); assert.equal(general.channel, 'General');
  for (const agent of ['host', 'container', 'restricted']) {
    const v = viewOf({ chan: { id: 'ops', name: 'Ops' }, agent });
    assert.equal(v.chanAgent, agent, agent + ': the take keeps the channel\'s agent');
    assert.equal(v.space, 'ops'); assert.equal(v.box, 'chan:' + agent + ':ops'); assert.equal(v.thread, '__new__');
  }
  const list = viewOf({ chan: null });
  assert.equal(list.chanAgent, undefined, 'no channel in front: nothing pinned');
});

test('sendChat: a channel-pinned send files under its route\'s agent, never the window\'s agent by then', () => {
  const lines = cut(chats, '    const chanPinned = ', '    const winAG = ');
  const agid = (opts, winAgent) => vm.runInNewContext(lines + ';AGID', { opts, isNew: true, nm: opts.route || null, winAgent: () => winAgent, AGS: () => ({ isOther: id => id && id !== 'hermes' }), w: {} });
  assert.equal(agid({ space: '', route: { model: 'claude-opus', provider: 'main-p' } }, 'philosopher'), '', 'General: the main agent');
  for (const ag of ['host', 'container', 'restricted']) assert.equal(agid({ space: 'sp', route: { model: 'm', provider: 'p', agent: ag } }, 'philosopher'), ag);
  // Not a channel send: as before (the window's agent).
  assert.equal(agid({ route: { model: 'claude-opus', provider: 'main-p' } }, 'philosopher'), 'philosopher');
  assert.equal(agid({ space: '', agent: 'host', route: { model: 'm', provider: 'p' } }, 'philosopher'), 'host', 'an explicit agent wins');
});

test('sendVoiceTo: a channel-pinned box take files under its route\'s agent', () => {
  const line = cut(power, '    const chanAgent = ', '\n');
  const agent = (pinned, route, nm, winAgent) => vm.runInNewContext(line + ';chanAgent', { pinned, route, nm, w: {}, A: { winAgent: () => winAgent } });
  const opus = { model: 'claude-opus', provider: 'main-p' };
  assert.equal(agent('', opus, opus, 'philosopher'), '', 'General: the main agent');
  assert.equal(agent('sp', { ...opus, agent: 'container' }, null, 'philosopher'), 'container');
  assert.equal(agent(undefined, opus, opus, 'philosopher'), 'philosopher', 'not a channel take: as before');
  // the take's real enqueue call: a new channel take carries the channel's agent; a reply into a thread never does
  const call = block(power, 'OUTBOX.enqueue({ captureId') + ')';
  const queued = (isNew, chanAgent) => { const got = []; runRecording(`this.it = ${call};`, { OUTBOX: { enqueue: o => got.push(JSON.parse(JSON.stringify(o))) }, isNew, chanAgent,
    sealed: { key: 'k', text: 'hi' }, transcript: '', all: [], nm: null, pinned: undefined, wid: 'w', sid: 's1', wasHere: true, instructions: '', captureId: 'c', custodyId: 'u', steerRunId: '' }); return got[0]; };
  assert.equal(queued(true, 'container').agent, 'container', 'a new channel take files under the route\'s agent');
  assert.equal('agent' in queued(true, ''), false, 'General: no agent named (the main agent)');
  assert.equal('agent' in queued(false, 'container'), false, 'a reply goes to its thread\'s own agent');
});
