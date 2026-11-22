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
  assert.match(body, /const aimSid = vFeedback\?\.thread \|\| rp\?\.sid/);
  assert.match(body, /CHATS\.sendVoiceTo\(rp\.wid, rp\.sid/);
  assert.match(body, /OUTBOX\.handOff\?\.\(stagedId\)/);
});
