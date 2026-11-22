import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRecording } from './fixtures/source-slice.mjs';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';

const desktop = withDesktopParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));

function normalDesktopVoiceSend() {
  const start = desktop.indexOf('    const rp = vReply;');
  const end = desktop.indexOf('  // Composer mic:', start);
  assert.notEqual(start, -1, 'desktop voice-send start exists');
  assert.notEqual(end, -1, 'desktop voice-send end exists');
  return desktop.slice(start, end);
}

// The send step of a desktop voice take (desktop.js talk('send'), from `const rp = vReply;` on), run with a recorded
// outbox: the one recording goes to the outbox's transcription lane; the shell never transcribes it itself.
async function voiceSend(extra = {}) {
  const calls = [];
  const OUTBOX = { stage: async o => { calls.push(['stage', o]); return { id: 'staged-1' }; }, handOff: async id => { calls.push(['handOff', id]); return true; }, enqueue: async o => { calls.push(['enqueue', o]); return { state: 'queued' }; } };
  const ctx = runRecording(`this.send = async function () {\n${normalDesktopVoiceSend()}`, {
    vReply: null, vFeedback: null, vTarget: 'w1', vSnapshot: { view: { kind: 'chat thread' }, thread: 's1' }, vNewChat: false, vBox: undefined, vConversation: null, vFiles: null, vSpace: null,
    vRoute: null, vRouteAt: () => ({ model: 'm', provider: 'p' }), vContext: '', vHandedOff: null, strictReply: false, forceNew: false, commandTake: false, dictationFinishing: false,
    W: { w1: { id: 'w1', app: 'chats', thread: 's1' } }, OUTBOX, VOICE: { finish: async o => { calls.push(['finish', o]); return { blob: 'AUDIO', captureId: 'cap-1' }; } },
    CHATS: { takeComposer: () => null, sendChat: (...a) => calls.push(['sendChat', ...a]), sendVoiceTo: (...a) => calls.push(['sendVoiceTo', ...a]) },
    window: { WizConfig: { transcribe: (...a) => calls.push(['transcribe', ...a]) }, WizUploads: null }, AbortSignal: { timeout: ms => calls.push(['timeout', ms]) }, ...extra }, calls);
  return { result: await ctx.send(), calls };
}

test('desktop voice send hands one retained take directly to the outbox transcription lane', async () => {
  const { result, calls } = await voiceSend();
  assert.equal(result, 'sent');
  const names = calls.map(c => c[0]);
  assert.deepEqual(names.filter(n => ['finish', 'stage', 'handOff', 'sendChat'].includes(n)), ['finish', 'stage', 'handOff', 'sendChat'], 'one take: recorded, staged, handed off, sent into its thread');
  assert.deepEqual({ ...calls.find(c => c[0] === 'finish')[1] }, { transcribe: false }, 'the recorder does not transcribe');
  const staged = calls.find(c => c[0] === 'stage')[1];
  assert.equal(staged.audio, 'AUDIO'); assert.equal(staged.captureId, 'cap-1'); assert.equal(staged.sessionId, 's1');
  assert.deepEqual(calls.find(c => c[0] === 'handOff'), ['handOff', 'staged-1']);
  const chat = calls.find(c => c[0] === 'sendChat');
  assert.equal(chat[1], 'w1'); assert.equal(chat[2], '', 'no foreground transcript'); assert.equal(chat[5].custodyId, 'staged-1', 'custodyId: the staged take');
  assert.equal(chat[5].captureId, null, 'the outbox owns the capture now');
  assert.ok(!names.includes('transcribe'), 'the shell must not start a second foreground STT request before the outbox transcribes');
  assert.ok(!names.includes('timeout'), 'the obsolete 45-second foreground deadline must not turn slow STT into a retry banner');
});
