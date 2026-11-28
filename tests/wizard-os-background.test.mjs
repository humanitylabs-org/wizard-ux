// WizardOS backgrounds (Miguel, 4 Nov 2026): Landscapes can show the official hat instead of the photos.
// The tests run the real core/skins.js (tests/fixtures/skin-palettes-harness.mjs) and the real Settings › Look.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { skinsRuntime, settingsView } from './fixtures/skin-palettes-harness.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const skins = read('web/core/skins.js');
const SCENES = ['lake', 'valley', 'moonrise', 'sea', 'clouds', 'glass'];
const shipped = url => existsSync(new URL('../web/' + url.replace(/^\/wizard-os-home\//, ''), import.meta.url));

test('every scene ships baked for night and day, desktop and phone', () => {
  // The scene painter (skins.js WIZ.get): the file it loads for a wide (desktop) and a tall (phone) screen.
  const loaded = [];
  const wiz = runRecording(`${between(skins, '  const WIZ = {', '  const LANDSCAPES =')}\nthis.WIZ = WIZ;`, { BGL: { dpr: 1 }, customWall: null, Image: class { set src(v) { loaded.push(v); } } }).WIZ;
  for (const id of SCENES) for (const light of [false, true]) for (const [W, H] of [[1600, 900], [390, 844]]) assert.equal(wiz.get(id, light, W, H), null, 'not decoded yet');
  assert.equal(loaded.length, SCENES.length * 4);
  for (const url of loaded) assert.ok(shipped(url), url);
  assert.ok(loaded.includes('/wizard-os-home/core/skins/wizard/lake-light-tall.webp'));
  // The picker's thumbnails, in a dark and a light palette.
  for (const skin of ['landscapes', 'landscapes-light']) {
    const { S } = skinsRuntime({ 'wos.skin': skin });
    for (const id of SCENES) { const url = S.wallpaperThumb(id); assert.match(url, /-thumb\.webp$/); assert.ok(shipped(url), url); }
  }
  assert.ok(existsSync(new URL('../tools/brand/wallpapers.html', import.meta.url)), 'generator kept for provenance');
});

test('Landscapes stays the default and every WizardOS option is listed', () => {
  const { S, store } = skinsRuntime({ 'wos.skin': 'landscapes' });
  assert.deepEqual([...S.wallpapers].map(w => w.id), ['landscapes', ...SCENES]);
  assert.equal(S.wallpaper, 'landscapes', 'Photos by default');
  assert.equal(skinsRuntime({ 'wos.skin': 'landscapes', 'wos.skin.wallpaper': 'bogus' }).S.wallpaper, 'landscapes', 'an unknown saved choice falls back');
  assert.equal(S.setWallpaper('lake'), 'lake'); assert.equal(S.wallpaper, 'lake'); assert.equal(store.get('wos.skin.wallpaper'), 'lake');
  assert.equal(skinsRuntime({ 'wos.skin': 'landscapes', 'wos.skin.wallpaper': 'sea' }).S.wallpaper, 'sea', 'kept per device');
  S.setWallpaper('landscapes'); assert.equal(store.has('wos.skin.wallpaper'), false, 'back to the default');
  assert.throws(() => S.setWallpaper('bogus'), /Unknown background/);
  // The photo painter: a scene draws its baked image, Photos keeps the rotating photos.
  const draw = block(skins, '      draw(c, s, t, dt, W, H, selected = wall) {');
  for (const [selected, scene] of [['lake', true], ['landscapes', false]]) {
    const asked = [], drawn = [];
    const p = runRecording(`const P = { LIGHT: true, HOLD: 1e9, FADE: 1, AVG: ['#111'], load() {}, ${draw} };\nthis.P = P;`, { wall: 'landscapes', WIZ: { get: (...a) => (asked.push(a), { img: 1 }) }, SKINS: [{ t: { bg: '#000' } }], pos: 0 }).P;
    p.draw({ drawImage: (...a) => drawn.push(a), fillRect() {} }, { img: {}, cur: 0 }, 0, 0, 800, 600, selected);
    assert.deepEqual(asked.map(a => a[0]), scene ? ['lake'] : [], selected);
    if (scene) assert.equal(asked[0][1], true, 'the day image in a light palette');
  }
});

test('twinned skins keep Skins alongside Background cards and separate Dark | Light mode', () => {
  const { S, documentElement } = skinsRuntime({ 'wos.skin': 'landscapes' }); documentElement.dataset.shell = 'phone';
  assert.equal(S.wallpaperable, true);
  const v = settingsView({ WosSkin: S });
  const page = () => { const doc = createDocument(); doc.body.innerHTML = v.html(); return doc.body; };
  let body = page();
  assert.deepEqual(body.querySelectorAll('h4').map(h => h.textContent).slice(0, 3), ['Skins', 'Mode', 'Background'], 'Skins stays beside Background and Mode');
  assert.deepEqual(body.querySelectorAll('[data-bgpick]').map(b => b.dataset.bgpick), ['plain', 'landscapes', ...SCENES]);
  assert.ok(body.querySelectorAll('[data-bgpick]').every(b => b.className === 'skp-card'), 'the same cards as Colors');
  assert.equal(body.querySelector('[data-bgpick][aria-pressed="true"]').dataset.bgpick, 'landscapes');
  const style = body.querySelector('[data-bgpick="lake"] .skp-mini').getAttribute('style'), thumb = style.slice(style.indexOf('background:')); // after the preview palette's own --p-* tokens
  assert.match(thumb, /color-mix\(in srgb, var\(--p-bg, var\(--wz-bg\)\)/, 'thumbnail shading follows the preview skin with a shell-token fallback');
  assert.doesNotMatch(thumb, /rgba?\(\s*\d/, 'thumbnails carry no literal colour');
  assert.deepEqual(body.querySelectorAll('[data-skinmode]').map(b => `${b.dataset.skinmode}:${b.getAttribute('aria-checked')}`), ['dark:true', 'light:false']);
  v.act('look', 'data-skinmode', 'light'); assert.equal(S.current, 'landscapes-light', 'Light picks the twin');
  v.act('look', 'data-bgpick', 'lake'); assert.equal(S.wallpaper, 'lake'); assert.equal(S.current, 'landscapes-light', 'a background keeps the mode');
  v.act('look', 'data-bgpick', 'plain'); assert.equal(S.current, 'obsidian-light', 'Plain is the plain twin, same mode');
  body = page(); assert.equal(body.querySelector('[data-bgpick][aria-pressed="true"]').dataset.bgpick, 'plain');
  // A skin with no twins shows no Background or Mode.
  const one = skinsRuntime({ 'wos.skin': 'nebula' }); one.documentElement.dataset.shell = 'phone';
  const doc = createDocument(); doc.body.innerHTML = settingsView({ WosSkin: one.S }).html();
  assert.equal(doc.body.querySelectorAll('[data-bgpick], [data-skinmode]').length, 0);
  assert.doesNotMatch(read('web/core/settings.js'), /register\(\{ id: 'wallpaper'/);
});

test('wallpaper generator dispatches only explicit scenes, never query-selected methods', () => {
 const page=read('tools/brand/wallpapers.html');
 const callback=page.slice(page.indexOf('hat.onload ='),page.indexOf('</script>'));
 for(const C of ['lake','valley','moonrise','sea','clouds','glass','constructor','toString','__proto__','hasOwnProperty','bogus']){
  const calls=[],R={};for(const scene of ['lake','valley','moonrise','sea','clouds','glass'])R[scene]=light=>calls.push([scene,light]);
  const context={hat:{},Q:new URLSearchParams('light=1'),C,R,document:{title:''}};
  vm.runInNewContext(callback+';hat.onload()',context);
  if(['lake','valley','moonrise','sea','clouds','glass'].includes(C)){assert.deepEqual(calls,[[C,true]]);assert.equal(context.document.title,'done')}
  else {assert.deepEqual(calls,[]);assert.equal(context.document.title,'Invalid scene')}
 }
});
