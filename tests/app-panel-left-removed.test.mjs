// The app panel on the left (wizard-os#639, switch wizard/app-panel-left) was dropped and its code removed
// (wizard-os#941): the app panel stays on the right, beside the open-apps column, with no button and no ⌥⇧M; a saved
// choice for it (the switch and the pane model's appSide) is cleared from the device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ID = 'wizard/app-panel-left';
const plain = o => JSON.parse(JSON.stringify(o));
const panesWith = storage => { const c = vm.createContext({ localStorage: storage }); vm.runInContext(read('web/core/pane-layout.js'), c); return c.WizCore.panes; };

test('the switch, its package, its help line and its code are gone', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!cat.tweaks.includes(ID) && !(cat.defaults || []).includes(ID));
  assert.equal(existsSync(new URL('../web/tweaks/wizard/app-panel-left', import.meta.url)), false);
  assert.ok(!Object.values(JSON.parse(read('skill/help.json'))).some(g => g && typeof g === 'object' && Object.hasOwn(g, ID)));
  for (const f of ['desktop.js', 'desktop-panes.js', 'desktop-keys.js', 'desktop-modes.js', 'desktop-split.js']) {
    const js = read('web/layouts/ai-apps/' + f);
    assert.doesNotMatch(js, /app-panel-left|flipAppSide|appSideOf|aad-pside|KeyM' && leftOn/, f);
  }
});

test('the app panel stays at the end of the main area, a docked chat before it', () => {
  const p = panesWith(), viewport = { width: 1440, height: 900 };
  for (const chatOn of [false, true]) {
    const env = { appOn: true, chatOn, appWidth: 560, sideWidth: 288, dockWidth: 200 };
    const g = p.geometry({ appSide: 'start' }, viewport, env);
    assert.deepEqual(plain(g), plain(p.geometry({}, viewport, env)), 'an old saved appSide changes nothing');
    assert.equal(g.panes.app.x + g.panes.app.width, g.content.x + g.content.width, 'the panel meets the open-apps column');
    if (chatOn) assert.equal(g.panes.chats.x, g.content.x);
  }
  assert.equal(Object.hasOwn(p.normalize({ appSide: 'start' }), 'appSide'), false);
});

test('a saved appSide is cleared from this device, other pane choices kept', () => {
  const store = new Map([['wos.pane-layout.v1', JSON.stringify({ mode: 'pair', appSide: 'start', side: 'end' })]]);
  panesWith({ getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) });
  const now = JSON.parse(store.get('wos.pane-layout.v1'));
  assert.equal(Object.hasOwn(now, 'appSide'), false); assert.equal(now.mode, 'pair'); assert.equal(now.side, 'end');
  const clean = new Map([['wos.pane-layout.v1', '{"mode":"pair"}']]); let writes = 0;
  panesWith({ getItem: k => clean.get(k) ?? null, setItem: () => { writes++; } });
  assert.equal(writes, 0, 'nothing is written when there is nothing to clear');
});

test('a saved on/off for the switch is cleared from the device and never requested', async () => {
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.channel.v1', 'latest'],
    ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix: { [ID]: true, 'miguel/send-and-go': true }, defaultsMigrated: true, machinesHomeMoved: true, miguelLayoutMoved: true })]]);
  let active = [];
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } },
    addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  await window.WosExperience.refresh();
  const now = JSON.parse(storage.get('wos.skin-tweaks.v1'));
  assert.equal(Object.hasOwn(now.mix, ID), false); assert.equal(now.mix['miguel/send-and-go'], true, 'other choices kept');
  assert.ok(!active.includes(ID));
  assert.ok(!window.WosExperience.state.tweaks.some(t => t.id === ID), 'not offered as a switch');
});
