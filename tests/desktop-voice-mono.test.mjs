// Desktop voice notes are recorded mono (4 Nov 2026): the Mac app's WKWebView hands the mono Mac mic over as stereo
// with a silent right channel, which every player and speech-to-text averages down to half volume.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../web/core/voice.js', import.meta.url), 'utf8');
function load(devices = []) {
  const window = {};
  const ctx = { window, navigator: { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15', mediaDevices: { enumerateDevices: async () => devices } }, crypto: { randomUUID: () => "x" }, setTimeout, setInterval, clearInterval, Promise, Float32Array, Math };
  vm.runInNewContext(src, ctx);
  return window.WizCore.voice;
}
function fakeAc(state = 'running', rightPeak = 0) {
  const edges = []; let gains = 0;
  const node = name => ({ name, connect(to, out) { edges.push([name, to.name, out]); } });
  return { edges, get state() { return state; }, close() { state = 'closed'; }, resume: async () => {},
    createMediaStreamSource: () => node('src'), createChannelSplitter: () => node('split'),
    createGain: () => ({ ...node(gains++ ? 'right' : 'left'), gain: { value: 1 } }),
    createAnalyser: () => ({ ...node('probe'), fftSize: 0, getFloatTimeDomainData(b) { b.fill(rightPeak); } }),
    createMediaStreamDestination: () => ({ ...node('out'), stream: { mono: true } }) };
}
const stream = n => ({ getAudioTracks: () => [{ getSettings: () => ({ channelCount: n }) }] });

test('a silent right channel is dropped: the left one is recorded at full level', async () => {
  const ac = fakeAc(); const out = await load().monoFor(stream(2), ac);
  assert.deepEqual(out, { mono: true });
  assert.deepEqual(ac.edges, [['src', 'split', undefined], ['split', 'left', 0], ['split', 'right', 1], ['left', 'out', undefined], ['right', 'out', undefined], ['split', 'probe', 1]]);
  await new Promise(r => setTimeout(r, 250)); ac.close();
});

test('a real stereo mic is averaged, never summed into clipping', async () => {
  const ac = fakeAc('running', 0.3); const gains = [];
  const g = ac.createGain; ac.createGain = () => { const n = g(); gains.push(n.gain); return n; };
  await load().monoFor(stream(2), ac);
  assert.deepEqual(gains.map(x => x.value), [1, 0]);
  await new Promise(r => setTimeout(r, 250));
  assert.deepEqual(gains.map(x => x.value), [0.5, 0.5]);
  ac.close();
});

test('mono tracks and a context that will not run record the raw stream', async () => {
  const v = load();
  assert.equal(await v.monoFor(stream(1), fakeAc()), null);
  assert.equal(await v.monoFor(stream(2), fakeAc('suspended')), null);
  assert.equal(await v.monoFor(stream(2), null), null);
});

test('desktop picks the computer mic over a Bluetooth default, and never a virtual input', async () => {
  const v = load([
    { kind: 'audioinput', deviceId: 'default', label: 'Default - AirPods Pro' },
    { kind: 'audioinput', deviceId: 'bt', label: 'AirPods Pro' },
    { kind: 'audioinput', deviceId: 'bh', label: 'BlackHole 2ch' },
    { kind: 'audioinput', deviceId: 'imac', label: 'iMac Microphone' },
  ]);
  assert.equal(await v.pickMic(), 'imac');
  assert.equal(await load([{ kind: 'audioinput', deviceId: 'sd', label: 'Studio Display Microphone' }, { kind: 'audioinput', deviceId: 'bt', label: 'AirPods' }]).pickMic(), 'sd');
  assert.equal(await load([{ kind: 'audioinput', deviceId: 'bh', label: 'BlackHole 2ch' }, { kind: 'audioinput', deviceId: 'bt', label: 'AirPods Pro' }]).pickMic(), null);
});
