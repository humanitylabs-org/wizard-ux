// Desktop voice notes are recorded mono (4 Nov 2026): the Mac app's WKWebView hands the mono Mac mic over as stereo
// with a silent right channel, which every player and speech-to-text averages down to half volume.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../web/core/voice.js', import.meta.url), 'utf8');
function load(devices = []) {
  const window = {};
  const ctx = { window, navigator: { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15', mediaDevices: { enumerateDevices: async () => devices } }, crypto: { randomUUID: () => 'x' }, setTimeout, Promise };
  vm.runInNewContext(src, ctx);
  return window.WizCore.voice;
}
function fakeAc(state = 'running') {
  const edges = []; const node = name => ({ name, connect(to, out) { edges.push([name, to.name, out]); } });
  return { edges, state, resume: async () => {}, createMediaStreamSource: () => node('src'), createChannelSplitter: () => node('split'),
    createGain: () => node('sum'), createMediaStreamDestination: () => ({ ...node('out'), stream: { mono: true } }) };
}
const stream = n => ({ getAudioTracks: () => [{ getSettings: () => ({ channelCount: n }) }] });

test('a stereo track is summed into one channel, both sides kept', async () => {
  const ac = fakeAc(); const out = await load().monoFor(stream(2), ac);
  assert.deepEqual(out, { mono: true });
  assert.deepEqual(ac.edges, [['src', 'split', undefined], ['split', 'sum', 0], ['split', 'sum', 1], ['sum', 'out', undefined]]);
});

test('mono tracks and a context that will not run record the raw stream', async () => {
  const v = load();
  assert.equal(await v.monoFor(stream(1), fakeAc()), null);
  assert.equal(await v.monoFor(stream(2), fakeAc('suspended')), null);
  assert.equal(await v.monoFor(stream(2), null), null);
});

test('desktop never falls back to a Bluetooth default when a computer mic exists', async () => {
  const v = load([
    { kind: 'audioinput', deviceId: 'default', label: 'Default - AirPods Pro' },
    { kind: 'audioinput', deviceId: 'bt', label: 'AirPods Pro' },
    { kind: 'audioinput', deviceId: 'imac', label: 'iMac Microphone' },
  ]);
  assert.equal(await v.pickMic(), 'imac');
  assert.equal(await load([{ kind: 'audioinput', deviceId: 'mbp', label: 'MacBook Pro Microphone' }, { kind: 'audioinput', deviceId: 'bt', label: 'AirPods' }]).pickMic(), 'mbp');
  assert.equal(await load([{ kind: 'audioinput', deviceId: 'bt', label: 'AirPods Pro' }]).pickMic(), null);
});
