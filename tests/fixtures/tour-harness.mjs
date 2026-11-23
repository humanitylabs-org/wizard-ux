// The real first-run tour (web/core/tour.js) in node:vm against a tiny DOM stand-in, driven the way the shell does
// (WosTour.event, taps on the tour's own buttons). Shared by the tour tests (wizard-ux issue 1674).
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export const SRC = readFileSync(new URL('../../web/core/tour.js', import.meta.url), 'utf8');

export function mk() {
  const kids = new Map(), set = new Set();
  return {
    dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, innerHTML: '', textContent: '', hidden: false, offsetWidth: 1, _l: {},
    classList: { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c),
      toggle: (c, on) => { if (on === undefined) on = !set.has(c); if (on) set.add(c); else set.delete(c); return on; } },
    setAttribute() {}, appendChild: c => c, remove() {}, focus() {}, blur() {},
    addEventListener(t, f) { (this._l[t] ||= []).push(f); },
    querySelector(s) { if (!kids.has(s)) kids.set(s, mk()); return kids.get(s); },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 60, height: 60 }),
  };
}

export function boot({ noMic = false } = {}) {
  const sentHooks = new Set();
  const outbox = { onSent(fn) { sentHooks.add(fn); return () => sentHooks.delete(fn); } };
  let timers = [];
  const store = new Map(), calls = [], created = [];
  const document = { createElement: () => { const e = mk(); created.push(e); return e; }, querySelector: () => null };
  const winL = {}, window = { addEventListener: (t, f) => (winL[t] ||= []).push(f), WosOutbox: outbox };
  const ctx = vm.createContext({
    window, document, console,
    getComputedStyle: () => ({ paddingTop: '64px', paddingBottom: '16px' }),
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: fn => fn(),
  });
  vm.runInContext(SRC, ctx, { filename: 'tour.js' });
  const T = window.WosTour;
  const H = {
    device: mk(), orbWrap: mk(), noMic: () => noMic, cmdExample: () => 'Open Calendar',
    goHome: () => calls.push('home'), prepare: () => calls.push('prepare'), toast: (...a) => calls.push('toast:' + a[1]), vib() {},
    closeSheets: () => calls.push('closeSheets'), setZen: on => { calls.push('zen:' + on); T.event('zen', { on }); },
    dismissVoice: () => calls.push('dismissVoice'), say: (t, k) => calls.push(`say:${k}:${t}`), openChats: () => calls.push('openChats'),
  };
  T.attach(H);
  const tour = () => created.find(e => e._l.click && /tr-copy/.test(e.innerHTML));
  const q = s => (s === '.tr-stage' ? tour() : tour().querySelector('.tr-copy')).querySelector(s);
  const tap = sel => tour()._l.click.forEach(f => f({ target: { closest: s => (s === sel ? {} : null) } }));
  const runTimers = () => { const t = timers; timers = []; t.forEach(x => x.fn()); };
  const view = () => ({ step: T.step, active: T.active, sub: q('small').textContent, copy: q('b').textContent, next: q('.tr-nx').innerHTML, alt: q('.tr-alt').innerHTML });
  const delivered = it => [...sentHooks].forEach(f => f(it, {}));
  // a window event as the browser sends it to the tour's capture listeners: returns whether the tour swallowed it
  const winEvent = (type, target) => { let stopped = false; const e = { target, stopImmediatePropagation: () => { stopped = true; }, preventDefault() {} };
    for (const f of winL[type] || []) f(e); return stopped; };
  return { T, H, calls, store, tour, q, tap, runTimers, view, delivered, sentHooks, created, winEvent };
}
