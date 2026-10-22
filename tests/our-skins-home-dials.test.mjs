import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../web/core/resources.js', import.meta.url), 'utf8');
function render(skin) {
  const ctx = { window: {}, document: { documentElement: { dataset: { skin } }, addEventListener() {}, querySelectorAll: () => [], hidden: false },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), AbortController };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.runInNewContext(src, ctx);
  return ctx.WosResources.home();
}

test('Miguel skins get the compact dial strip, James skins keep the meters', () => {
  for (const s of ['obsidian', 'obsidian-light', 'landscapes']) {
    const h = render(s);
    assert.match(h, /rs-dialed/, s); assert.doesNotMatch(h, /rs-bar|rs-warning-note|rs-health-alert/, s);
  }
  for (const s of ['nebula', 'grove', 'tide', 'ember', 'signal']) {
    const h = render(s);
    assert.doesNotMatch(h, /rs-dialed/, s); assert.match(h, /rs-zone/, s);
  }
});

test('home dial styles live only in our skin packages', () => {
  for (const f of ['obsidian', 'landscapes']) assert.match(fs.readFileSync(new URL(`../web/skins/${f}/skin.css`, import.meta.url), 'utf8'), /\.rs-dialed/);
  for (const f of ['../web/styles.css', '../web/core/resources.css', '../web/core/skins.css']) assert.doesNotMatch(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /\.rs-dialed/);
});

test('Miguel skins draw speedometer gauges that start at zero and sit at the top on phone', () => {
  for (const s of ['obsidian', 'obsidian-light', 'landscapes']) {
    const h = render(s);
    assert.match(h, /class="rs-ndl"/, s); assert.match(h, /class="rs-tick rs-major"/, s);
    assert.match(h, /--a:rotate\(-120\.0deg\)/, `${s}: needle starts at zero`);
  }
  for (const f of ['obsidian', 'landscapes']) {
    const css = fs.readFileSync(new URL(`../web/skins/${f}/skin.css`, import.meta.url), 'utf8');
    assert.match(css, /\[data-shell="phone"\] \.home \[data-home-resources\] \{ order: -1;/, f);
    assert.match(css, /\[data-home-resources\] \.rs-dialed\.rs-widget\.wz-home-widget \{ background: none; border: 0;/, `${f}: no panel`);
  }
});
