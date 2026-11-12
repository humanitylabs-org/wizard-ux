// wizard-ux#1218 parity: the Send-tap model read works the same for a main thread and for routed host-profile,
// container and restricted threads (and their new chats). Real chat-models.js (WosModels) and the real
// chats.js modelRoute; the phone finishVoice + sendTapRoute run as shipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const phone = read('app.js'), chats = read('core/chats.js'), models = read('core/chat-models.js');
const section = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); return s.slice(i, s.indexOf(b, i)); };
const voice = section(phone, '  function sealTarget() {', '  // A take that sends nothing') + section(phone, '  function finishVoice() {', '  async function cancelVoice(');
const modelRoute = section(chats, 'modelRoute: (wid, sid, box) => ', ', winAgent,').replace('modelRoute: ', '');

const SONNET = 'claude-sonnet-5-5', OPUS = 'claude-opus-5-5';
const KINDS = ['host-profile', 'container', 'restricted'];
async function world() {
  const agents = Object.fromEntries(KINDS.map(k => [k, {id: k, kind: k, label: k, model: {provider: 'routed-' + k, model: SONNET, allowed_models: [SONNET, OPUS]}}]));
  const allows = (a, m) => a.model.allowed_models.includes(m);
  const sessions = {'thread-main': {id: 'thread-main', model: SONNET, provider: 'anthropic'}};
  for (const k of KINDS) sessions['thread-' + k] = {id: 'thread-' + k, model: SONNET, provider: 'routed-' + k, agent: k};
  const window = {
    WosAgents: {isOther: id => id in agents, get: id => agents[id] || null, allows, route: (a, m) => ({model: m && allows(a, m) ? m : a.model.model, provider: a.model.provider, agent: a.id})},
    WizLive: {session: id => sessions[id] || null, agentOf: id => sessions[id]?.agent || ''},
  };
  const fetch = async url => ({ok: true, json: async () => url.includes('model/options')
    ? {provider: 'anthropic', model: SONNET, providers: [{slug: 'anthropic', authenticated: true, models: [SONNET, OPUS]}]} : null});
  vm.runInNewContext(models, {window, fetch, AbortSignal, console});
  await window.WosModels.load();
  const store = {}, W = {};
  const ctx = {window, W, ch: wid => (store[wid] ||= {}), winAgent: w => w?.agent || '', PW: {newModel: c => c.newModel || null}, chanDraftKey: () => '', chanModel: () => null, boxModel: () => null}; // no channel box open (issue 1309)
  vm.createContext(ctx);
  const route = vm.runInContext('(' + modelRoute + ')', ctx);
  return {M: window.WosModels, W, store, route};
}
function send(w, snap, replyTo = null) {
  let sent = null;
  const V = {state: 'listen', kind: 'auto', snap, replyTo, target: null, sim: false, rec: null, native: '', parts: [{}], acc: 0, t0: 0, seal: null};
  const c = {V, parking: false, W: w.W, performance: {now: () => 0}, console, CHATS: {modelRoute: w.route, takeComposer: () => ({text: '', files: []})},
    window: {WosModels: w.M}, micNeverOpened() {}, finishDictation() {}, pauseCommandCapture() {}, quickTake: () => true, leaveOnSend() {},
    saveVoiceRoute() {}, setVoice() {}, txPill() {}, toast() {}, nativeFinish() {}, onRecStop: () => { sent = JSON.parse(JSON.stringify(V.snap.route)); }};
  vm.createContext(c); vm.runInContext(voice + '\nfinishVoice();', c);
  return sent;
}

test('main and routed threads: a model picked while recording answers, the agent stays the thread\'s', async () => {
  const w = await world();
  for (const k of ['main', ...KINDS]) {
    const sid = 'thread-' + k, agent = k === 'main' ? undefined : k;
    w.W.chats = {app: 'chats', thread: sid};
    const snap = {view: {id: 'chats', kind: 'chat thread', thread: sid}, route: w.route('chats', sid)};
    assert.equal(snap.route.model, SONNET, `${k}: start`);
    w.M.selections.set(sid, {model: OPUS, provider: k === 'main' ? 'anthropic' : 'routed-' + k, version: 1}); // picked while recording
    const sent = send(w, snap);
    assert.equal(sent.model, OPUS, `${k}: model at Send`);
    assert.equal(sent.agent, agent, `${k}: agent unchanged`);
    assert.equal(sent.provider, k === 'main' ? 'anthropic' : 'routed-' + k, `${k}: provider`);
  }
});

test('new chat in a main or routed agent window: the new-chat pick at Send answers, on that agent', async () => {
  const w = await world();
  for (const k of ['main', ...KINDS]) {
    const agent = k === 'main' ? '' : k;
    w.W['list-' + k] = {app: 'chats', thread: '__new__', agent};
    const snap = {view: {id: 'list-' + k, kind: 'thread list', thread: ''}, route: w.route('list-' + k, '__new__')};
    assert.equal(snap.route.model, SONNET, `${k}: start`);
    w.store['list-' + k] = {newModel: {model: OPUS, provider: k === 'main' ? 'anthropic' : 'routed-' + k, ...(agent ? {agent} : {})}};
    const sent = send(w, snap);
    assert.equal(sent.model, OPUS, `${k}: new-chat model at Send`);
    assert.equal(sent.agent || '', agent, `${k}: agent unchanged`);
  }
});
