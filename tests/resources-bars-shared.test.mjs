// Home resource bars as one shared renderer (WosResources.bars): Home on skins that draw bars and Settings › Resources
// draw the same groups (AI resources, Compute resources) from one list, so a page never hand-rolls its own meters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('web/core/resources.js');

test('one group list feeds every bar host; Settings hosts count as viewers so readings stay fresh', () => {
  assert.match(src, /const GROUPS=\[\s*\{id:'ai',cls:'rs-bg-ai',title:'AI resources'[^]*\{id:'hw',cls:'rs-bg-hw',title:'Compute resources'/);
  assert.match(src, /function bars\(host\)\{if\(!host\)return;S\.extra\.add\(host\);paintBars\(host,true\)/);
  assert.match(src, /const viewing=\(\)=>active\(\)\|\|\(!document\.hidden&&\[\.\.\.S\.extra\]\.some\(h=>h\.isConnected\)\)/);
  assert.match(src, /for\(const h of \[\.\.\.S\.extra\]\)\{if\(h\.isConnected\)paintBars\(h\);else S\.extra\.delete\(h\);\}/, 'detached hosts are dropped');
  assert.match(src, /window\.WosResources=\{bars,barsHtml:[^}]*lowest,groups:/);
});
test('Settings styles the bars in the skin\'s own tokens (stock skins included), scoped to the Resources page', () => {
  const css = read('web/core/settings.css');
  assert.match(css, /\.st-root \.st-res \.rs-barsw\.rs-widget\.wz-home-widget \{/);
  for (const sel of ['.st-res .rs-bf', '.st-res .rs-bs.rs-crit .rs-bf', '.st-res .rs-br-off .rs-bs']) assert.ok(css.includes(sel + ' {'), sel);
  assert.doesNotMatch(css.slice(css.indexOf('Settings › Resources')), /html\[data-skin/, 'no per-skin rules');
});
