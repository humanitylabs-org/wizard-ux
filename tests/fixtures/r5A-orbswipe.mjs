// The phone shell's real orb gestures (web/app-orbswipe.js, the appParts.orbswipe part) on a mini-dom orb, with the
// real orbUpVar / orbUpDesks lines from web/app-cards.js reading --wos-orb-swipe-up. Every name the part takes that the
// test does not give is a recorder (calls land in `calls`), so a test drags the orb and reads what the shell did.
import { readFileSync } from 'node:fs';
import { createDocument } from './mini-dom.mjs';
import { partScope } from './r5A-parts.mjs';
import { recorder, runRecording } from './source-slice.mjs';

const web = p => readFileSync(new URL('../../web/' + p, import.meta.url), 'utf8');

// The two lines of app-cards.js that read the skin's orb swipe-up choice, run against a computed style.
export function orbUp(value) {
  const cards = web('app-cards.js');
  const lines = cards.split('\n').filter(l => /^\s+const orbUp(Var|Desks) = /.test(l)).join('\n');
  const seen = [];
  const ctx = runRecording(lines + '\nthis.orbUpVar = orbUpVar; this.orbUpDesks = orbUpDesks;', {
    document: { documentElement: {} }, getComputedStyle: () => ({ getPropertyValue: k => { seen.push(k); return value; } }) });
  return { orbUpVar: ctx.orbUpVar, orbUpDesks: ctx.orbUpDesks, seen, lines };
}

export function orbSwipe({ upValue = '', sheet = null, give = {} } = {}) {
  const calls = [];
  const doc = createDocument();
  const ctx = partScope({ document: doc, performance: { now: () => now }, queueMicrotask: () => {}, setTimeout: () => 0, clearTimeout: () => {}, WosCreateOrbSwitcher: () => ({}) });
  let now = 0;
  const orbWrap = doc.createElement('div'); orbWrap.setPointerCapture = () => {}; orbWrap.hasPointerCapture = () => true; doc.body.append(orbWrap);
  const device = doc.createElement('div'); doc.body.append(device);
  const appVars = { G: null, sheet, idx: 0, desks: [{}], ovEl: null };
  const up = orbUp(upValue);
  let ovOpen = false;
  const named = {
    appVars, orbWrap, device, $: () => doc.createElement('div'), V: { state: 'idle' }, MIC_WARM_MS: 300,
    orbUpDesks: up.orbUpDesks, pillOvOpen: () => ovOpen, openOverview: mode => { calls.push(['openOverview', mode]); ovOpen = true; },
    closeOverview: () => { calls.push(['closeOverview']); ovOpen = false; }, ...give,
  };
  const args = new Proxy(named, { get: (t, k) => (k in t ? t[k] : recorder(String(k), calls)), has: () => true });
  ctx.calls = calls; runRecording(web('app-orbswipe.js'), ctx, calls);  // free globals (Orb, ...) are recorders too
  ctx.WizCore.appParts.orbswipe(args);
  const ev = (type, y, more = {}) => orbWrap.dispatchEvent({ type, pointerId: 1, isPrimary: true, clientX: 100, clientY: y, timeStamp: now, preventDefault() {}, stopPropagation() {}, ...more });
  return {
    calls, appVars, orbWrap, up,
    opened: () => calls.filter(c => c[0] === 'openOverview').map(c => c[1]),
    down: () => ev('pointerdown', 500), move: (dy, ms = 50) => { now += ms; ev('pointermove', 500 + dy); }, up: dy => ev('pointerup', 500 + dy),
    // A vertical drag from y=500 by `dy`, in `ms`, then the finger lifts.
    drag(dy, ms = 400, steps = [dy / 2, dy]) { ev('pointerdown', 500); for (const s of steps) { now += ms / steps.length; ev('pointermove', 500 + s); } ev('pointerup', 500 + dy); },
  };
}
