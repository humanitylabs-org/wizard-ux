// Shell views as two ordinary tweaks (Miguel, 1 Nov 2026, "maximum simplicity"): no Shell view row in Settings any
// more; Miguel's Tweaks list carries "Different shell view - Orb" and "Different shell view - Apps", each a normal
// switch, mutually exclusive (on turns the other off), both off = Desks, the stock shell. Runs the real
// web/core/experience.js and web/core/settings.js together, per device (the tweak mix in wos.skin-tweaks.v1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import vm from 'node:vm';
import { read, fixture } from './fixtures/tweaks.mjs';

const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const VIEWS = ['miguel/orb-shell', 'miguel/apps-home'];
const KEY = 'wos.skin-tweaks.v1';

function box({ shell = 'desktop', storage = new Map() } = {}) {
  let active = [];
  const loads = [];
  const s = { console, Map, Set, Date, String, URL, Event, AbortSignal, CSS: { escape: String }, setTimeout, clearTimeout, setInterval, clearInterval, JSON,
    document: { activeElement: null, baseURI: 'https://box.test/wizard-os-home/', addEventListener() {}, querySelector: () => null },
    navigator: { userAgent: 'Desktop' }, location: { host: 'box.test', href: 'https://box.test/wizard-os-home/index.html', origin: 'https://box.test' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } };
  s.window = s;
  s.addEventListener = () => {}; s.dispatchEvent = () => {};
  s.WizCore = { refreshApps: async () => {} };
  s.WizChatsHost = { defaultId: () => 'wizard-chats', installed: () => [] };
  // This branch's Look: a skin brings its author's tweaks (Miguel's palettes carry his profile, views listed off).
  s.WosSkin = { current: 'obsidian-light', list: ['obsidian', 'obsidian-light'], families: [{ id: 'mizel', tweaks: 'miguel', palettes: ['obsidian', 'obsidian-light'] }], familyOf: () => 'mizel' };
  s.WosSkinHost = { personalState: { ready: false }, get tweakState() { return active; }, layout: 'classic', setLayout() {}, loadTweaks: async ids => { active = [...ids]; loads.push([...ids]); } };
  s.fetch = async url => {
    const path = String(url.pathname || url).split('/wizard-os-home/')[1] || '';
    if (/^tweaks\/|^core\/slots\.json/.test(path)) return { ok: true, status: 200, json: async () => JSON.parse(read('web/' + path.replace(/\?.*$/, ''))) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  vm.runInNewContext(read('web/core/experience.js'), s);
  vm.runInNewContext(read('web/core/settings.js'), s);
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell, live: { ok: true, onChange: () => () => {} } });
  // a tap on a Look row, as the click handler passes it to the Look feature
  const on = (attr, dataset) => view.dispatch({ classList: { contains: () => false }, closest: sel => sel === '[data-settings-feature]' ? { dataset: { settingsFeature: 'look' } } : sel === attr ? { dataset } : null });
  const tap = id => on('[data-tweak-toggle]', { tweakToggle: id });
  const quick = who => on('[data-tweakauthor]', { tweakauthor: who });
  const views = () => active.filter(id => VIEWS.includes(id));
  return { s, root, view, tap, quick, storage, views, active: () => [...active], loads, E: s.WosExperience };
}
// the switches as rendered: [id, name, on]
const switches = html => [...html.matchAll(/data-tweak-toggle="([^"]+)" role="switch" aria-checked="(true|false)"[^>]*><span class="st-tx"><b>([^<]+)<\/b>/g)].map(m => [m[1], m[3], m[2] === 'true']);
const viewSwitches = html => switches(html).filter(([id]) => VIEWS.includes(id));
const look = async b => { b.view.focus('look'); await tick(); return b.root.innerHTML; };

for (const shell of ['desktop', 'phone']) test(`${shell}: no Shell view row; Miguel's Tweaks list has both shell views as plain switches, off`, async () => {
  const b = box({ shell }); await b.E.refresh();
  const html = await look(b);
  assert.doesNotMatch(html, /Shell view|data-shellview|sv-seg|sv-group/, 'the Settings row is gone');
  assert.deepEqual(viewSwitches(html), [['miguel/orb-shell', 'Different shell view - Orb', false], ['miguel/apps-home', 'Different shell view - Apps', false]]);
  const group = html.match(/<div class="tw-author" role="group" aria-label="Miguel’s tweaks">[^]*?(?=<div class="tw-author"|$)/)?.[0] || '';
  assert.match(group, /data-tweak-toggle="miguel\/orb-shell"/, 'listed under Miguel');
  assert.match(group, /data-tweak-toggle="miguel\/apps-home"/);
  assert.deepEqual(b.views(), [], 'a fresh device wears no view (Desks)');
});

test('turning one on turns the other off; off again = Desks; one tweak reload per tap; survives a reload', async () => {
  const storage = new Map();
  const b = box({ storage }); await b.E.refresh();
  b.tap('miguel/orb-shell'); await tick();
  assert.deepEqual(b.views(), ['miguel/orb-shell']);
  assert.deepEqual(viewSwitches(await look(b)).map(v => v[2]), [true, false]);
  const n = b.loads.length; b.tap('miguel/apps-home'); await tick();
  assert.deepEqual(b.views(), ['miguel/apps-home'], 'Apps on turns Orb off');
  assert.equal(b.loads.length, n + 1, 'one reload of the tweaks per tap');
  assert.deepEqual(viewSwitches(await look(b)).map(v => v[2]), [false, true]);
  b.tap('miguel/orb-shell'); await tick();
  assert.deepEqual(b.views(), ['miguel/orb-shell'], 'and Orb on turns Apps off');
  b.tap('miguel/apps-home'); await tick(); b.tap('miguel/apps-home'); await tick();
  assert.deepEqual(b.views(), [], 'switching the worn one off = Desks (the other does not come back)');
  b.tap('miguel/apps-home'); await tick();
  // this branch stores the switches as the worn skin author's off list
  const off = JSON.parse(storage.get(KEY)).off.miguel;
  assert.ok(!off.includes('miguel/apps-home')); assert.ok(off.includes('miguel/orb-shell'), 'never stored both on');
  const again = box({ storage }); await again.E.refresh();
  assert.deepEqual(again.views(), ['miguel/apps-home'], 'a reload keeps Apps');
  // api.settings.toggleTweak (WosExperience.toggle) takes the same path
  await again.E.toggle('miguel/orb-shell'); assert.deepEqual(again.views(), ['miguel/orb-shell']);
});

test('the author quick button never turns both on and leaves the worn view as it is', async () => {
  const b = box(); await b.E.refresh();
  const mig = JSON.parse(read('web/tweaks/catalog.json')).tweaks.filter(id => id.startsWith('miguel/') && !VIEWS.includes(id) && !JSON.parse(read(`web/tweaks/${id}/manifest.json`)).view);
  b.quick('miguel'); await tick();
  assert.deepEqual(b.views(), [], 'from Desks: no view switched on');
  assert.ok(mig.every(id => b.active().includes(id)), 'every other of his tweaks on');
  let html = await look(b);
  assert.match(html, /data-tweakauthor="miguel" role="switch" aria-checked="true"/, 'reads as all on (views are one at a time)');
  b.quick('miguel'); await tick(); assert.ok(!b.active().some(id => id.startsWith('miguel/')), 'tapped again: all of his off');
  b.tap('miguel/apps-home'); await tick(); b.quick('miguel'); await tick();
  assert.deepEqual(b.views(), ['miguel/apps-home'], 'Apps kept, Orb not added');
  b.quick('miguel'); await tick();
  assert.deepEqual(b.views(), ['miguel/apps-home'], 'off again: the view is left alone too');
  html = await look(b);
  assert.deepEqual(viewSwitches(html).map(v => v[2]), [false, true]);
});

test('AI apps is a third shell view: on turns Orb and Apps off, Orb or Apps on turns it off, off again = Desks', async () => {
  const b = box(); await b.E.refresh();
  const worn = () => b.active().filter(id => [...VIEWS, 'miguel/ai-apps'].includes(id));
  b.tap('miguel/orb-shell'); await tick();
  b.tap('miguel/ai-apps'); await tick(); assert.deepEqual(worn(), ['miguel/ai-apps'], 'AI apps on turns Orb off');
  b.tap('miguel/apps-home'); await tick(); assert.deepEqual(worn(), ['miguel/apps-home'], 'Apps on turns AI apps off');
  b.tap('miguel/ai-apps'); await tick(); b.tap('miguel/ai-apps'); await tick(); assert.deepEqual(worn(), [], 'the worn one off = Desks');
});

test('a device that stores both on wears only the first in catalog order (Orb), and the switches agree', async () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.indexOf('miguel/orb-shell') < cat.tweaks.indexOf('miguel/apps-home'));
  const storage = new Map([[KEY, JSON.stringify({ version: 1, off: { miguel: ['wizard/pin-buttons', 'miguel/ai-apps'] } })]]);
  const b = box({ storage }); await b.E.refresh();
  assert.deepEqual(b.views(), ['miguel/orb-shell']);
  assert.ok(b.active().includes('miguel/swipe-strip'), 'the rest of the mix is untouched');
  assert.deepEqual(viewSwitches(await look(b)).map(v => v[2]), [true, false]);
  b.tap('miguel/apps-home'); await tick(); assert.deepEqual(b.views(), ['miguel/apps-home']);
  b.tap('miguel/apps-home'); await tick(); assert.deepEqual(b.views(), [], 'off = Desks, the stale Orb on is cleared too');
  // his phone today (Apps on, Orb off as the old row stored it) keeps Apps
  const phone = box({ shell: 'phone', storage: new Map([[KEY, JSON.stringify({ version: 1, off: { miguel: ['wizard/pin-buttons', 'miguel/orb-shell', 'miguel/ai-apps'] } })]]) });
  await phone.E.refresh(); assert.deepEqual(phone.views(), ['miguel/apps-home']);
});

for (const shell of ['desktop', 'phone']) test(`${shell}: each switch wears its layout; both off is exactly the stock shell`, async () => {
  for (const [id, layout] of [['', 'classic'], ['miguel/orb-shell', 'orb'], ['miguel/apps-home', 'apps']]) {
    const b = box({ shell }); await b.E.refresh(); if (id) { b.tap(id); await tick(); }
    const f = fixture({ shell });
    await f.host.loadTweaks(b.views(), f.slots, { teamAuthors: ['miguel'] });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(f.host.layout, layout, `${shell} ${id || 'Desks'}`);
    if (!id) {
      assert.deepEqual([...f.host.tweakState], [], 'Desks: no view tweak runs');
      assert.equal(f.doc.documentElement.dataset.layout, undefined, 'no layout hook on <html>');
      assert.equal(f.doc.documentElement.dataset.viewChrome, undefined);
      assert.equal(f.host.orbSwipes(), null, 'stock orb swipes');
      assert.ok(!f.doc.head.children.some(l => /layouts\/|tweaks\/miguel\/(orb-shell|apps-home)/.test(l.href || '')), 'no view CSS loaded');
    }
    await f.clear();
  }
});

test('core keeps only the exclusivity: no Shell view row, no chooseView, no Miguel ids; the old switch tweak stays retired', () => {
  const settings = read('web/core/settings.js'), exp = read('web/core/experience.js'), css = read('web/core/settings.css');
  assert.doesNotMatch(settings, /shellView|data-shellview|Shell view/);
  assert.doesNotMatch(css, /\.sv-(group|seg)/);
  assert.doesNotMatch(exp, /chooseView/);
  assert.match(settings, /const exp = s\.tweaks\.filter\(t => !t\.builtin\);/, 'views are listed like any tweak');
  for (const f of ['web/core/settings.js', 'web/core/experience.js']) assert.doesNotMatch(read(f), /orb-shell|apps-home/, f);
  for (const [id, name, label] of [['orb-shell', 'Different shell view - Orb', 'Orb'], ['apps-home', 'Different shell view - Apps', 'Apps']]) {
    const m = JSON.parse(read(`web/tweaks/miguel/${id}/manifest.json`));
    assert.equal(m.name, name); assert.equal(m.view, label, 'manifest `view` marks it one of the exclusive views');
    assert.doesNotMatch(m.description, /Shell view/);
  }
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  for (const id of VIEWS) assert.ok(cat.tweaks.includes(id) && !cat.defaults.includes(id), `${id}: listed, never a default`);
  assert.ok(!existsSync(new URL('../web/tweaks/miguel/orb-switch', import.meta.url)) && !cat.tweaks.includes('miguel/orb-switch'));
  for (const f of ['web/layouts/orb/layout.js', 'web/layouts/orb/phone.js', 'web/layouts/apps/layout.js', 'web/layouts/apps/desktop.js', 'web/layouts/orb/layout.css', 'web/layouts/apps/layout.css', 'web/layouts/apps/chrome.css'])
    assert.doesNotMatch(read(f), /os-switch|os-side/, f);
  assert.match(read('web/desktop/desktop.css'), /\.bar-center:not\(:empty\) ~ #clock/);
  // Settings stays reachable in every view: neither view hides the gear
  for (const f of ['web/layouts/orb/layout.css', 'web/layouts/apps/layout.css', 'web/layouts/apps/chrome.css', 'web/layouts/orb/phone.css', 'web/tweaks/miguel/orb-shell/tweak.css', 'web/tweaks/miguel/apps-home/tweak.css'])
    assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\//g, ''), /#settingsBtn[^{]*\{[^}]*display:\s*none|\.gear[^{]*\{[^}]*display:\s*none/, f);
});
