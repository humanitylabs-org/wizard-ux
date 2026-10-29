import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');

function recordingRecoverySource() {
  const start = desktop.indexOf("  // Recovery is a view of the existing outbox");
  const end = desktop.indexOf('  let dictationFinishing = false;', start);
  assert.notEqual(start, -1, 'recording recovery start exists');
  assert.notEqual(end, -1, 'recording recovery end exists');
  return desktop.slice(start, end);
}

test('retained recordings identify their source, time and size', () => {
  const source = recordingRecoverySource();
  assert.match(source, /LIVE\?\.session\?\.\(it\.sessionId\)\?\.title/);
  assert.match(source, /new Date\(at\)\.toLocaleString\(\)/);
  assert.match(source, /Math\.ceil\(bytes \/ 1024\)/);
  assert.match(source, /class="recording-meta"/);
});

test('retained audio downloads through a connected link with visible feedback', () => {
  const source = recordingRecoverySource();
  assert.match(source, /document\.body\.appendChild\(a\); a\.click\(\); a\.remove\(\);/,
    'some desktop browsers ignore programmatic downloads from detached links');
  assert.match(source, /Audio download requested · check Downloads/);
  assert.match(source, /Audio download failed · recording is still kept/);
});
