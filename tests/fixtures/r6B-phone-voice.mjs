// The phone shell's real startVoice (web/app.js and its parts, put back by tests/fixtures/shell-parts.mjs) in node:vm
// (wizard-ux issue 1674: tests run the code). Every shell name the test does not give is a recorder
// (tests/fixtures/source-slice.mjs); openRec records what the take already holds at the moment the browser is asked
// for the microphone, and resolves when the test says so.
import { readFileSync } from 'node:fs';
import { withShellParts } from './shell-parts.mjs';
import { block, runRecording } from './source-slice.mjs';

export const phone = withShellParts(readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8'));

// snap: what sendSnap() returns at the tap; window: extra window modules (WizAppCapture, WosOrbHandoff ...).
export function phoneVoice({ snap = null, window = {}, V = {}, extra = {} } = {}) {
  const seen = [], opens = [];
  const ctx = {
    V: { state: 'idle', admitting: false, ...V }, parking: false, parkedReply: null, window: { ...window },
    performance: { now: () => 1000 }, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0,
    store: { get: () => true, set() {} }, CHATS: { incognitoActive: () => false, modelRoute: () => ({ model: 'm', provider: 'p' }) },
    sendSnap: () => (snap ? structuredClone(snap) : null), generalVoiceSnap: () => (snap ? structuredClone(snap) : null),
    setVoice: s => { ctx.V.state = s; },
    openRec: () => { seen.push(JSON.parse(JSON.stringify({ snap: ctx.V.snap, replyTo: ctx.V.replyTo, kind: ctx.V.kind }))); return new Promise(r => opens.push(r)); },
    ...extra,
  };
  runRecording(block(phone, '  async function startVoice(kind, opt = {}) {') + '\nglobalThis.startVoice = startVoice;', ctx);
  return { ctx, V: ctx.V, seen, open: () => opens.forEach(r => r(true)), calls: ctx.calls };
}
