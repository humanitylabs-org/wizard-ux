import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withAppParts } from './fixtures/app-parts.mjs';
import { runTitleContrast } from './fixtures/r8A-title-contrast.mjs';

// Borderless app windows paint their heading in the app's colour (dark default, or the colour the phone measured along
// the app's top), so the title and buttons there must not use the skin's ink: Landscapes Light put its dark ink on the
// dark default heading. Behaviour (real Chromium, every skin, both shells): tools/qa-app-window-title-contrast.cjs.
const css = fs.readFileSync(new URL('../web/core/skin-frame.css', import.meta.url), 'utf8');
const app = withAppParts(fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));
const rule = (sel) => { const i = css.indexOf(sel + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)); };
// Named-colour inks (the style check bans rgb()/hex literals): white, or black mixed toward white by N%.
const rgbOf = (v) => v.trim() === 'white' ? 'rgb(255, 255, 255)' : v.trim() === 'black' ? 'rgb(0, 0, 0)' : (/^color-mix\(in srgb, black (\d+)%, white\)$/.exec(v.trim()) || [])[1]
  ? `rgb(${Array(3).fill(Math.round(255 * (100 - /black (\d+)%/.exec(v)[1]) / 100)).join(', ')})` : v;
const lum = (s) => { const [r, g, b] = rgbOf(s).match(/[\d.]+/g).map(Number), f = (c) => (c /= 255) <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const UNTHEMED = 'html[data-skin-frame="borderless"] .win:has(> .wbody iframe):not(.wz-themed):not(:has(> .wbody .st-embed iframe)) > .wbar';
const LIGHT = 'html[data-skin-frame="borderless"] .win.edge-light:has(> .wbody iframe):not(.wz-themed):not(:has(> .wbody .st-embed iframe)) > .wbar';

test('an unthemed app heading carries its own light ink, readable on the dark default heading', () => {
  const r = rule(UNTHEMED);
  assert.ok(r, 'skin-frame.css sets the ink of an unthemed app window heading');
  const ink = /--ink:\s*([^;]+);/.exec(r)?.[1];
  assert.ok(ink, 'the rule sets --ink (title and buttons read it)');
  for (const bg of ['rgb(5, 3, 12)', 'rgb(15, 16, 20)']) // desktop and phone fallbacks in the same file
    assert.ok(ratio(ink, bg) >= 4.5, `ink ${ink} on ${bg}: ${ratio(ink, bg).toFixed(2)}`);
  assert.match(css, /#05030c/); assert.match(css, /#0f1014/);
});

test('a heading measured as light gets a dark ink; Settings keeps the skin ink', () => {
  const ink = /--ink:\s*([^;]+);/.exec(rule(LIGHT))?.[1];
  assert.ok(ink, 'skin-frame.css sets a dark --ink for .edge-light app headings');
  assert.ok(ratio(ink, 'rgb(250, 250, 250)') >= 4.5);
  assert.ok(UNTHEMED.includes(':not(:has(> .wbody .st-embed iframe))'));
});

// The phone's real frameEdge (web/app.js), run in a vm against a fake app document and a canvas that reads back the
// rgb() colour it was filled with.
function edge({ bg = '', top = '' }) {
  const i = app.indexOf('  function frameEdge(f) {'), body = app.slice(i, app.indexOf('\n  }\n', i) + 4);
  const classes = {}, style = {};
  const we = { classList: { toggle: (c, on) => { classes[c] = !!on; } }, style: { setProperty: (k, v) => { style[k] = v; }, removeProperty: k => { delete style[k]; } } };
  const header = { tagName: 'HEADER', parentElement: null, getBoundingClientRect: () => ({ width: 400 }), bg: top };
  const html = { tagName: 'HTML', clientWidth: 400, bg: '' };
  const view = { __wosTopWatch: 1, getComputedStyle: el => ({ backgroundColor: el.bg || 'rgba(0, 0, 0, 0)', backgroundImage: 'none' }) };
  const d = { documentElement: html, body: { bg }, styleSheets: [], defaultView: view, querySelector: () => null, elementFromPoint: () => header, addEventListener() {} };
  const canvas = () => { let fill = ''; return { getContext: () => ({ set fillStyle(v) { fill = v; }, fillRect() {}, getImageData: () => ({ data: [...(fill.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number), 255] }) }) }; };
  const ctx = vm.createContext({ document: { createElement: canvas }, setTimeout, clearTimeout });
  vm.runInContext(body + '\nthis.frameEdge = frameEdge;', ctx);
  ctx.frameEdge({ closest: () => we, contentDocument: d, isConnected: true });
  return { light: classes['edge-light'], style };
}

test('the phone marks a light measured heading (.edge-light) from the colour it paints', () => {
  assert.equal(edge({ bg: 'rgb(10, 10, 10)', top: 'rgb(250, 250, 250)' }).light, true, 'a light header along the top: dark ink');
  assert.equal(edge({ bg: 'rgb(250, 250, 250)', top: 'rgb(20, 20, 30)' }).light, false, 'decided on the colour the heading actually shows (top, else bg)');
  assert.equal(edge({ bg: 'rgb(240, 240, 240)' }).light, true, 'no top colour: the page background decides');
  assert.equal(edge({ bg: 'rgb(15, 16, 20)' }).light, false);
  assert.equal(edge({}).light, false, 'nothing measured keeps the light ink on the dark fallback');
  assert.equal(edge({ bg: 'rgb(10, 10, 10)', top: 'rgb(250, 250, 250)' }).style['--frame-top'], 'rgb(250, 250, 250)');
});

// Cover the switch boundary as well as near-white; a softened black failed midtone titles.
test('both title inks meet 4.5:1 throughout the neutral painted colour range', () => {
  const dark = /--ink:\s*([^;]+);/.exec(rule(LIGHT))[1];
  const light = /--ink:\s*([^;]+);/.exec(rule(UNTHEMED))[1];
  for (let c = 0; c <= 255; c++) {
    const bg = `rgb(${c}, ${c}, ${c})`;
    assert.ok(ratio(lum(bg) > .18 ? dark : light, bg) >= 4.5, bg);
  }
});
// The browser check itself (tools/qa-app-window-title-contrast.cjs) run against a fake Chromium whose titles measure a
// chosen contrast (tests/fixtures/r8A-title-contrast.mjs).
test('browser acceptance cannot relax normal title contrast below 4.5:1', async () => {
  const ok = await runTitleContrast({ text: [255, 255, 255], behind: [5, 3, 12], env: { QA_SKINS: 'nebula' } });
  assert.equal(ok.exitCode, 0, ok.logs.join('\n')); assert.equal(ok.results.min, 4.5);
  // the phone opens the translucent synthetic apps (the measured top colour over the dark fallback), one at a time
  for (const app of ['synthetic-translucent-dark', 'synthetic-translucent-light']) assert.ok(ok.opened.phone.includes(app), app);
  assert.ok(ok.results.rows.some(r => r.shell === 'phone' && r.app === '/synthetic-translucent-light/'));
  // 4.43:1 fails even when the run asks for 3:1
  const low = await runTitleContrast({ text: [115, 115, 115], behind: [0, 0, 0], env: { QA_SKINS: 'nebula', QA_MIN_CONTRAST: '3' } });
  assert.equal(low.results.min, 4.5);
  assert.equal(low.exitCode, 1); assert.equal(low.results.bad.length, low.results.rows.length);
  assert.match(low.logs.at(-1), /FAIL \d+ title\(s\) under 4.5:1/);
});
