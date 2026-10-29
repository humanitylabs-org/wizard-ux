// Settings → Microphone (James, 18 Oct 2026): phone mic by default; a person can choose any mic or remember a
// specific one per phone, all from the page, so new choices never need a native update or an agent rewrite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('Settings registers the Microphone group next to Voice', () => {
  const s = readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
  assert.ok(s.indexOf("id: 'microphone'") > s.indexOf("id: 'voice'"));
  assert.ok(s.indexOf("id: 'microphone'") < s.indexOf("id: 'cancelled'"));
  for (const f of ['index.html', 'desktop.html']) assert.match(readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8'), /core\/mic\.js/);
});
