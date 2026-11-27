// Phone media player for Music and Podcasts (wizard-ux issue 1661, switch wizard/lock-screen-player, off by default).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { lookBox } from './fixtures/r5A-experience.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const SWITCH = 'wizard/lock-screen-player';
const origin = 'https://wizard.example';
const APPS = {
  'wizard-music': { url: '/wizard-music/', provides: ['background-audio'] },
  'wizard-podcasts': { url: '/wizard-podcasts/', provides: ['background-audio'] },
  'wizard-notes': { url: '/wizard-notes/', provides: ['background-audio'] },
};

function shell({ on = false } = {}) {
  const sent = [], frames = [], listeners = {};
  const root = { dataset: { tweaks: on ? `wizard/swap-sides ${SWITCH}` : 'wizard/swap-sides' } };
  const c = { location: { origin, href: origin + '/wizard-os-home/' }, URL, console,
    document: { documentElement: root, querySelectorAll: () => frames },
    setTimeout: () => 1, clearTimeout: () => {}, addEventListener: (name, fn) => { listeners[name] = fn; },
    wizardAudioPort: { postMessage: raw => sent.push(JSON.parse(raw)) } };
  c.window = c; vm.createContext(c);
  vm.runInContext(read('web/core/background-audio-legacy.js'), c);
  vm.runInContext(read('web/core/background-audio.js'), c);
  c.WizBackgroundAudio.init(() => APPS, () => true);
  const frame = id => {
    const win = { location: { href: origin + '/' + id + '/' }, document: { documentElement: {} }, postMessage: () => {} };
    frames.push({ contentWindow: win, isConnected: true, hasAttribute: () => false, getAttribute: () => '/' + id + '/' });
    return win;
  };
  return { c, sent, root, frame, listeners };
}

test('switch off: the Android player hears the old single token for every admitted provider (unchanged)', () => {
  const f = shell();
  for (const id of ['wizard-music', 'wizard-podcasts', 'wizard-notes']) {
    const win = f.frame(id);
    assert.equal(f.c.WizBackgroundAudio.frameOk(win, origin), true, id);
    f.c.WizBackgroundAudio.request(win, 'state').catch(() => {});
    assert.equal(f.sent.at(-1).appId, 'wizard-music', id);
  }
});

test('switch on: Music and Podcasts each reach the player under their own id', () => {
  const f = shell({ on: true });
  for (const id of ['wizard-music', 'wizard-podcasts']) {
    const win = f.frame(id);
    assert.equal(f.c.WizBackgroundAudio.frameOk(win, origin), true, id);
    f.c.WizBackgroundAudio.request(win, 'load', { sessionId: 's', queue: [], skip: { back: 15, forward: 30 } }).catch(() => {});
    const m = f.sent.at(-1);
    assert.equal(m.appId, id); assert.equal(m.method, 'load');
    assert.deepEqual({ ...m.skip }, { back: 15, forward: 30 }, 'the skip ask travels to the player unchanged');
  }
});

test('switch on: no other app gets the player, even with provides background-audio', async () => {
  const f = shell({ on: true });
  const win = f.frame('wizard-notes');
  assert.equal(f.c.WizBackgroundAudio.frameOk(win, origin), false);
  await assert.rejects(f.c.WizBackgroundAudio.request(win, 'play'), /refused/);
  assert.equal(f.sent.length, 0);
  assert.equal(f.c.WizBackgroundAudio.canAttach(win), false);
});

test('the switch is read at call time, so flipping it needs no reload', () => {
  const f = shell();
  const win = f.frame('wizard-podcasts');
  f.c.WizBackgroundAudio.request(win, 'state').catch(() => {});
  assert.equal(f.sent.at(-1).appId, 'wizard-music');
  f.root.dataset.tweaks += ' ' + SWITCH;
  f.c.WizBackgroundAudio.request(win, 'state').catch(() => {});
  assert.equal(f.sent.at(-1).appId, 'wizard-podcasts');
});

test('turning the switch off mid-play never strands Podcasts: it keeps its own id, and the off edge stops its session', async () => {
  const f = shell({ on: true });
  const win = f.frame('wizard-podcasts');
  f.c.WizBackgroundAudio.request(win, 'load', { sessionId: 's', queue: [] }).catch(() => {});
  assert.equal(f.sent.at(-1).appId, 'wizard-podcasts');
  f.root.dataset.tweaks = 'wizard/swap-sides';
  f.c.WizBackgroundAudio.request(win, 'pause', { sessionId: 's' }).catch(() => {});
  assert.equal(f.sent.at(-1).appId, 'wizard-podcasts', 'the owner keeps controlling its own session');
  const answer = result => f.c.wizardAudioPort.onmessage({ data: JSON.stringify({ id: f.sent.at(-1).id, ok: true, result }) });
  const released = f.c.WizBackgroundAudio.releaseOwn();
  assert.deepEqual([f.sent.at(-1).method, f.sent.at(-1).appId], ['state', 'wizard-podcasts']);
  answer({ sessionId: 's' }); await new Promise(r => setImmediate(r));
  assert.deepEqual([f.sent.at(-1).method, f.sent.at(-1).appId, f.sent.at(-1).sessionId], ['stop', 'wizard-podcasts', 's']);
  answer({ sessionId: 's' }); await released;
  f.c.WizBackgroundAudio.request(win, 'state').catch(() => {});
  assert.equal(f.sent.at(-1).appId, 'wizard-music', 'after the stop, the off path is back to the old token');
});

test('the off edge of the switch (wos:tweak-choice) triggers the release; other switches and the on edge do not', () => {
  const f = shell({ on: true });
  let calls = 0; f.c.WizBackgroundAudio.releaseOwn = () => { calls++; };
  const fire = detail => f.listeners['wos:tweak-choice']({ detail });
  fire({ id: SWITCH, on: true }); fire({ id: 'wizard/swap-sides', on: false });
  assert.equal(calls, 0);
  fire({ id: SWITCH, on: false });
  assert.equal(calls, 1);
});

test('the switch is listed, off by default, linked to its issue', async () => {
  // The real Settings › Look list on the real catalog: listed, off on a fresh device and with the Wizard profile; the switch turns it on.
  const fresh = await lookBox();
  const row = fresh.row(SWITCH);
  assert.ok(row, 'listed'); assert.equal(row.on, false, 'off by default'); assert.ok(!fresh.active().includes(SWITCH));
  const wizard = await lookBox({ saved: { version: 1, off: {}, preset: 'wizard' } });
  assert.ok(!wizard.active().includes(SWITCH), 'not in the Wizard profile');
  await fresh.E.toggle(SWITCH); assert.ok(fresh.active().includes(SWITCH), 'the switch turns it on');
  const m = JSON.parse(read('web/tweaks/wizard/lock-screen-player/manifest.json'));
  assert.equal(m.id, SWITCH);
  assert.ok(m.issues.includes('humanitylabs-org/wizard-ux#1661'));
  assert.ok(m.issues.includes('humanitylabs-org/wizard-ux#1664'), 'the iPhone player is behind the same switch');
});

// Not run here (wizard-ux issue 1674): this pinned Java/Swift source text and no JDK runs it in this suite. Android lock-screen player wiring: the admitted apps and the open path run in the JVM suite (AudioPolicyTest).
