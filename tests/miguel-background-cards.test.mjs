// miguel/background-cards (Miguel, 4 Nov 2026; release/miguel 257106be + 6514ed8f, ported onto #943/#950): off by default.
// With the tweak on, a twinned skin (Mizel: obsidian/landscapes, each with a -light twin) shows ONE Background row (Plain
// + the #950 wallpapers) and a separate Dark | Light Mode switch, instead of a colour per mode. Off = stock, byte for byte.
// Exercises the real Settings renderer and dispatch (same harness as look-skin-colour-separation).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const source = read('web/core/settings.js');
const TWINS = { obsidian: 'obsidian-light', 'obsidian-light': 'obsidian', landscapes: 'landscapes-light', 'landscapes-light': 'landscapes' };
const WALLS = [{ id: 'landscapes', name: 'Photos', who: 'Photos note' }, { id: 'lake', name: 'Lake', who: 'Lake note' }, { id: 'sea', name: 'Sea', who: 'Sea note' }];

function look({ on, current = 'obsidian', shell = 'desktop' }) {
  const picked = [], walls = [];
  const S = {
    current, wallpaper: 'landscapes', wallpapers: WALLS,
    list: ['nebula', 'grove', 'obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'].map(id => ({ id, name: id, t: {} })),
    families: [{ id: 'wizard', name: 'Wizard', palettes: ['nebula', 'grove'] }, { id: 'mizel', name: 'Mizel', palettes: ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'] }],
    familyOf: id => /^(obsidian|landscapes)/.test(id) ? 'mizel' : 'wizard',
    lastIn: () => null,
    twin(id = this.current) { const t = TWINS[id]; return t ? { id: t, name: t } : null; },
    get wallpaperable() { return /^landscapes/.test(this.current); },
    wallpaperThumb: id => `/thumb/${id}.webp`,
    setWallpaper(id) { walls.push(id); this.wallpaper = id; },
    set(id) { picked.push(id); this.current = id; },
    setFamily() {},
  };
  const s = { console, URL, setTimeout, CSS: { escape: String }, navigator: { userAgent: 'Desktop' },
    document: { activeElement: null, documentElement: {} }, location: { host: 'example.test' }, WizCore: {}, WosSkin: S,
    getComputedStyle: () => ({ getPropertyValue: n => n === '--wos-look-bg-cards' && on ? ' on' : '' }) };
  s.window = s;
  vm.runInNewContext(source, s);
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const view = s.WosSettings.mount(root, { shell, live: { ok: true } });
  view.focus('look');
  const act = (attr, value, feature = 'look') => view.dispatch({ closest: sel => sel === '[data-settings-feature]'
    ? { dataset: { settingsFeature: feature } }
    : sel === `[${attr}]` ? { dataset: { [attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: value } } : null });
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  return { S, root, view, act, settle, picked, walls };
}

test('off by default: Mizel keeps its colour cards and the stock #950 wallpaper picker', () => {
  const p = JSON.parse(read('web/tweaks/miguel/profile.json')), c = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(c.tweaks.includes('miguel/background-cards') && !c.defaults.includes('miguel/background-cards'));
  assert.ok(p.tweaks.includes('miguel/background-cards') && p.off.includes('miguel/background-cards'), 'in the Miguel preset but off');
  assert.match(read('web/tweaks/miguel/background-cards/tweak.css'), /html\[data-tweaks~="miguel\/background-cards"\] \{ --wos-look-bg-cards: on; \}/);
  for (const current of ['obsidian', 'landscapes-light']) {
    const h = look({ on: false, current });
    assert.match(h.root.innerHTML, /<h4>Colors<\/h4>/);
    for (const id of ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light']) assert.match(h.root.innerHTML, new RegExp(`data-skinpick="${id}"`));
    assert.doesNotMatch(h.root.innerHTML, /data-bgpick=|data-skinmode=/);
    assert.equal(/data-wallpaper="lake"/.test(h.root.innerHTML), current.startsWith('landscapes'), 'the #950 picker still shows on Landscapes');
    h.view.destroy();
  }
});

for (const shell of ['phone', 'desktop']) test(`${shell}: on, Mizel shows Background cards + a separate Dark | Light mode, and #950's picker steps aside`, async () => {
  const h = look({ on: true, current: 'obsidian', shell });
  const html = () => h.root.innerHTML;
  assert.match(html(), /<h4>Background<\/h4><div class="skp" role="radiogroup" aria-label="Background">/);
  assert.doesNotMatch(html(), /<h4>Colors<\/h4>|data-skinpick=/, 'no colour-per-mode row');
  for (const id of ['plain', 'landscapes', 'lake', 'sea']) assert.match(html(), new RegExp(`class="skp-card" data-bgpick="${id}"`), 'the same cards as Colors');
  assert.match(html(), /data-bgpick="plain" aria-pressed="true"/);
  assert.match(html(), /data-skinmode="dark">Dark/); assert.match(html(), /aria-checked="false" data-skinmode="light">Light/);
  // Dark -> Light keeps the background (Plain): obsidian -> obsidian-light.
  h.act('data-skinmode', 'light'); await h.settle();
  assert.equal(h.S.current, 'obsidian-light');
  // A scene in light mode: lands on landscapes-light with that wallpaper (reuses #950's setWallpaper).
  h.act('data-bgpick', 'lake'); await h.settle();
  assert.deepEqual([h.S.current, h.walls.at(-1)], ['landscapes-light', 'lake']);
  h.view.focus('look');
  assert.match(html(), /data-bgpick="lake" aria-pressed="true"/);
  assert.doesNotMatch(html(), /data-wallpaper=/, 'one background picker on screen, not two');
  assert.match(html(), /Lake note/);
  // Light -> Dark keeps the scene; Plain keeps the mode.
  h.act('data-skinmode', 'dark'); await h.settle();
  assert.equal(h.S.current, 'landscapes');
  h.act('data-bgpick', 'plain'); await h.settle();
  assert.equal(h.S.current, 'obsidian');
  h.view.destroy();
});

test('on, a skin without twins (Wizard) keeps its colours untouched', () => {
  const h = look({ on: true, current: 'nebula' });
  assert.match(h.root.innerHTML, /<h4>Colors<\/h4>/);
  assert.match(h.root.innerHTML, /data-skinpick="grove"/);
  assert.doesNotMatch(h.root.innerHTML, /data-bgpick=/);
  h.view.destroy();
});
