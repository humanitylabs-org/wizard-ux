// wizard-ux#1218: a voice note goes to the model selected at the Send tap, not the one selected when the take started.
// The destination stays pinned to where recording started; only the model is read live.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const phone = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const section = (a, b) => { const i = phone.indexOf(a); assert.ok(i >= 0, a); return phone.slice(i, phone.indexOf(b, i)); };
const code = section('  function sealTarget() {', '  // A take that sends nothing') + section('  function finishVoice() {', '  async function cancelVoice(');

const SONNET = {model: 'claude-sonnet', provider: 'anthropic'}, OPUS = {model: 'claude-opus', provider: 'anthropic'};
function run({snap, replyTo = null, selected, failing = false}) {
  const asked = [], saved = [], toasts = [];
  let sent = null;
  const V = {state: 'listen', kind: 'auto', snap, replyTo, target: null, sim: false, rec: null, native: '', parts: [{}], acc: 0, t0: 0, seal: null};
  const c = {V, parking: false, paintVoiceDestination() {}, W: {chats: {app: 'chats'}}, performance: {now: () => 0}, console,
    CHATS: {modelRoute: (wid, sid) => { asked.push([wid, sid]); if (failing) return null; return typeof selected === 'function' ? selected(wid, sid) : selected; },
      takeComposer: () => ({text: '', files: []})},
    window: {WosModels: {snapshot: (sid, choice, agent) => ({model: 'agent-default', provider: 'agent-provider', agent}), load() {}}},
    micNeverOpened() {}, finishDictation() {}, pauseCommandCapture() {}, quickTake: () => true, leaveOnSend() {},
    saveVoiceRoute: (id, r) => saved.push([id, r]), setVoice() {}, txPill() {}, toast: (...a) => toasts.push(a),
    onRecStop: () => { sent = structuredClone(V.snap.route); }, nativeFinish() {}};
  vm.createContext(c); vm.runInContext(code + '\nfinishVoice();', c);
  return {sent, asked, saved, toasts};
}

test('thread take: model changed while recording is the one that receives the voice note', () => {
  const r = run({snap: {view: {id: 'chats', kind: 'chat thread', thread: 'sid-1'}, route: SONNET}, selected: OPUS});
  assert.deepEqual(r.sent, OPUS);
  assert.deepEqual(r.asked.at(-1), ['chats', 'sid-1'], 'route read for the thread pinned at record start');
});

test('composer-mic reply reads the model of the reply thread at Send', () => {
  const r = run({snap: {view: {id: 'other', kind: 'app'}, route: SONNET}, replyTo: {wid: 'chats', sid: 'sid-2'}, selected: OPUS});
  assert.deepEqual(r.sent, OPUS);
  assert.deepEqual(r.asked.at(-1), ['chats', 'sid-2']);
});

test('new chat take reads the new-chat selector at Send', () => {
  const r = run({snap: {view: {id: 'chats', kind: 'thread list', thread: ''}, route: SONNET}, selected: OPUS});
  assert.deepEqual(r.sent, OPUS);
  assert.deepEqual(r.asked.at(-1), ['chats', '__new__']);
});

test('general take reads the new-chat selector of the chats window it started in', () => {
  const r = run({snap: {general: true, view: null, conversation: null, newChatWid: 'chats', route: SONNET}, selected: OPUS});
  assert.deepEqual(r.sent, OPUS);
  assert.deepEqual(r.asked.at(-1), ['chats', '__new__']);
});

test('explicit agent pick keeps its own agent even if the front window is the main agent', () => {
  const r = run({snap: {general: true, view: null, conversation: null, newChatWid: 'chats', route: {model: 'agent-default', provider: 'agent-provider', agent: 'philosopher'}}, selected: OPUS});
  assert.equal(r.sent.agent, 'philosopher');
});

test('selector unreadable at Send (catalogue loading): the route from record start is kept', () => {
  const r = run({snap: {view: {id: 'chats', kind: 'chat thread', thread: 'sid-1'}, route: SONNET}, selected: null, failing: true});
  assert.deepEqual(r.sent, SONNET);
});

test('no route at start and none at Send: nothing is sent, the owner is asked to choose a model', () => {
  const r = run({snap: {view: {id: 'chats', kind: 'chat thread', thread: 'sid-1'}, route: null}, selected: null, failing: true});
  assert.equal(r.sent, null);
  assert.match(r.toasts.at(-1)[1], /Choose a model/);
});
