// Settings → Microphone (James, 18 Oct 2026): phone mic by default; a person can choose any mic or remember a
// specific one per phone, all from the page, so new choices never need a native update or an agent rewrite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settingsWorld } from './fixtures/r5A-settings.mjs';
import { pageAssets } from './fixtures/w1-pages.mjs';

const src = readFileSync(new URL('../web/core/mic.js', import.meta.url), 'utf8');

function load(state) {
  const saved = [];
  const window = {
    WizardOSDevice: {
      micPolicy: () => JSON.stringify(state),
      setMicPolicy(json) { const p = JSON.parse(json); saved.push(p); state.policy = p; return JSON.stringify(p); },
    },
  };
  new Function('window', src)(window);
  return { M: window.WosMic, saved, state };
}
const btn = (mic, mici) => ({ closest: sel => (sel === '[data-mic]' ? { dataset: { mic, mici: mici == null ? undefined : String(mici) } } : null) });
const ctx = () => { const t = []; return { t, toast: (...a) => t.push(a), render() {}, haptic() {} }; };
const inputs = [{ type: 'builtin_mic', name: 'Pixel', address: '' }, { type: 'bluetooth_sco', name: 'Jabra Elite', address: '11:22' }];

test('hidden where the shell cannot choose its mic (desktop, older Android app)', () => {
  const window = {}; new Function('window', src)(window);
  assert.equal(window.WosMic.available(), false);
  assert.equal(window.WosMic.html(), '');
});

test('defaults to phone mic only and offers connected Bluetooth mics', () => {
  const { M } = load({ v: 1, policy: { v: 1, mode: 'phone' }, inputs });
  const h = M.html();
  assert.match(h, /Phone mic only<\/b>.*aria-checked="true"|data-mic="phone" role="radio" aria-checked="true"/);
  assert.match(h, /Use Jabra Elite when connected/);
  assert.doesNotMatch(h, /Use Pixel/);
});

test('choosing a headset remembers it on this phone and puts it first', () => {
  const { M, saved } = load({ v: 1, policy: { v: 1, mode: 'phone' }, inputs });
  assert.equal(M.act(btn('prefer', 1), ctx()), true);
  assert.deepEqual(saved.at(-1), { v: 1, mode: 'prefer', prefer: [{ type: 'bluetooth_sco', name: 'Jabra Elite', address: '11:22' }] });
  assert.match(M.html(), /Use Jabra Elite<\/b><small>Connected/);
});

test('forgetting the last remembered mic returns to phone only', () => {
  const { M, saved } = load({ v: 1, policy: { v: 1, mode: 'prefer', prefer: [inputs[1]] }, inputs: [inputs[0]] });
  assert.match(M.html(), /Not connected · phone mic until it is/);
  M.act(btn('forget', 0), ctx());
  assert.deepEqual(saved.at(-1), { v: 1, mode: 'phone' });
});

test('any connected mic and back to phone', () => {
  const { M, saved } = load({ v: 1, policy: { v: 1, mode: 'phone' }, inputs });
  M.act(btn('any'), ctx()); assert.equal(saved.at(-1).mode, 'any');
  M.act(btn('phone'), ctx()); assert.equal(saved.at(-1).mode, 'phone');
});

// The real Settings (tests/fixtures/r5A-settings.mjs) with the real mic.js on this page: the Voice page shows the
// Microphone group right after the Voice card, and a tap on it reaches the phone's mic policy. Both shells load mic.js.
function settingsWithMic({ device = true } = {}) {
  const w = settingsWorld({ shell: 'phone', scope: { WizCore: { voiceStatus: { card: () => '<div class="st-group" data-voice-card><h4>Voice</h4></div>', state: { ready: true } } } } });
  const saved = [];
  if (device) w.s.WizardOSDevice = { micPolicy: () => JSON.stringify({ v: 1, policy: { v: 1, mode: 'phone' }, inputs }), setMicPolicy: j => { saved.push(JSON.parse(j)); return j; } };
  new Function('window', src)(w.s);
  w.W.refresh();
  return { w, saved, groups: () => w.open('voice').querySelectorAll('.st-group').map(g => g.querySelector('h4') ? w.text(g.querySelector('h4')) : w.text(g).slice(0, 20)) };
}

test('Settings registers the Microphone group next to Voice', () => {
  const m = settingsWithMic();
  assert.deepEqual(m.groups(), ['Voice', 'Microphone'], 'Microphone sits right after the Voice card on the Voice page');
  assert.equal(m.w.W.features.find(f => f.id === 'microphone')?.page, 'voice');
  m.w.root.querySelector('[data-mic="any"]').click();
  assert.deepEqual(m.saved, [{ v: 1, mode: 'any' }], 'a tap in Settings sets the phone\'s mic policy');
  assert.deepEqual(settingsWithMic({ device: false }).groups(), ['Voice'], 'no Microphone group where the shell cannot choose');
  for (const f of ['index.html', 'desktop.html']) { const { srcs } = pageAssets(f); assert.ok(srcs.includes('core/mic.js') && srcs.includes('core/settings.js'), `${f} loads mic.js with Settings`); }
});
