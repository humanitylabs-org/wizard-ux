// Wizard OS backgrounds (Miguel, 4 Nov 2026): Landscapes can show the official hat instead of the photos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const skins = read('web/core/skins.js'), settings = read('web/core/settings.js');

test('every scene ships baked for night and day, desktop and phone', () => {
  assert.match(skins, /\/wizard-os-home\/core\/skins\/wizard\/\$\{id\}/);
  for (const id of ['lake', 'valley', 'moonrise', 'sea', 'clouds', 'glass']) for (const tone of ['', '-light']) for (const shape of ['wide', 'tall', 'thumb'])
    assert.ok(existsSync(new URL(`../web/core/skins/wizard/${id}${tone}-${shape}.webp`, import.meta.url)), `${id}${tone}-${shape}`);
  assert.ok(existsSync(new URL('../tools/brand/wallpapers.html', import.meta.url)), 'generator kept for provenance');
});

test('Landscapes stays the default and every Wizard OS option is listed', () => {
  for (const id of ['landscapes', 'lake', 'valley', 'moonrise', 'sea', 'clouds', 'glass']) assert.match(skins, new RegExp(`id: '${id}'`));
  assert.match(skins, /: 'landscapes'; \} catch \(_\) \{ return 'landscapes'; \}/);
  assert.match(skins, /if \(selected !== 'landscapes'\) \{ const w = WIZ\.get\(selected, this\.LIGHT, W, H\)/);
  assert.match(skins, /setWallpaper\(id\) \{/);
});

test('twinned skins keep Colors alongside Background cards and separate Dark | Light mode', () => {
  assert.match(settings, /!own && \(S\.wizardBackgrounds \|\| twinned\(S, family\)\) \? backgroundHtml\(S, family, cur, ctx\) : ''/);
  assert.match(settings, /const colours = `<div class="skp-colours"><h4>Colors<\/h4>/, 'the separate Color control stays on every skin');
  assert.match(settings, /class="skp-card" data-bgpick=/, 'the same cards as Colors');
  const background = settings.slice(settings.indexOf('function backgroundHtml('), settings.indexOf('function backgroundAct('));
  assert.match(background, /color-mix\(in srgb, var\(--p-bg, var\(--wz-bg\)\)/, 'thumbnail shading follows the preview skin with a shell-token fallback');
  assert.doesNotMatch(background, /rgba?\(\s*\d/, 'new thumbnails introduce no literal colour');
  assert.match(settings, /data-skinmode="\$\{m\}"/);
  assert.match(settings, /if \(backgroundAct\(ctx, el, pickPalette\)\) return true;/);
  assert.doesNotMatch(settings, /register\(\{ id: 'wallpaper'/);
  assert.match(skins, /get wallpaperable\(\) \{ return this\.wizardBackgrounds \|\| \/\^landscapes\/\.test/);
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
