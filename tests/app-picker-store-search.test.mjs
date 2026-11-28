// Add an app also searches the App Store (wizard-os issue 721, on for everyone: the switch is gone).
// The real AI apps desktop view: its Apps column's + opens the shared picker (layouts/apps/chrome.js). Typing a name
// lists the App Store's matches you don't have yet under your installed ones, and a pick opens its Store page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakePointerEvent, deskWorld, layout, settle } from './fixtures/ai-apps-world.mjs';

const STORE = [{ id: 'wizard-atlas', name: 'Atlas', summary: 'World maps and directions' }, { id: 'wizard-podcasts', name: 'Podcasts', summary: 'Listen to your shows' }, { id: 'money-copy', name: 'Money', summary: 'Already installed under another id' }];

async function picker({ fail = false } = {}) {
  const { w } = deskWorld();
  const reads = [], got = [];
  w.api.apps.kinds = () => ({ apps: [{ id: 'mail', name: 'Mail' }, { id: 'money', name: 'Money' }, { id: 'maps-notes', name: 'Map notes' }] });
  w.api.apps.openAny = id => { w.st.opened.push('any:' + id); return true; };
  w.api.apps.store = () => { reads.push(1); return fail ? Promise.reject(new Error('down')) : Promise.resolve(STORE.map(a => ({ ...a }))); };
  w.api.apps.get = id => { got.push(id); return true; };
  (await layout()).default(w.api);
  w.q('.aad-vall').dispatchEvent(new FakePointerEvent('click'));
  await settle();
  const type = async v => { const f = w.q('.vc-pick .vc-q'); f.value = v; f.dispatchEvent(new FakePointerEvent('input')); await settle(); };
  const heads = () => w.qa('.vc-pick .vc-sec-h > span').map(n => n.textContent);
  const storeRows = () => w.qa('.vc-pick .vc-get').map(b => b.dataset.store);
  return { w, reads, got, type, heads, storeRows };
}

test('a search lists App Store matches you do not have, under the installed ones; a pick opens its Store page', async () => {
  const p = await picker();
  assert.equal(p.reads.length, 1, 'the Store list is read once when the picker opens');
  assert.deepEqual(p.storeRows(), [], 'nothing from the Store before typing');
  assert.deepEqual(p.heads(), ['For people']);
  await p.type('map');
  assert.deepEqual(p.heads(), ['For people', 'In the App Store']);
  assert.deepEqual(p.w.qa('.vc-pick .vc-app[data-app]').map(b => b.dataset.app), ['maps-notes'], 'installed matches first');
  assert.deepEqual(p.storeRows(), ['wizard-atlas'], 'found by its summary ("maps")');
  await p.type('money');
  assert.deepEqual(p.storeRows(), [], 'an app you already have (same name, another Store id) is not offered again');
  await p.type('podcasts');
  assert.deepEqual(p.storeRows(), ['wizard-podcasts'], 'found by its name');
  p.w.q('.vc-pick .vc-get').dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual(p.got, ['wizard-podcasts'], 'its page in the App Store');
  assert.equal(p.w.q('.vc-pick'), null, 'the picker closed');
});

test('the Store unreachable says so while searching; the installed list still works', async () => {
  const p = await picker({ fail: true });
  await p.type('map');
  assert.deepEqual(p.storeRows(), []);
  assert.equal(p.w.q('.vc-pick .vc-store-wait')?.textContent, 'The App Store can’t be reached right now.');
  assert.deepEqual(p.w.qa('.vc-pick .vc-app[data-app]').map(b => b.dataset.app), ['maps-notes']);
});
