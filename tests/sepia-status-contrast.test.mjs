import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';

const css = readFileSync(new URL('../web/skins/sepia/skin.css', import.meta.url), 'utf8');

const hex = value => {
  const h = value.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
const lum = rgb => rgb.map(v => {
  const x = v / 255;
  return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
}).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
// A colour as drawn over the page: #rrggbb, or rgba() blended over `under`.
const over = (value, under) => {
  if (/^#[0-9a-f]{6}$/i.test(value)) return hex(value);
  const m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(value); assert.ok(m, value);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return [1, 2, 3].map((k, i) => Math.round(Number(m[k]) * a + under[i] * (1 - a)));
};

test('Sepia status labels use paper-safe semantic colours', () => {
  // Chats rows and a thread header (skeleton of the real markup) with every status mark, on Sepia
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', 'sepia');
  const kinds = { needs: 'needs', approval: 'needs', offline: 'needs', check: 'check', done: 'done', fyi: 'fyi', failed: 'failed' };
  doc.body.innerHTML = Object.keys(kinds).map(k => `<button class="ch-row" data-k="${k}"><span class="emo sti ${k}"></span><span class="bd"><span class="pv"><em class="att ${k}">${k}</em> words</span></span></button>`).join('')
    + '<div class="ch-head"><span class="emo sti needs" id="head"></span></div>';
  const vars = cascade(doc.documentElement, css);
  const resolve = v => { const m = /^var\((--[\w-]+)\)$/.exec(v || ''); return m ? vars[m[1]]?.value : v; };
  const paper = hex('#f6edda');
  for (const [k, role] of Object.entries(kinds)) {
    const row = doc.querySelector(`[data-k="${k}"]`);
    const mark = cascade(row.querySelector('.emo.sti'), css).color?.value;
    assert.equal(mark, `var(--sepia-status-${role})`, `${k}: the row mark`);
    const value = resolve(mark);
    assert.match(value || '', /^#[0-9a-f]{6}$/i, `${role} role exists`);
    assert.ok(contrast(hex(value), paper) >= 4.5, `${role} reaches 4.5:1 on Sepia paper`);
    if (k !== 'offline') assert.equal(cascade(row.querySelector('em.att'), css).color?.value, `var(--sepia-status-${role})`, `${k}: the preview label`);
  }
  assert.equal(cascade(doc.getElementById('head'), css).color?.value, 'var(--sepia-status-needs)', 'the thread header mark');
});
