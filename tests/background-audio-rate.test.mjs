// wizard-ux issue 2061: Podcasts' speed buttons reach the phone's own media player through the shell bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

function shell() {
  const sent = [];
  const port = {postMessage(s) {
    const m = JSON.parse(s); sent.push(m);
    setTimeout(() => port.onmessage({data: JSON.stringify({id: m.id, ok: true, result: {v: 1, sessionId: 's', rate: m.value}})}), 0);
  }};
  const appWin = {location: {href: 'http://x/wizard-podcasts/'}, document: {documentElement: {}}};
  const frame = {contentWindow: appWin, isConnected: true, hasAttribute: () => false, getAttribute: () => '/wizard-podcasts/'};
  const win = {location: {origin: 'http://x', href: 'http://x/wizard-os-home/'}, URL, addEventListener() {}, wizardAudioPort: port,
    document: {querySelectorAll: () => [frame]}, setTimeout, clearTimeout};
  win.window = win; vm.createContext(win);
  vm.runInContext(fs.readFileSync(new URL('../web/core/background-audio.js', import.meta.url), 'utf8'), win);
  win.WizBackgroundAudio.init(() => ({'wizard-podcasts': {url: '/wizard-podcasts/', provides: ['background-audio']}}), () => true);
  return {win, appWin, sent};
}

test('a rate request from Podcasts reaches the device player with its value', async () => {
  const {win, appWin, sent} = shell();
  const result = await win.WizBackgroundAudio.request(appWin, 'rate', {sessionId: 's', value: 2});
  assert.equal(result.rate, 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'rate');
  assert.equal(sent[0].value, 2);
  assert.equal(sent[0].appId, 'wizard-podcasts');
});

test('load carries an optional rate to the device player', async () => {
  const {win, appWin, sent} = shell();
  await win.WizBackgroundAudio.request(appWin, 'load', {sessionId: 's', queue: [{id: 'ep:1', stream: '/wizard-podcasts/api/episodes/1/audio'}], rate: 1.5});
  assert.equal(sent[0].method, 'load');
  assert.equal(sent[0].rate, 1.5);
});
