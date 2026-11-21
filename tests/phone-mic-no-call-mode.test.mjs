// ux#1705 (Miguel, 21 Nov 2026): on a phone, echo cancellation / noise suppression / auto gain (and plain
// {audio:true}, which turns echo cancellation on) open the mic as a voice-call stream: music and podcasts from other
// apps pause or drop to call quality, and Bluetooth earbuds switch to the headset profile. Every phone mic request
// (shell orb + pre-warm, desktop voice, app capture and its permission probes) goes out with all three off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('shell orb mic (open + 90 ms pre-warm) asks for a plain mic on phones', () => {
  const app = src('app-mic.js');
  assert.match(app, /const stream = await navigator\.mediaDevices\.getUserMedia\(\{ audio: micAudio\(\) \}\);/);
  assert.match(app, /const w = MW = \{ p: openMic\(\) \}/, 'the pre-warm goes through openMic');
  const micAudio = navigator => new Function('navigator', `${fn(app, 'micAudio')}; return micAudio;`)(navigator);
  for (const [label, userAgent, maxTouchPoints] of phones) assert.deepEqual(micAudio({ userAgent, maxTouchPoints })(), PLAIN, label);
  assert.equal(micAudio({ userAgent: MAC, maxTouchPoints: 0 })().echoCancellation, true, 'desktop keeps its constraints');
});

test('desktop voice BASE is plain on phones', () => {
  const v = src('core/voice.js');
  const base = navigator => new Function('navigator', `${v.slice(v.indexOf('  const PHONE ='), v.indexOf('  const BASE =') + v.slice(v.indexOf('  const BASE =')).indexOf('};') + 2)}; return BASE;`)(navigator);
  for (const [label, userAgent, maxTouchPoints] of phones) assert.deepEqual(base({ userAgent, maxTouchPoints }), PLAIN, label);
  assert.deepEqual(base({ userAgent: MAC, maxTouchPoints: 0 }), { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } });
  assert.match(v, /getUserMedia\(\{ audio: \{ \.\.\.BASE, deviceId/);
  assert.match(v, /getUserMedia\(\{ audio: BASE \}\)/);
});

test('app capture: default, caller constraints and both permission probes are plain on phones', () => {
  const c = src('core/app-capture.js');
  assert.match(c, /s\.stream = await navigator\.mediaDevices\.getUserMedia\(\{ audio: micAudio\(s\.opts\.audio\) \}\);/);
  assert.equal((c.match(/getUserMedia\(\{ audio: micAudio\(true\) \}\)/g) || []).length, 2, 'both probes');
  assert.doesNotMatch(c, /getUserMedia\(\{ audio: true \}\)/);
  const plainOnly = c.match(/getUserMedia\(\{[^)]*\)/g).filter(x => !/micAudio\(/.test(x));
  assert.deepEqual(plainOnly, [], 'every getUserMedia goes through micAudio');
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
