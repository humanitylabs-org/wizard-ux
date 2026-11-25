// Search in Settings (humanitylabs-org/try-wizard#94, on for everyone; the wizard/settings-search switch is removed):
// a box at the top of the category list filters it to the pages that mention the words; the open page marks them
// (browser proof: tests/qa-settings-search.cjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withSettingsParts } from './fixtures/settings-parts.mjs';
const source = withSettingsParts(fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8'));
const ID = 'wizard/settings-search';
const text = html => String(html).split(/<[^>]*>/).join(' ').split('&amp;').join('&');
function harness({ shell = 'desktop' } = {}) {
  const storage = new Map(), listeners = {};
  const documentElement = { dataset: { tweaks: '' } };
  // Test-only stand-in for the inert <template> the view parses page markup with.
  const createElement = () => { let h = ''; return { set innerHTML(v) { h = v; }, content: { querySelectorAll: () => [], get textContent() { return text(h); } } }; };
  const s = { console, Map, Set, Date, String, CSS: { escape: String }, setTimeout, document: { activeElement: null, documentElement, createElement }, navigator: { userAgent: 'Desktop' }, location: { host: 'example.test' }, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } };
  s.window = s;
  const winListeners = {};
  s.addEventListener = (t, f) => { (winListeners[t] ||= []).push(f); }; s.removeEventListener = () => {};
  s.WizCore = { refreshApps: async () => {} };
  s.WizBrand = { html: 'W' };
  s.WosSkin = { current: 'nebula', list: [{ id: 'nebula', name: 'Nebula' }], families: [{ id: 'wizard', name: 'Wizard', palettes: ['nebula'] }], familyOf: () => 'wizard' };
  s.fetch = async () => ({ ok: true, json: async () => ({}) });
  vm.runInNewContext(source, s);
  s.WosSettings.register({ id: 'zz-probe', page: 'voice', html: () => '<p>Push to talk &amp; dictation <b>Hotkey</b></p>' });
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false, querySelector: () => null, querySelectorAll: () => [], addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell, live: { ok: true }, helpSub: 'Help', toast() {} });
  const type = (value, kind = 'input', isComposing = false) => { for (const f of listeners[kind] || []) f({ isComposing, target: { value, matches: sel => sel === '[data-st-search]', closest: () => null } }); };
  const cats = () => [...root.innerHTML.matchAll(/data-st-page="([^"]+)"/g)].map(m => m[1]);
  return { s, root, view, type, cats, documentElement, winListeners };
}
test('with no switch on, the box sits at the top of the list, above the categories', () => {
  const h = harness();
  const html = h.root.innerHTML;
  assert.match(html, /<h3 class="st-title"[^>]*>Settings<\/h3><div class="st-search" role="search"><input type="search" data-st-search="" placeholder="Search settings" aria-label="Search settings"/);
  assert.ok(html.indexOf('data-st-search') < html.indexOf('data-st-page='), 'box comes before the categories');
});
test('typing keeps only the pages that mention the words and opens the first one beside the list', () => {
  const h = harness();
  const all = h.cats();
  assert.ok(all.length > 3 && all.includes('voice'));
  h.type('HOTKEY');
  assert.deepEqual(h.cats(), ['voice'], 'case-insensitive match on a feature on the Voice page only');
  assert.equal(h.view.page, '', 'a search pick does not open the page (narrow windows keep the list)');
  assert.match(h.root.innerHTML, /data-settings-feature="zz-probe"/, 'desktop shows the matching page beside the list');
  assert.match(h.root.innerHTML, /value="HOTKEY"/, 'the box keeps the words across repaints');
  h.type('push to talk & dictation');
  assert.deepEqual(h.cats(), ['voice'], 'entities in markup match their plain text');
  h.type('appearance');
  assert.ok(h.cats().includes('appearance'), 'page titles match too');
  h.type('no-such-setting-anywhere');
  assert.deepEqual(h.cats(), []);
  assert.match(h.root.innerHTML, /No settings mention “no-such-setting-anywhere”/);
  h.type('');
  assert.deepEqual(h.cats(), all, 'clearing the box brings every category back');
});
test('an explicitly opened page that does not match moves to the first match', () => {
  const h = harness();
  h.view.focus('look'); assert.equal(h.view.page, 'appearance');
  h.type('hotkey');
  assert.equal(h.view.page, 'voice');
  assert.match(h.root.innerHTML, /data-st-search/);
  assert.equal(h.winListeners['wos:tweak-choice'], undefined, 'no longer follows a switch');
});
test('an IME composing in the box is left alone until compositionend (no repaint replaces the box mid-word)', () => {
  const h = harness();
  const all = h.cats(), before = h.root.innerHTML;
  h.type('hotk', 'input', true);
  assert.equal(h.root.innerHTML, before, 'no repaint while composing');
  h.type('hotkey', 'compositionend');
  assert.deepEqual(h.cats(), ['voice']);
  assert.ok(all.length > 1);
});
