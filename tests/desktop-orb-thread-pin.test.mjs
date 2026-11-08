import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = process.env.QA_SOURCE || new URL('..', import.meta.url).pathname;
const source = readFileSync(resolve(root, 'web/desktop/desktop.js'), 'utf8');
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

test('contextual recorder freezes thread, active run and model route before voice capture', () => {
  const start = source.indexOf('  async function talk(');
  const body = source.slice(start, source.indexOf('  // Composer mic:', start));
  const capture = body.indexOf('await VOICE.start()');
  for (const token of ['vSnapshot = commandSnapshot()', 'vReply = !forceNew', 'steerRunId:', 'vRoute = vConversation ? null : resolveRoute()']) {
    assert.ok(body.indexOf(token) >= 0 && body.indexOf(token) < capture, token);
  }
  assert.match(body, /const aimSid = vFeedback\?\.thread \|\| rp\?\.sid/);
  assert.match(body, /CHATS\.sendVoiceTo\(rp\.wid, rp\.sid/);
  assert.match(body, /OUTBOX\.handOff\?\.\(stagedId\)/);
});
