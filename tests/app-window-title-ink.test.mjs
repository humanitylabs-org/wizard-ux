import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Borderless app windows paint their heading in the app's colour (dark default, or the colour the phone measured along
// the app's top), so the title and buttons there must not use the skin's ink: Landscapes Light put its dark ink on the
// dark default heading. Behaviour (real Chromium, every skin, both shells): tools/qa-app-window-title-contrast.cjs.
const css = fs.readFileSync(new URL('../web/core/skin-frame.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
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

test('the phone marks a light measured heading (.edge-light) from the colour it paints', () => {
  const i = app.indexOf('function frameEdge(f)'), body = app.slice(i, app.indexOf('\n  }\n', i));
  assert.match(body, /classList\.toggle\('edge-light'/);
  assert.match(body, /top \|\| bg/, 'decided on the colour the heading actually shows (top, else bg)');
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
test('browser acceptance cannot relax normal title contrast below 4.5:1', () => {
  const qa = fs.readFileSync(new URL('../tools/qa-app-window-title-contrast.cjs', import.meta.url), 'utf8');
  assert.match(qa, /Math.max\(4\.5,/);
  assert.match(qa, /synthetic-translucent/);
});
