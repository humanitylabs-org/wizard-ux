// The tour's instruction text must be readable even if its entrance animation never advances. WebKit (iPhone Safari,
// Telegram's in-app browser, Home Screen app) held the beat-1 entrance at frame 0 for 1.3-2.2 s while the shell booted;
// with opacity in the keyframes "Tap the orb and say hello" was invisible that whole time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument, matches } from './fixtures/mini-dom.mjs';
import { cascade, parseCss } from './fixtures/mini-css.mjs';
const css = readFileSync(new URL('../web/core/tour.css', import.meta.url), 'utf8');
// The frames of one @keyframes block, parsed: { 'from': { prop: value }, ... }.
const keyframes = name => {
  const at = css.indexOf(`@keyframes ${name} {`); if (at < 0) return null;
  let i = css.indexOf('{', at) + 1, depth = 1; const start = i;
  for (; i < css.length && depth; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; }
  return Object.fromEntries(parseCss(css.slice(start, i - 1)).map(r => [r.selector, Object.fromEntries(Object.entries(r.decls).map(([k, d]) => [k, d.value]))]));
};
test('the tour entrance (trIn) animates movement only: no opacity, visibility or blur in its keyframes', () => {
  const frames = keyframes('trIn');
  assert.ok(frames && Object.keys(frames).length, 'trIn keyframes exist');
  for (const [at, decls] of Object.entries(frames)) for (const prop of Object.keys(decls)) assert.ok(!/opacity|visibility|filter/.test(prop), `${at}: ${prop}`);
  // the beat-1 copy enters with trIn and is readable at its first frame (no hidden state of its own)
  const doc = createDocument(); doc.body.innerHTML = '<div class="tr-copy in"><b>Tap the orb and say hello</b></div>';
  const look = cascade(doc.querySelector('.tr-copy'), css);
  assert.match(look.animation?.value || '', /^trIn\b/);
  assert.notEqual(look.opacity?.value, '0'); assert.notEqual(look.visibility?.value, 'hidden');
});
test('every element that enters with trIn is tour copy, a glyph or the desktop guide', () => {
  // the tour's own pieces (tour.js markup): its copy, a gesture glyph, the desktop guide card and its ring
  const doc = createDocument();
  doc.body.innerHTML = '<div class="tr"><div class="tr-copy in"><b>Tap the orb</b></div><div class="tr-g"><span class="tr-gi tap"><i></i></span></div></div><div class="dtr"><b>Say hello</b></div><div class="dtr-ring"></div>';
  const pieces = ['.tr-copy', '.tr-g', '.dtr', '.dtr-ring'].map(q => doc.querySelector(q));
  for (const el of pieces) {
    const look = cascade(el, css);
    assert.match(look.animation?.value || '', /^trIn\b/, `${el.className} enters with trIn`);
    assert.notEqual(look.opacity?.value, '0', `${el.className} is readable from its first frame`);
  }
  // and no other element does: every rule that starts trIn reaches only those pieces
  const users = parseCss(css).filter(r => /\btrIn\b/.test(r.decls.animation?.value || ''));
  assert.ok(users.length >= 3);
  const others = ['.tr', '.tr b', '.dtr b', '.tr-gi', '.tr-gi i'].map(q => doc.querySelector(q));
  for (const el of others) assert.doesNotMatch(cascade(el, css).animation?.value || '', /\btrIn\b/, `${el.className || el.localName} does not`);
  for (const r of users) assert.ok(pieces.some(el => r.selectors.some(sel => matches(el, sel))), `${r.selector}: a tour piece`);
});
