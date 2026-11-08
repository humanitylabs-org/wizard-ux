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
  const views = () => s.WosExperience.state.tweaks.filter(t=>t.on && VIEWS.includes(t.id)).map(t=>t.id);
  return { s, root, view, tap, storage, views, active: () => [...new Set([...active, ...s.WosExperience.state.tweaks.filter(t=>t.view && t.on).map(t=>t.id)])], loads, E: s.WosExperience };
}
// the switches as rendered: [id, name, on]
const switches = html => [...html.matchAll(/data-tweak-toggle="([^"]+)" role="switch" aria-checked="(true|false)"[^>]*><span class="st-tx"><b>([^<]+)<\/b>/g)].map(m => [m[1], m[3], m[2] === 'true']);
// in VIEWS order (Orb, Apps) whatever the list's order (one flat A-to-Z list since main's #820)
const viewSwitches = html => VIEWS.map((v,i) => switches(html).find(([id]) => id === v) || (new RegExp(`data-desktop-view="${['orb','apps'][i]}" role="radio" aria-checked="(true|false)"`).exec(html) || []).map((_,n,a)=>n===0 ? [v, ['Different shell view - Orb','Different shell view - Apps'][i], a[1]==='true'] : null)[0]).filter(Boolean);
const look = async b => { b.view.focus('look'); await tick(); return b.root.innerHTML; };

for (const shell of ['desktop', 'phone']) test(`${shell}: no Shell view row; Miguel's Tweaks list has both shell views as plain switches, off`, async () => {
  const b = box({ shell }); await b.E.refresh();
  const html = await look(b);
  if(shell==='phone') assert.doesNotMatch(html, /Shell view|data-shellview|sv-seg|sv-group/, 'phone unchanged'); else {
    const picker = html.match(/<div role="radiogroup" aria-label="Shell view">([^]*?)<\/div>/)?.[1];
    assert.match(picker, /data-desktop-view="ai-apps"/);
    assert.doesNotMatch(picker, /designed by|credit|<small>/i, 'layout picker ignores even supplied credit metadata; skin and tweak names stay unchanged');
  }
  assert.deepEqual(viewSwitches(html), [['miguel/orb-shell', 'Different shell view - Orb', false], ['miguel/apps-home', 'Different shell view - Apps', false]]);
  // one flat list (Miguel, 1 Nov 2026): no author sections, each row says who made it
  assert.doesNotMatch(html, /tw-author|data-tweakauthor|All of /, 'no per-author quick buttons');
  if(shell==='phone') for (const id of VIEWS) assert.match(html, new RegExp(`data-tweak-toggle="${id}"[^]*?class="tw-by">${shell === 'desktop' ? 'Desktop' : 'Phone'} view · by (Miguel|miguel)<`), id + ' labelled by Miguel, for this device type');
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
  assert.deepEqual(JSON.parse(storage.get(KEY)).views, { desktop: 'miguel/apps-home' }, 'one view stored for this device type');
  const again = box({ storage }); await again.E.refresh();
  assert.deepEqual(again.views(), ['miguel/apps-home'], 'a reload keeps Apps');
  // api.settings.toggleTweak (WosExperience.toggle) takes the same path
  await again.E.toggle('miguel/orb-shell'); assert.deepEqual(again.views(), ['miguel/orb-shell']);
});

test('AI apps is a third shell view: on turns Orb and Apps off, Orb or Apps on turns it off, off again = Desks', async () => {
  const b = box(); await b.E.refresh();
  await b.E.chooseDesktopView('classic');
  const worn = () => b.active().filter(id => [...VIEWS, 'miguel/ai-apps'].includes(id));
  b.tap('miguel/orb-shell'); await tick();
  b.tap('miguel/ai-apps'); await tick(); assert.deepEqual(worn(), ['miguel/ai-apps'], 'AI apps on turns Orb off');
  b.tap('miguel/apps-home'); await tick(); assert.deepEqual(worn(), ['miguel/apps-home'], 'Apps on turns AI apps off');
  b.tap('miguel/ai-apps'); await tick(); b.tap('miguel/ai-apps'); await tick(); assert.deepEqual(worn(), [], 'the worn one off = Desks');
});

test('a device that stores both on wears only the first in catalog order (Orb), and the switches agree', async () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.indexOf('miguel/orb-shell') < cat.tweaks.indexOf('miguel/apps-home'));
  const storage = new Map([[KEY, JSON.stringify({ version: 1, off: {}, preset: 'none', machinesHomeMoved: true, mix: { 'miguel/orb-shell': true, 'miguel/apps-home': true, 'miguel/snooze-someday': true } })]]);
  const b = box({ storage }); await b.E.refresh();
  assert.deepEqual(b.views(), ['miguel/orb-shell']);
  assert.ok(b.active().includes('miguel/snooze-someday'), 'the rest of the mix is untouched');
  assert.deepEqual(viewSwitches(await look(b)).map(v => v[2]), [true, false]);
  b.tap('miguel/apps-home'); await tick(); assert.deepEqual(b.views(), ['miguel/apps-home']);
  b.tap('miguel/apps-home'); await tick(); assert.deepEqual(b.views(), [], 'off = Desks, the stale Orb on is cleared too');
  // his phone today (Apps on, Orb off as the old row stored it) keeps Apps
  const phone = box({ shell: 'phone', storage: new Map([[KEY, JSON.stringify({ version: 1, off: {}, preset: 'none', machinesHomeMoved: true, mix: { 'miguel/orb-shell': false, 'miguel/apps-home': true } })]]) });
  await phone.E.refresh(); assert.deepEqual(phone.views(), ['miguel/apps-home']);
});

for (const shell of ['desktop', 'phone']) test(`${shell}: each switch wears its layout; both off is exactly the stock shell`, async () => {
  for (const [id, layout] of [['', 'classic'], ['miguel/orb-shell', 'orb'], ['miguel/apps-home', 'apps']]) {
    const b = box({ shell }); await b.E.refresh(); if (shell==='desktop' && !id) await b.E.chooseDesktopView('classic'); if (id) { b.tap(id); await tick(); }
    const f = fixture({ shell });
    if(shell==='desktop') f.host.setStandardLayout(b.E.desktopView);
    await f.host.loadTweaks(shell==='desktop'?[]:b.views(), f.slots, { teamAuthors: ['miguel'] });
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
  assert.match(settings, /data-desktop-view/);
  assert.doesNotMatch(settings, /data-shellview/);
  assert.doesNotMatch(css, /\.sv-(group|seg)/);
  assert.doesNotMatch(exp, /chooseView/);
  assert.match(settings, /E\.desktopViews\?\.length && t\.layout/, 'built-in desktop views are not duplicate personal switches');
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

// Per device type (Miguel, 4 Nov 2026): the desktop and the phone each wear their own view (or Desks). The same browser
// storage serves both shells here, as it does for desktop.html and index.html on one origin.
test('per shell type: the desktop wears AI apps while the phone wears Orb; each switch acts on its own type only', async () => {
  const storage = new Map();
  const worn = b => b.active().filter(id => [...VIEWS, 'miguel/ai-apps'].includes(id));
  const desk = box({ storage }); await desk.E.refresh();
  await desk.E.chooseDesktopView('ai-apps'); await tick();
  const phone = box({ shell: 'phone', storage }); await phone.E.refresh();
  assert.deepEqual(worn(phone), [], 'the desktop choice leaves the phone on Desks');
  phone.tap('miguel/orb-shell'); await tick();
  assert.deepEqual(worn(phone), ['miguel/orb-shell']);
  const again = box({ storage }); await again.E.refresh();
  assert.deepEqual(worn(again), ['miguel/ai-apps'], 'the phone choice leaves the desktop on AI apps');
  assert.deepEqual(JSON.parse(storage.get(KEY)).views, { desktop: 'miguel/ai-apps', phone: 'miguel/orb-shell' });
  const html = await look(phone);
  assert.doesNotMatch(html, /data-tweak-toggle="miguel\/ai-apps"/, 'a desktop-only view is not offered on the phone');
  assert.deepEqual(viewSwitches(html).map(v => v[2]), [true, false]);
  await phone.E.toggle('miguel/ai-apps'); assert.deepEqual(worn(phone), ['miguel/orb-shell'], 'and cannot be switched on there');
  phone.tap('miguel/orb-shell'); await tick();
  assert.deepEqual(worn(phone), [], 'off on the phone = Desks on the phone');
  const last = box({ storage }); await last.E.refresh(); assert.deepEqual(worn(last), ['miguel/ai-apps'], 'the desktop keeps its view');
});

test('the phone ignores a desktop-only view: an old mix with AI apps on, or a stray phone choice of it, is Desks there', async () => {
  const legacy = () => new Map([[KEY, JSON.stringify({ version: 1, off: {}, preset: 'none', machinesHomeMoved: true, mix: { 'miguel/ai-apps': true, 'miguel/snooze-someday': true } })]]);
  const desk = box({ storage: legacy() }); await desk.E.refresh();
  assert.ok(desk.active().includes('miguel/ai-apps'), 'desktop: the old single view keeps its meaning');
  const phone = box({ shell: 'phone', storage: legacy() }); await phone.E.refresh();
  assert.ok(!phone.active().includes('miguel/ai-apps') && phone.active().includes('miguel/snooze-someday'), 'phone: stock view, other tweaks kept');
  const stray = new Map([[KEY, JSON.stringify({ version: 1, off: {}, preset: 'none', machinesHomeMoved: true, mix: {}, views: { phone: 'miguel/ai-apps' } })]]);
  const p2 = box({ shell: 'phone', storage: stray }); await p2.E.refresh();
  assert.deepEqual(p2.views(), []); assert.ok(!p2.active().includes('miguel/ai-apps'));
  assert.deepEqual(JSON.parse(read('web/tweaks/miguel/ai-apps/manifest.json')).shells, ['desktop']);
  for (const id of VIEWS) assert.deepEqual(JSON.parse(read(`web/tweaks/${id}/manifest.json`)).shells, ['desktop', 'phone'], id);
});


test('legacy single Apps choice maps to both supported shells until each explicitly chooses otherwise', async () => {
  const storage = new Map([[KEY, JSON.stringify({ version: 1, off: {}, preset: 'none', machinesHomeMoved: true, mix: { 'miguel/apps-home': true } })]]);
  const desk = box({ storage }); await desk.E.refresh();
  assert.deepEqual(desk.views(), ['miguel/apps-home']);
  const phone = box({ shell: 'phone', storage }); await phone.E.refresh();
  assert.deepEqual(phone.views(), ['miguel/apps-home']);
  await desk.E.toggle('miguel/orb-shell');
  const phoneAgain = box({ shell: 'phone', storage }); await phoneAgain.E.refresh();
  assert.deepEqual(phoneAgain.views(), ['miguel/apps-home'], 'choosing desktop never drops legacy phone choice');
  await phoneAgain.E.toggle('miguel/apps-home');
  const deskAgain = box({ storage }); await deskAgain.E.refresh();
  assert.deepEqual(deskAgain.views(), ['miguel/orb-shell']);
  assert.deepEqual(JSON.parse(storage.get(KEY)).views, { desktop: 'miguel/orb-shell', phone: '' });
});
