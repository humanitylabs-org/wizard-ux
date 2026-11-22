// The real web/core/web-update.js in node:vm with a synthetic document, fake time and a fake update feed.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './shell-parts.mjs';

export function fixture({ autoApply = true } = {}) {
  const intervals = new Map(), timeouts = [], docEvents = new Map(), session = new Map(); let id = 0, now = 1_000_000;
  const f = { busy: false, revision: 'a'.repeat(40), plan: { ok: true, blocking: [], capture: { safe: true } }, reloads: 0, saved: 0 };
  const element = () => ({ dataset: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, remove() {}, innerHTML: '' });
  const body = { appended: [], appendChild(n) { body.appended.push(n); }, prepend() {} };
  const document = { currentScript: { src: 'https://synthetic.invalid/wizard-os-home/core/web-update.js' }, body, hidden: false, activeElement: null,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: element,
    addEventListener(n, fn) { (docEvents.get(n) || docEvents.set(n, []).get(n)).push(fn); } };
  const window = { WizAppServices: { update: { announce() {}, reloadPlan: () => f.plan } }, WizAppCapture: { staleTakes: () => [] }, WizCore: { apps: () => ({ APPS: [] }) } };
  const FakeDate = class extends Date { static now() { return now; } };
  const context = { window, document, URL, JSON, String, Promise, Date: FakeDate, navigator: { onLine: true },
    sessionStorage: { getItem: k => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)) },
    location: { href: 'https://synthetic.invalid/wizard-os-home/desktop.html', pathname: '/wizard-os-home/desktop.html', reload() { f.reloads++; } },
    fetch: async () => ({ ok: true, text: async () => f.revision, json: async () => ({ updates: [] }) }),
    setInterval(fn, ms) { const n = ++id; intervals.set(n, { fn, ms }); return n; }, clearInterval(n) { intervals.delete(n); },
    setTimeout(fn, ms) { timeouts.push({ fn, ms }); return ++id; }, clearTimeout() {}, addEventListener() {} };
  vm.runInNewContext(withShellParts(readFileSync(new URL('../../web/core/web-update.js', import.meta.url), 'utf8')), context);
  f.web = window.WizWebUpdate; f.doc = document; f.session = session; f.body = body;
  f.web.init({ shell: 'desktop', autoApply, mount: () => body, prepend: true, busy: () => f.busy, beforeReload: () => { f.saved++; f.onBeforeReload?.(); }, toast() {} });
  f.advance = ms => { now += ms; };
  f.update = async () => { await f.web.check(true); f.revision = 'b'.repeat(40); await f.web.check(true); assert.equal(f.web.pending, true); };
  f.tick = async () => { for (const t of [...intervals.values()]) if (t.ms === 30e3) t.fn(); for (let n = 0; n < 20; n++) await Promise.resolve(); };
  f.input = n => { for (const fn of docEvents.get(n) || []) fn({}); };
  f.hide = async () => { document.hidden = true; for (const fn of docEvents.get('visibilitychange') || []) fn(); for (let n = 0; n < 20; n++) await Promise.resolve(); };
  return f;
}

