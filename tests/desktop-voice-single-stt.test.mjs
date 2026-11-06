import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');

function normalDesktopVoiceSend() {
  const start = desktop.indexOf('    const rp = vReply;');
  const end = desktop.indexOf('  // Composer mic:', start);
  assert.notEqual(start, -1, 'desktop voice-send start exists');
  assert.notEqual(end, -1, 'desktop voice-send end exists');
  return desktop.slice(start, end);
}

test('desktop voice send hands one retained take directly to the outbox transcription lane', () => {
  const source = normalDesktopVoiceSend();
  assert.match(source, /OUTBOX\.stage\(/);
  assert.match(source, /OUTBOX\.handOff/);
  assert.match(source, /custodyId: stagedId/);
  assert.doesNotMatch(source, /WizConfig\.transcribe/,
    'the shell must not start a second foreground STT request before the outbox transcribes');
  assert.doesNotMatch(source, /AbortSignal\.timeout\(45000\)/,
    'the obsolete 45-second foreground deadline must not turn slow STT into a retry banner');
});
