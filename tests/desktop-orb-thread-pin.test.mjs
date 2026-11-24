import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';

const root = process.env.QA_SOURCE || new URL('..', import.meta.url).pathname;
const source = withShellParts(readFileSync(resolve(root, 'web/desktop/desktop.js'), 'utf8'));
const adapter = source.slice(source.indexOf('mountHost: () => stage,'));
const expression = adapter.match(/^\s*talk: (.+),$/m)?.[1];
assert.ok(expression, 'real desktop skin-host talk adapter exists');

const cases = [
  ['open Chats thread', { id: 'chat', app: 'chats', thread: 'original' }, false, 'context'],
  ['hosted Chats thread', { id: 'hosted', app: 'frame', thread: 'original' }, true, 'context'],
  ['Chats list', { id: 'chat', app: 'chats', thread: '' }, false, 'new'],
  ['New chat', { id: 'chat', app: 'chats', thread: '__new__' }, false, 'new'],
  ['hosted Chats list', { id: 'hosted', app: 'frame' }, true, 'new'],
  ['hosted New chat', { id: 'hosted', app: 'frame', thread: '__new__' }, true, 'new'],
  ['Home', { id: 'home', app: 'home' }, false, 'new'],
  ['no foreground window', null, false, 'new'],
  ['other app with thread-like metadata', { id: 'app', app: 'frame', thread: 'original', from: { sid: 'original' } }, false, 'new'],
  ['voice-input app', { id: 'app', app: 'frame', appId: 'fixture-capture', receives_voice_input: true }, false, 'new'],
];
for (const [label, foreground, hosted, action] of cases) {
  test(`idle orb preserves scope: ${label} -> ${action}`, () => {
    const calls = [], original = structuredClone(foreground);
    const talk = vm.runInNewContext(`(${expression})`, {
      VOICE: { state: 'idle' }, focused: () => foreground,
      CHATS: { isHosted: id => !!id && hosted },
      talk: (...args) => calls.push(['context', ...args]),
      talkNew: (...args) => calls.push(['new', ...args]),
    });
    talk();
    assert.deepEqual(calls, action === 'context' ? [['context']] : [['new', 'Click the orb']]);
    assert.deepEqual(foreground, original, 'adapter never mutates owner/app state');
  });
}
for (const state of ['listen', 'paused', 'think']) {
  test(`non-idle orb keeps existing stop-only send in ${state}`, () => {
    const calls = [];
    const talk = vm.runInNewContext(`(${expression})`, {
      VOICE: { state }, focused: () => { throw Error('in-flight take must not read current focus'); },
      talk: (...args) => calls.push(['context', ...args]),
      talkNew: (...args) => calls.push(['new', ...args]),
    });
    talk();
    assert.deepEqual(calls, [['context', 'send']]);
  });
}

test('contextual recorder freezes thread, active run and model route before voice capture', async () => {
  const start = source.indexOf('  async function talk(');
  const body = source.slice(start, source.indexOf('  // Composer mic:', start));
  // run the real talk() on the desktop with a working Chats thread in front; the microphone start reads what is frozen
  const route = { model: 'm1', provider: 'p1' }, frozen = {};
  const ctx = runRecording(block(source, '  async function talk(') + '\nglobalThis.talk = talk;', {
    MOD: '⌥', dictationFinishing: false, vMode: 'talk', vConversation: null, vFeedback: null, W: { w1: {} }, APP: {},
    focused: () => ({ id: 'w1', app: 'chats', thread: 't1' }), chanFront: () => null, commandSnapshot: () => ({ thread: 't1', view: 'chats' }),
    viewContext: () => 'the open thread', $: () => ({}), toast: (...a) => ctx.calls.push(['toast', ...a]),
    LIVE: { session: id => (id === 't1' ? { runId: 'run_7' } : null) },
    CHATS: { incognitoActive: () => false, isHosted: () => false, chanSpaceOf: () => null, isWorking: () => true, modelRoute: (wid, sid) => { ctx.calls.push(['modelRoute', wid, sid]); return route; }, uploadFile() {} },
    window: { WosCaptureTools: { take: () => ({ close() {} }) }, WosModels: { snapshot: () => null } },
    VOICE: { state: 'idle', start: async () => { Object.assign(frozen, JSON.parse(JSON.stringify({ snapshot: ctx.vSnapshot, reply: ctx.vReply, route: ctx.vRoute }))); throw Object.assign(new Error('stop here'), { code: 'test' }); } },
  });
  assert.equal(await ctx.talk('toggle'), 'none');
  assert.deepEqual(frozen.snapshot, { thread: 't1', view: 'chats' }, 'the thread is frozen before capture');
  assert.deepEqual(frozen.reply, { wid: 'w1', sid: 't1', steerRunId: 'run_7' }, 'the active run is frozen before capture');
  assert.deepEqual(frozen.route, route, 'the model route is frozen before capture');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.calls.find(c => c[0] === 'modelRoute'))), ['modelRoute', 'w1', 't1']);
  // a forced new chat freezes no reply target
  ctx.VOICE.state = 'idle'; Object.keys(frozen).forEach(k => delete frozen[k]);
  await ctx.talk('toggle', true);
  assert.equal(frozen.reply, null); assert.equal(frozen.snapshot.thread, '__new__');
  // ... and the send step (real talk('send') from `const rp = vReply;` on) goes to exactly that frozen thread.
  const sendStep = source.slice(source.indexOf('    const rp = vReply;'), source.indexOf('  // Composer mic:', start));
  const send = async (extra = {}) => {
    const calls = [];
    const OUTBOX = { stage: async o => { calls.push(['stage', JSON.parse(JSON.stringify(o))]); return { id: 'staged-1' }; }, handOff: async id => { calls.push(['handOff', id]); return true; }, enqueue: async o => { calls.push(['enqueue', o]); return { state: 'queued' }; } };
    const c = runRecording(`this.send = async function () {\n${sendStep}`, {
      vReply: null, vFeedback: null, vTarget: 'w1', vSnapshot: { view: { kind: 'chat thread' }, thread: 't1' }, vNewChat: false, vBox: undefined, vConversation: null, vFiles: null, vSpace: null,
      vRoute: route, vRouteAt: () => route, vContext: '', vHandedOff: null, strictReply: false, forceNew: false, commandTake: false, dictationFinishing: false,
      W: { w1: { id: 'w1', app: 'chats', thread: 't1' } }, OUTBOX, VOICE: { finish: async () => ({ blob: 'AUDIO', captureId: 'cap-1' }) },
      CHATS: { takeComposer: () => null, sendChat: (...x) => calls.push(['sendChat', ...x]), sendVoiceTo: (...x) => calls.push(['sendVoiceTo', ...x]) },
      window: { WizConfig: {}, WizUploads: null, WosBoundView: { feedback: async (...x) => (calls.push(['feedback', x[1]?.thread]), { state: 'sent' }) } }, toast() {}, ...extra }, calls);
    await c.send(); return calls;
  };
  const replied = await send({ vReply: { wid: 'w1', sid: 't1', steerRunId: 'run_7' }, vSnapshot: { view: { kind: 'chat thread' }, thread: 't2' } }); // another thread in front by Send
  const voiceTo = replied.find(c => c[0] === 'sendVoiceTo');
  assert.deepEqual([voiceTo[1], voiceTo[2], voiceTo[3]], ['w1', 't1', 'AUDIO'], 'the frozen reply target gets the take');
  assert.equal(voiceTo[7], 'staged-1', 'as the staged take'); assert.equal(voiceTo[9], 'run_7', 'steering the frozen run');
  assert.deepEqual(replied.find(c => c[0] === 'handOff'), ['handOff', 'staged-1'], 'handed to the outbox before Reload');
  assert.equal(replied.find(c => c[0] === 'stage')[1].sessionId, 't1');
  const fed = await send({ vFeedback: { thread: 't9' } });
  assert.equal(fed.find(c => c[0] === 'stage')[1].sessionId, 't9', 'a feedback take aims at its own thread');
});
