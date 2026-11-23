// The desktop's real keys guide (keyHints in web/desktop/desktop.js) drawn on the real web/desktop.html page in the
// tiny DOM (tests/fixtures/mini-dom.mjs). Every element measures as one on-screen box and the hit test lands on the
// page, so each chip shows where the code puts it; each chip remembers the element it was measured on (its target).
// Helpers the guide calls that the test does not give are recorders (wizard-ux issue 1674: tests run the code).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './mini-dom.mjs';
import { desktopSource } from './desktop-keys-harness.mjs';
import { between, runRecording } from './source-slice.mjs';

const PAGE = readFileSync(new URL('../../web/desktop.html', import.meta.url), 'utf8');
const NAV = readFileSync(new URL('../../web/core/workspace-navigation.js', import.meta.url), 'utf8');
const RECT = { left: 100, top: 100, right: 200, bottom: 140, width: 100, height: 40, x: 100, y: 100 };

// opts.rect(el): a box for one element (else the shared on-screen box); other opts go in the guide's scope.
export function keysGuide({ rect = () => null, ...opts } = {}) {
  const document = createDocument({ url: 'https://box.test/wizard-os-home/desktop.html' });
  // the page's own scripts are not run here: cut every script element out (index walk, not a regex filter)
  let body = PAGE.slice(PAGE.indexOf('>', PAGE.indexOf('<body')) + 1, PAGE.lastIndexOf('</body>'));
  for (let i = body.indexOf('<script'); i >= 0; i = body.indexOf('<script')) { const end = body.indexOf('</script>', i); body = body.slice(0, i) + (end < 0 ? '' : body.slice(end + 9)); }
  document.body.innerHTML = body;
  let measured = null;
  const proto = Object.getPrototypeOf(document.body);
  const box = function () { measured = this; return { ...RECT, ...(rect(this) || {}) }; };
  const make = document.createElement;
  document.createElement = tag => { const n = make(tag); n.offsetWidth = 20; n.offsetHeight = 16; n.getBoundingClientRect = box; n.getClientRects = () => [RECT]; if (tag === 'b') { n.target = measured; n.getBoundingClientRect = function () { const left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0; return { left, top, right: left + 20, bottom: top + 16, width: 20, height: 16 }; }; } return n; };
  for (const n of [document.documentElement, ...document.documentElement.descendants()]) { n.getBoundingClientRect = box; n.getClientRects = () => [RECT]; }
  const patch = root => { for (const n of [root, ...root.descendants()]) { n.getBoundingClientRect = box; n.getClientRects = () => [RECT]; } };
  document.elementFromPoint = () => document.body;
  const C = {}; new Function('window', NAV)({ WizCore: C });
  const ctx = { document, window: { getComputedStyle: () => ({ visibility: 'visible' }) }, innerWidth: 1600, innerHeight: 1000, IS_MAC: true, MOD: '⌥', C,
    homeOpen: false, cur: 0, ws: [{ id: 'd1', wins: [] }], W: {}, focused: () => null, VOICE: { state: 'idle' }, hud: null, closedWins: [], spotPrev: null,
    spotLive: () => false, nextStop: () => null, resizable: () => false, winEl: () => null, readyRows: () => [], mainChats: w => w?.app === 'chats',
    CHATS: {}, esc: s => String(s), setTimeout: () => 0, clearTimeout() {}, ...opts };
  ctx.$ = (s, r = document) => r.querySelector(s); ctx.$$ = (s, r = document) => r.querySelectorAll(s);
  runRecording(`${between(desktopSource, 'const keyHints = (() => {', '\n  })();')}\n  })();\nthis.keyHints = keyHints;`, ctx);
  const chips = () => document.querySelectorAll('#keyHints .kh-chip').map(c => ({ key: c.querySelector('kbd')?.textContent ?? c.textContent, word: c.querySelector('kbd') ? c.textContent.slice(c.querySelector('kbd').textContent.length) : '',
    label: c.getAttribute('aria-label'), on: c.target }));
  const on = (key, sel) => chips().filter(c => c.key === key && (!sel || c.on?.matches?.(sel)));
  return { document, ctx, keyHints: ctx.keyHints, show: pin => { ctx.keyHints.show(pin); return chips(); }, chips, on, patch, add: html => { const d = document.createElement('div'); d.innerHTML = html; const n = d.firstElementChild; document.body.appendChild(n); patch(n); return n; } };
}
export { vm };
