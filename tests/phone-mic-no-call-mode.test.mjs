// ux#1705 (Miguel, 21 Nov 2026): on a phone, echo cancellation / noise suppression / auto gain (and plain
// {audio:true}, which turns echo cancellation on) open the mic as a voice-call stream: music and podcasts from other
// apps pause or drop to call quality, and Bluetooth earbuds switch to the headset profile. Every phone mic request
// (shell orb + pre-warm, desktop voice, app capture and its permission probes) goes out with all three off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { partScope, runPartRecording } from './fixtures/r5A-parts.mjs';

const src = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const PLAIN = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } };
const PIXEL = 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36 WizardOS-Android/0.10.56';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function fn(code, name) {
  const at = code.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} present`);
  let depth = 0, i = code.indexOf('{', at);
  for (; i < code.length; i++) { if (code[i] === '{') depth++; else if (code[i] === '}' && --depth === 0) break; }
  return code.slice(at, i + 1);
}
const phones = [['Android app', PIXEL, 0], ['iPhone', IPHONE, 5], ['iPad (desktop UA)', IPAD, 5]];

test('shell orb mic (open + 90 ms pre-warm) asks for a plain mic on phones', async () => {
  const app = src('app-mic.js');
  // the real mic part (app-mic.js): the 90 ms pre-warm opens the mic with the plain constraints
  for (const [label, userAgent, maxTouchPoints] of [...phones, ['desktop', MAC, 0]]) {
    const asked = [];
    const scope = partScope({ navigator: { userAgent, maxTouchPoints, mediaDevices: { getUserMedia: async c => { asked.push(JSON.parse(JSON.stringify(c))); return { getTracks: () => [] }; } },
      permissions: { query: async () => ({ state: 'granted' }) } }, MediaRecorder: function () {} });
    const mic = await runPartRecording('app-mic.js', 'appParts', 'mic', { V: { state: 'idle' }, DEV: () => null, device: scope.document.createElement('div'), $: () => scope.document.createElement('div') }, scope);
    await new Promise(r => setImmediate(r));   // the permission answer
    mic.out.warmMic();
    assert.equal(asked.length, 1, label + ': the pre-warm opens the mic');
    if (label === 'desktop') assert.equal(asked[0].audio.echoCancellation, true, 'desktop keeps its constraints');
    else assert.deepEqual(asked[0], { audio: PLAIN }, label + ': the pre-warm goes through openMic, plain');
  }
  const micAudio = navigator => new Function('navigator', `${fn(app, 'micAudio')}; return micAudio;`)(navigator);
  for (const [label, userAgent, maxTouchPoints] of phones) assert.deepEqual(micAudio({ userAgent, maxTouchPoints })(), PLAIN, label);
  assert.equal(micAudio({ userAgent: MAC, maxTouchPoints: 0 })().echoCancellation, true, 'desktop keeps its constraints');
});

test('desktop voice BASE is plain on phones', async () => {
  const v = src('core/voice.js');
  const base = navigator => new Function('navigator', `${v.slice(v.indexOf('  const PHONE ='), v.indexOf('  const BASE =') + v.slice(v.indexOf('  const BASE =')).indexOf('};') + 2)}; return BASE;`)(navigator);
  for (const [label, userAgent, maxTouchPoints] of phones) assert.deepEqual(base({ userAgent, maxTouchPoints }), PLAIN, label);
  assert.deepEqual(base({ userAgent: MAC, maxTouchPoints: 0 }), { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } });
  // the real openMic: the picked mic and the default both ask with BASE
  for (const [label, userAgent, maxTouchPoints] of phones) for (const id of ['wired-1', null]) {
    const asked = [];
    const M = runRecording(`${between(v, '  const PHONE =', '  async function monoFor')}\n${block(v, '  async function openMic() {')}\nthis.openMic = openMic;`,
      { navigator: { userAgent, maxTouchPoints, mediaDevices: { getUserMedia: async c => { asked.push(JSON.parse(JSON.stringify(c))); return {}; } } }, pickMic: async () => id });
    await M.openMic();
    assert.deepEqual(asked, [{ audio: id ? { ...PLAIN, deviceId: { exact: id } } : PLAIN }], `${label}, ${id || 'default'} mic`);
  }
});

test('app capture: default, caller constraints and both permission probes are plain on phones', async () => {
  const c = src('core/app-capture.js');
  // the real capture paths: the browser engine, the Android recorder's permission probe and the meetings probe
  const paths = async (userAgent, maxTouchPoints, audio) => {
    const asked = [], gum = async c => { asked.push(JSON.parse(JSON.stringify(c))); return { getTracks: () => [{ stop() {} }] }; };
    const nav = { userAgent, maxTouchPoints, mediaDevices: { getUserMedia: gum } };
    const C = runRecording(`${block(c, '  function phoneMic() {')}\n${between(c, '  const PLAIN_MIC = ', '\n')}\n${block(c, '  function micAudio(asked) {')}
${block(c, '  async function browserEngine(s) {')}\n${block(c, '  function deviceAdapter(d) {')}\n${block(c, '  function meetingAdapter(b) {')}
this.run = { browserEngine, deviceAdapter, meetingAdapter };`, { W: { navigator: nav }, navigator: nav, ownedRows: new Map(), recoveryLive: new Set(), unknownMeetingActive: false,
      fail: (code, m) => Object.assign(new Error(m), { code }), externalMic: async () => true, JSON, Blob });
    await C.run.browserEngine({ opts: { audio } }).catch(() => {});
    const ids = ['', 'n1'];
    await C.run.deviceAdapter({ recActive: () => 'null', recStart: () => ids.shift() }).start({ kind: 'app' }, {}, null).catch(() => {});
    let tries = 0;
    await C.run.meetingAdapter({ status: async () => null, start: async () => { if (!tries++) throw Object.assign(new Error('p'), { code: 'mic_permission' }); return {}; } })
      .start({ meta: { meetingId: 'm1' } }, { chunk() {} }, null).catch(() => {});
    return asked;
  };
  const caller = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 };
  for (const [label, userAgent, maxTouchPoints] of phones) {
    assert.deepEqual(await paths(userAgent, maxTouchPoints, caller), [{ audio: { ...PLAIN, sampleRate: 48000 } }, { audio: PLAIN }, { audio: PLAIN }], label + ': caller constraints and both permission probes');
    assert.deepEqual((await paths(userAgent, maxTouchPoints, undefined))[0], { audio: PLAIN }, label + ': default');
  }
  assert.deepEqual(await paths(MAC, 0, undefined), [{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }, { audio: true }, { audio: true }], 'desktop: as asked');
  const make = navigator => new Function('W', `${fn(c, 'phoneMic')}; ${c.match(/  const PLAIN_MIC = [^\n]+/)[0]}; ${fn(c, 'micAudio')}; return micAudio;`)({ navigator });
  for (const [label, userAgent, maxTouchPoints] of phones) {
    const m = make({ userAgent, maxTouchPoints });
    assert.deepEqual(m(undefined), PLAIN, label + ' default');
    assert.deepEqual(m(true), PLAIN, label + ' probe');
    assert.deepEqual(m({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 }), { ...PLAIN, sampleRate: 48000 }, label + ' caller');
  }
  const desk = make({ userAgent: MAC, maxTouchPoints: 0 });
  assert.deepEqual(desk(undefined), { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  assert.equal(desk(true), true);
});

test('no mic request in the web shell asks for echo cancellation on a phone', () => {
  for (const p of ['app-mic.js', 'core/voice.js', 'core/app-capture.js']) assert.doesNotMatch(src(p), /getUserMedia\(\{ audio: \{ echoCancellation: true/, p);
});
