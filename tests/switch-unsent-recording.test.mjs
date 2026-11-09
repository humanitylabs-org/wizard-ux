import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// wizard-ux#1220: when the Android app refuses a Wizard switch for a recording not sent yet, the page shows that
// recording with Send / Delete (WosDevice.showUnsent), instead of a toast that is a dead end.
const source = readFileSync(new URL('../web/device.js', import.meta.url), 'utf8');

function load({pending, recoveryComplete = true, voice = 'idle'}) {
  const added = [];
  const el = () => ({dataset:{}, classList:{add(){}, remove(){}, toggle(){}}, innerHTML:'', addEventListener(){}, remove(){}, querySelector(){ return null; }});
  const document = {createElement: el, body: {appendChild: e => added.push(e)}, querySelector: () => null, addEventListener(){}, hidden: false};
  const window = {
    WosOutbox: {recoveryComplete, onChange(){}, onSent(){}, nativeItem: () => null, _items: new Map(), quarantined: () => false},
    WizardOSDevice: {version: () => '0.10.39', recPending: () => JSON.stringify(pending), recActive: () => 'null'},
    WizConfig: {agent: () => 'Archimedes'},
  };
  const c = {window, document, console, JSON, Set, Map, Promise, Error, String, Number, Math, Array, Object,
    setTimeout: () => 0, clearTimeout(){}, requestAnimationFrame(){}, addEventListener(){}, CSS: {escape: s => s}};
  Object.assign(window, c); window.window = window;
  vm.createContext(window);
  vm.runInContext(source, window); // boot waits for the shell (__wos), so nothing else runs
  window.__wos = {voice, toast(){}, recDone(){}};
  return {api: window.WosDevice, added};
}

const take = {id: 'rec-1', kind: 'auto', state: 'interrupted', ms: 42000, bytes: 9000};

test('a refused switch opens the unsent recording with Send and Delete', () => {
  const {api, added} = load({pending: [take]});
  assert.equal(api.showUnsent(), true);
  assert.equal(api.sheet, 'recording');
  const html = added.at(-1).innerHTML;
  assert.match(html, /data-takeact="send"/);
  assert.match(html, /data-takeact="delete"/);
  assert.match(html, /data-take="rec-1"/);
});

test('nothing to show leaves no sheet (the toast already said why)', () => {
  assert.equal(load({pending: []}).api.showUnsent(), false);
  // durable custody not hydrated yet: never race it with a second offer
  assert.equal(load({pending: [take], recoveryComplete: false}).api.showUnsent(), false);
});
