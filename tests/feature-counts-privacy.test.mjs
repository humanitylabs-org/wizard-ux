// Share feature counts in Settings › Privacy (wizard-ux issue 2053, switch wizard/feature-counts-privacy, off by
// default). Miguel, 28 Nov 2026: Try new features holds only features waiting for a yes or no, and Share feature counts
// is a lasting privacy choice (James: off until each owner opts in). On: Try new features leaves it out and Privacy shows
// "Share feature counts with the team", the same switch (so every device keeps its choice), on through the Share prompt,
// off in one tap. Off: nothing changes. Runs the real Settings renderer and dispatch (core/settings.js + core/privacy.js).
// Browser run on the real shells: tests/qa-feature-counts-privacy.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withSettingsParts } from './fixtures/settings-parts.mjs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const settings = withSettingsParts(read('web/core/settings.js'));
const privacy = read('web/core/privacy.js');
const COUNTS = 'wizard/try-feature-counts', MOVE = 'wizard/feature-counts-privacy';

function harness({ move, shared = false, channel = 'latest', lookOnly = true }) {
  const toggled = [], opened = [];
  const tweaks = [
    { id: 'wizard/skins-look-only', name: 'Skins are look only', author: 'wizard', on: lookOnly },
    { id: 'miguel/snooze-someday', name: 'One-tap Snooze', author: 'miguel', on: false },
    { id: COUNTS, name: 'Share feature counts', author: 'wizard', description: 'Once an hour this box sends the team only which app features under test were tried', on: shared },
    { id: MOVE, name: 'Share feature counts in Privacy', author: 'wizard', on: move },
  ].map(t => channel === 'stable' ? { ...t, on: false, locked: true } : t);
  const on = () => tweaks.filter(t => t.on).map(t => t.id).join(' ');
  const E = { lookOnly, installedReady: true, installed: async () => [], defaults: async () => ({}),
    state: { owner: 'miguel', busy: false, error: '', channel, locked: channel === 'stable', tweaks, active: [], shell: 'phone' },
    toggle: async id => { toggled.push(id); const t = tweaks.find(x => x.id === id); t.on = !t.on; } };
  const docEl = { dataset: { get tweaks() { return channel === 'stable' ? '' : on(); } } };
  const body = { appendChild: el => opened.push(el) };
  const document = { activeElement: null, documentElement: docEl, body, baseURI: 'https://box.test/wizard-os-home/',
    createElement: () => ({ set innerHTML(h) { this.firstElementChild = { html: h, addEventListener() {}, querySelector: () => null, remove() {} }; } }),
    addEventListener() {}, querySelectorAll: () => [] };
  const s = { console, URL, setTimeout, clearTimeout, CSS: { escape: String }, navigator: { userAgent: 'Android' }, document,
    location: { host: 'box.test', href: 'https://box.test/wizard-os-home/' }, WizCore: {}, WosExperience: E,
    WosSkin: { current: 'nebula', list: [], families: [], familyOf: () => 'wizard' }, WosMySkin: { recipes: [], active: null, previews: [], on() {} },
    localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) };
  s.window = s;
  vm.runInNewContext(settings, s);
  vm.runInNewContext(privacy, s);
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell: 'phone', live: { ok: true } });
  const page = id => { view.focus(id); return view.page === id ? root.innerHTML : ''; };
  const act = (feature, value) => view.dispatch({ closest: sel => sel === '[data-settings-feature]'
    ? { dataset: { settingsFeature: feature } } : sel === '[data-tweak-toggle]' ? { dataset: { tweakToggle: value } } : null });
  return { E, s, root, view, page, act, toggled, opened, tweaks };
}
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const countsRow = html => html.match(/<button[^>]*data-tweak-toggle="wizard\/try-feature-counts"[^]*?<\/button>/)?.[0] || '';

test('switch off: Try new features keeps Share feature counts and Privacy has no row (nothing changes)', () => {
  for (const lookOnly of [true, false]) {
    const h = harness({ move: false, lookOnly });
    const tryHtml = h.page(lookOnly ? 'try-features' : 'appearance');
    assert.match(tryHtml, /data-try-features[^]*data-tweak-toggle="wizard\/try-feature-counts"/, 'still under Try new features');
    assert.match(tryHtml, /only if you allow it\.<\/p>/, 'the hint is today\'s');
    assert.equal(countsRow(h.page('privacy')), '', 'nothing new on Privacy');
  }
});

test('switch on: Share feature counts leaves Try new features (its own page and inside Appearance)', () => {
  for (const lookOnly of [true, false]) {
    const h = harness({ move: true, lookOnly });
    const tryHtml = h.page(lookOnly ? 'try-features' : 'appearance');
    assert.match(tryHtml, /data-try-features[^]*data-tweak-toggle="miguel\/snooze-someday"/, 'the other switches stay');
    assert.doesNotMatch(tryHtml, /data-tweak-toggle="wizard\/try-feature-counts"/);
    assert.match(tryHtml, /only if you allow it in Settings › Privacy\.<\/p>/);
  }
});

test('switch on: Privacy shows "Share feature counts with the team", off by default, below Private AI', () => {
  const h = harness({ move: true });
  const html = h.page('privacy');
  const row = countsRow(html);
  assert.match(row, /<b>Share feature counts with the team<\/b>/);
  assert.match(row, /Once an hour this box sends the team only/, 'same wording as today');
  assert.match(row, /aria-checked="false"/, 'off until the owner says Share');
  assert.ok(html.indexOf('data-pm-group') < html.indexOf('data-fc-privacy'), 'after Private AI');
});

test('switch on: a device that already shares keeps sharing (same switch, no migration)', () => {
  const h = harness({ move: true, shared: true });
  assert.match(countsRow(h.page('privacy')), /aria-checked="true"/);
});

test('switch on: turning it on from Privacy opens the Share prompt (names Privacy), off is one tap', async () => {
  const h = harness({ move: true });
  h.page('privacy');
  h.act('feature-counts', COUNTS); await tick();
  assert.deepEqual(h.toggled, [], 'nothing is turned on before Share');
  assert.equal(h.opened.length, 1, 'the Share prompt opens');
  assert.match(h.opened[0].html, /Share feature counts\?/);
  assert.match(h.opened[0].html, /in Settings, under Privacy \(Share feature counts with the team\)/);
  const k = harness({ move: true, shared: true });
  k.page('privacy');
  k.act('feature-counts', COUNTS); await tick();
  assert.deepEqual(k.toggled, [COUNTS], 'off in one tap'); assert.equal(k.opened.length, 0);
});

test('For everyone: the counts switch stays locked off, so Privacy shows no row', () => {
  const h = harness({ move: true, channel: 'stable' });
  assert.equal(countsRow(h.page('privacy')), '');
});
