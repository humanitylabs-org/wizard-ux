// Shell views (Miguel, 1 Nov 2026, "maximum simplicity"; per device type since 4 Nov). The Orb and Apps views went in
// wizard-ux issue 1338: the one view left is AI apps (desktop only), picked in the desktop's Shell view radio beside
// Desks; the phone has no view to pick and wears its stock shell. A device that saved Orb or Apps loads cleanly: the
// phone on its stock shell, the desktop on the standard view. Runs the real web/core/experience.js and
// web/core/settings.js together, per device (the tweak mix in wos.skin-tweaks.v1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import vm from 'node:vm';
import { read, fixture } from './fixtures/tweaks.mjs';

const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const REMOVED = ['miguel/orb-shell', 'miguel/apps-home'];
const KEY = 'wos.skin-tweaks.v1';

function box({ shell = 'desktop', storage = new Map() } = {}) {
  let active = [];
  const loads = [];
  const s = { console, Map, Set, Date, String, URL, Event, AbortSignal, CSS: { escape: String }, setTimeout, clearTimeout, setInterval, clearInterval, JSON,
    document: { activeElement: null, documentElement: { dataset: { shell } }, baseURI: 'https://box.test/wizard-os-home/', addEventListener() {}, querySelector: () => null },
    navigator: { userAgent: 'Desktop' }, location: { host: 'box.test', href: 'https://box.test/wizard-os-home/index.html', origin: 'https://box.test' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } };
  s.window = s;
  s.addEventListener = () => {}; s.dispatchEvent = () => {};
  s.WizCore = { refreshApps: async () => {} };
  s.WizChatsHost = { defaultId: () => 'wizard-chats', installed: () => [] };
  s.WosSkin = { current: 'obsidian-light', list: ['obsidian', 'obsidian-light'], families: [], familyOf: () => null };
  s.WosSkinHost = { layouts:[{id:'ai-apps', name:'AI apps', credit:'designed by Miguel'}], personalState: { ready: false }, get tweakState() { return active; }, layout: 'classic', setLayout() {}, setStandardLayout(id) { this.layout=id; }, loadTweaks: async ids => { active = [...ids]; loads.push([...ids]); } };
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
  const views = () => s.WosExperience.state.tweaks.filter(t=>t.on && t.view).map(t=>t.id);
  return { s, root, view, tap, storage, views, active: () => [...new Set([...active, ...s.WosExperience.state.tweaks.filter(t=>t.view && t.on).map(t=>t.id)])], loads, E: s.WosExperience };
}
// the switches as rendered: [id, name, on]
const switches = html => [...html.matchAll(/data-tweak-toggle="([^"]+)" role="switch" aria-checked="(true|false)"[^>]*><span class="st-tx"><b>([^<]+)<\/b>/g)].map(m => [m[1], m[3], m[2] === 'true']);
const look = async b => { b.view.focus('look'); await tick(); return b.root.innerHTML; };

for (const shell of ['desktop', 'phone']) test(`${shell}: Look offers no Orb or Apps view; the desktop picks Desks or AI apps, the phone none`, async () => {
  const b = box({ shell }); await b.E.refresh();
  const html = await look(b);
  for (const id of REMOVED) assert.doesNotMatch(html, new RegExp(id.replace('/', '\\/')), id + ' is not offered');
  assert.doesNotMatch(html, /data-desktop-view="(orb|apps)"/);
  if (shell === 'phone') {
    assert.doesNotMatch(html, /Shell view|data-shellview|sv-seg|sv-group|data-desktop-view/, 'phone: no view row');
    assert.deepEqual(b.views(), [], 'the phone wears its stock shell');
  } else {
    const picker = html.match(/<div role="radiogroup" aria-label="Shell view">([^]*?)<\/div>/)?.[1];
    assert.deepEqual([...picker.matchAll(/data-desktop-view="([^"]+)"/g)].map(m => m[1]), ['classic', 'ai-apps']);
    assert.doesNotMatch(picker, /designed by|credit|<small>/i, 'layout picker ignores even supplied credit metadata; skin and tweak names stay unchanged');
    assert.equal(b.E.desktopView, 'ai-apps', 'a fresh desktop wears the standard view');
  }
  assert.doesNotMatch(html, /tw-author|data-tweakauthor|All of /, 'no per-author quick buttons');
});

test('desktop: AI apps off = Desks, on again = AI apps; one tweak reload per pick; survives a reload', async () => {
  const storage = new Map();
  const b = box({ storage }); await b.E.refresh();
  const n = b.loads.length;
  await b.E.chooseDesktopView('classic'); assert.equal(b.E.desktopView, 'classic');
  assert.equal(b.loads.length, n + 1, 'one reload of the tweaks per pick');
  assert.deepEqual(JSON.parse(storage.get(KEY)).views, { desktop: '' }, 'Desks stored for this device type');
  const again = box({ storage }); await again.E.refresh(); assert.equal(again.E.desktopView, 'classic', 'a reload keeps Desks');
  // api.settings.toggleTweak (WosExperience.toggle) takes the same path
  await again.E.toggle('miguel/ai-apps'); assert.equal(again.E.desktopView, 'ai-apps');
  assert.deepEqual(JSON.parse(storage.get(KEY)).views, { desktop: 'miguel/ai-apps' });
});

test('a device that saved Orb or Apps loads cleanly: phone stock, desktop standard view, the rest of the mix untouched', async () => {
  const saved = views => new Map([[KEY, JSON.stringify({ version: 1, off: {}, preset: 'none', machinesHomeMoved: true, mix: { 'miguel/orb-shell': true, 'miguel/apps-home': true, 'miguel/snooze-someday': true }, ...(views ? { views } : {}) })]]);
  for (const views of [null, { desktop: 'miguel/orb-shell', phone: 'miguel/apps-home' }, { desktop: 'miguel/apps-home', phone: 'miguel/orb-shell' }]) {
    const desk = box({ storage: saved(views) }); await desk.E.refresh();
    assert.equal(desk.E.state.error, ''); assert.equal(desk.E.desktopView, 'ai-apps', JSON.stringify(views));
    assert.ok(desk.active().includes('miguel/snooze-someday'), 'the rest of the mix is untouched');
    for (const id of REMOVED) assert.ok(!desk.active().includes(id) && !desk.E.state.tweaks.some(t => t.id === id), id);
    const phone = box({ shell: 'phone', storage: saved(views) }); await phone.E.refresh();
    assert.equal(phone.E.state.error, ''); assert.deepEqual(phone.views(), []);
    assert.ok(phone.active().includes('miguel/snooze-someday'));
    for (const id of REMOVED) assert.ok(!phone.active().includes(id), id);
  }
});

for (const shell of ['desktop', 'phone']) test(`${shell}: each choice wears its layout; Desks is exactly the stock shell`, async () => {
  for (const [pick, layout] of shell === 'desktop' ? [['classic', 'classic'], ['ai-apps', 'ai-apps']] : [['', 'classic']]) {
    const b = box({ shell }); await b.E.refresh(); if (shell === 'desktop') await b.E.chooseDesktopView(pick);
    const f = fixture({ shell });
    if (shell === 'desktop') f.host.setStandardLayout(b.E.desktopView);
    await f.host.loadTweaks(shell === 'desktop' ? [] : b.views(), f.slots, { teamAuthors: ['miguel'] });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(f.host.layout, layout, `${shell} ${pick || 'Desks'}`);
    if (layout === 'classic') {
      assert.deepEqual([...f.host.tweakState], [], 'Desks: no view tweak runs');
      assert.equal(f.doc.documentElement.dataset.layout, undefined, 'no layout hook on <html>');
      assert.equal(f.doc.documentElement.dataset.viewChrome, undefined);
      assert.equal(f.host.orbSwipes(), null, 'stock orb swipes');
      assert.ok(!f.doc.head.children.some(l => /layouts\/|tweaks\/miguel\/(orb-shell|apps-home)/.test(l.href || '')), 'no view CSS loaded');
    }
    await f.clear();
  }
});

test('core keeps only the exclusivity: no Shell view row on the phone, no chooseView, the removed views and their code are gone', () => {
  const settings = read('web/core/settings.js'), css = read('web/core/settings.css'), exp = read('web/core/experience.js');
  assert.match(settings, /data-desktop-view/);
  assert.doesNotMatch(settings, /data-shellview/);
  assert.doesNotMatch(css, /\.sv-(group|seg)/);
  assert.doesNotMatch(exp, /chooseView/);
  assert.match(settings, /E\.desktopViews\?\.length && t\.layout/, 'built-in desktop views are not duplicate personal switches');
  assert.doesNotMatch(settings, /orb-shell|apps-home/);
  const cat = JSON.parse(read('web/tweaks/catalog.json')), prof = JSON.parse(read('web/tweaks/miguel/profile.json'));
  for (const id of [...REMOVED, 'miguel/orb-switch']) {
    assert.ok(!existsSync(new URL(`../web/tweaks/${id}`, import.meta.url)), id + ' package removed');
    assert.ok(!cat.tweaks.includes(id) && !cat.defaults.includes(id) && !prof.tweaks.includes(id) && !prof.off.includes(id), id + ' unlisted');
  }
  for (const f of ['web/layouts/orb/layout.js', 'web/layouts/orb/phone.js', 'web/layouts/orb/layout.css', 'web/layouts/orb/phone.css', 'web/layouts/orb/phone-boot.css',
    'web/layouts/apps/layout.js', 'web/layouts/apps/desktop.js', 'web/layouts/apps/layout.css', 'web/layouts/two-orb'])
    assert.ok(!existsSync(new URL('../' + f, import.meta.url)), f + ' removed');
  // still used by AI apps: the shared view chrome and the orb helpers
  for (const f of ['web/layouts/apps/chrome.js', 'web/layouts/apps/chrome.css', 'web/layouts/orb/shared.js', 'web/layouts/orb/keys.js', 'web/layouts/orb/styles.js'])
    assert.ok(existsSync(new URL('../' + f, import.meta.url)), f + ' kept');
  assert.doesNotMatch(read('web/layouts/apps/chrome.css'), /os-switch|os-side/);
  assert.match(read('web/desktop/desktop.css'), /\.bar-center:not\(:empty\) ~ #clock/);
  assert.doesNotMatch(read('web/layouts/apps/chrome.css').replace(/\/\*[\s\S]*?\*\//g, ''), /#settingsBtn[^{]*\{[^}]*display:\s*none|\.gear[^{]*\{[^}]*display:\s*none/, 'Settings stays reachable');
});

test('per shell type: the desktop choice never reaches the phone; the phone ignores a desktop-only view', async () => {
  const storage = new Map();
  const desk = box({ storage }); await desk.E.refresh();
  await desk.E.chooseDesktopView('ai-apps'); await tick();
  const phone = box({ shell: 'phone', storage }); await phone.E.refresh();
  assert.deepEqual(phone.views(), [], 'the desktop choice leaves the phone on its stock shell');
  const html = await look(phone);
  assert.doesNotMatch(html, /data-tweak-toggle="miguel\/ai-apps"/, 'a desktop-only view is not offered on the phone');
  await phone.E.toggle('miguel/ai-apps'); assert.deepEqual(phone.views(), [], 'and cannot be switched on there');
  const legacy = () => new Map([[KEY, JSON.stringify({ version: 1, off: {}, preset: 'none', machinesHomeMoved: true, mix: { 'miguel/ai-apps': true, 'miguel/snooze-someday': true } })]]);
  const p1 = box({ shell: 'phone', storage: legacy() }); await p1.E.refresh();
  assert.ok(!p1.active().includes('miguel/ai-apps') && p1.active().includes('miguel/snooze-someday'), 'phone: stock view, other tweaks kept');
  const stray = new Map([[KEY, JSON.stringify({ version: 1, off: {}, preset: 'none', machinesHomeMoved: true, mix: {}, views: { phone: 'miguel/ai-apps' } })]]);
  const p2 = box({ shell: 'phone', storage: stray }); await p2.E.refresh();
  assert.deepEqual(p2.views(), []); assert.ok(!p2.active().includes('miguel/ai-apps'));
  assert.deepEqual(JSON.parse(read('web/tweaks/miguel/ai-apps/manifest.json')).shells, ['desktop']);
});
