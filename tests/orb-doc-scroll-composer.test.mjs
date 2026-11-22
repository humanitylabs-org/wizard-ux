// Guard for James's 8 Nov 2026 report (full-screen Working thread on the Android app: composer narrow and tall,
// Stop short of the edge, orb parked below). The browser proof is qa-orb-doc-scroll-composer.cjs (run it with and
// without QA_DOC=1); this runs the two rules: the real stylesheet cascade and the real resume/dock listeners.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { between, runRecording } from './fixtures/source-slice.mjs';
const css = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
const focus = readFileSync(new URL('../web/core/chats-focus.js', import.meta.url), 'utf8');
const composer = docScroll => {
  const doc = createDocument();
  if (docScroll) doc.documentElement.setAttribute('class', 'wos-doc-scroll');
  doc.body.innerHTML = '<div class="device orb-corner" id="device"><div class="win full"><div class="wos-doc-thread"><form class="ch-compose"></form></div></div></div>';
  return cascade(doc.querySelector('.ch-compose'), css)['padding-right'].value;
};
test('the corner orb reserves no composer column when the composer is pinned above the bottom strip (Android document scroll)', () => {
  assert.equal(composer(true), '10px');
  assert.match(composer(false), /var\(--corner-orb\)/, 'the in-frame composer still keeps the orb column');
});
test('the pinned composer re-measures the bottom strip on resume and when the dock animation ends', () => {
  const on = (who) => { const l = {}; return { l, addEventListener: (t, f) => (l[t] ||= []).push(f) }; };
  const doc = on(), win = on(), frames = [];
  doc.body = {}; doc.getElementById = () => null;
  const code = between(focus, '    const queueDocumentThread = ', '    // Desk changes / Back');
  const ctx = runRecording(code, { document: doc, window: win, chatVars: { docFrame: 0 }, requestAnimationFrame: f => { frames.push(f); return frames.length; } });
  const fire = (t, e = {}) => { for (const f of (t === 'visibilitychange' || t === 'animationend' ? doc : win).l[t] || []) f(e); };
  const measured = () => { const n = ctx.calls.filter(c => c[0] === 'syncDocumentThread').length; return n; };
  const settle = () => { while (frames.length) frames.shift()(); };
  for (const t of ['visibilitychange', 'pageshow', 'focus']) { const was = measured(); fire(t); settle(); assert.equal(measured(), was + 1, t); }
  let was = measured(); fire('animationend', { target: { id: 'dock' } }); settle(); assert.equal(measured(), was + 1, 'the dock animation ends');
  was = measured(); fire('animationend', { target: { id: 'orb' } }); settle(); assert.equal(measured(), was, 'any other animation does not');
  fire('focus'); fire('pageshow'); assert.equal(frames.length, 1, 'one measure per frame'); settle();
});
