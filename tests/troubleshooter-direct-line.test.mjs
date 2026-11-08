import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// Open Troubleshooter must show the repair page as soon as its own route answers, and offer (phone: follow) the
// Troubleshooter's direct line when Wizard's usual address can't load it (8 Nov 2026: the button did nothing
// while Wizard was stuck).
const source = readFileSync(new URL('../web/core/reach.js', import.meta.url), 'utf8');
function mount({ fetch, hostname = 'wizard.tail.ts.net', stored = null, shell = 'phone', url } = {}) {
  const calls = [], timers = new Map(), handlers = {}, assigned = []; let id = 0;
  const frame = { hidden: true, addEventListener(type, fn) { handlers[type] = fn; }, getAttribute() { return this.src; }, contentDocument: { location: { pathname: '/troubleshoot/' }, querySelector() { return {}; } } };
  const direct = { hidden: true }, directLink = { target: '_blank', removeAttribute(k) { delete this[k]; } };
  const elements = { iframe: frame, details: { open: true }, '[data-recovery-check]': { addEventListener() {} }, '[data-recovery-message]': {}, '[data-recovery-rows]': {}, '[data-recovery-remote]': {}, '[data-recovery-direct]': direct, '[data-recovery-direct-link]': directLink };
  const root = { isConnected: true, classList: { add() {}, remove() {} }, querySelector(s) { assert.ok(elements[s], s); return elements[s]; } };
  const store = new Map(stored ? [['wz.troubleshoot.direct', stored]] : []);
  const context = { navigator: { onLine: true }, document: { hidden: false, documentElement: { dataset: { shell } } }, location: { hostname, assign(u) { assigned.push(u); } }, Date, Event, AbortController, URL,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    requestAnimationFrame(fn) { fn(); }, setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(t) { timers.delete(t); }, dispatchEvent() {},
    fetch: async (u, o = {}) => { calls.push([u, o.method]); return fetch(u, o); } };
  context.window = context; vm.runInNewContext(source, context);
  return { context, root, calls, frame, direct, directLink, timers, handlers, assigned, store, mount: () => context.WizReach.mountRecovery(root, url) };
}
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const fire = (h, ms) => { for (const [k, t] of [...h.timers]) if (t.ms === ms) { h.timers.delete(k); t.fn(); } };
const never = () => new Promise(() => {});

test('the repair page loads at once even while the health checks never finish', async () => {
  const h = mount({ fetch: async (u, o) => o.method === 'HEAD' ? { ok: true, status: 200 } : never() });
  h.mount(); fire(h, 0); await flush();
  assert.equal(h.frame.src, '/troubleshoot/', 'not gated on ping/status/internet checks');
  h.handlers.load();
  assert.equal(h.frame.hidden, false, 'the loaded document is the proof; no check result needed');
  assert.equal(h.direct.hidden, true);
});

test('when Wizard’s usual address can’t serve it, the direct line is offered with the same workflow', async () => {
  const h = mount({ url: '/troubleshoot/?provider=claude&run_id=r1', fetch: async (u, o) => o.method === 'HEAD' ? { ok: false, status: 502 } : never() });
  h.mount(); fire(h, 0); await flush();
  assert.equal(h.frame.src, undefined);
  assert.equal(h.direct.hidden, false);
  assert.equal(h.directLink.href, 'https://wizard.tail.ts.net:9691/troubleshoot/?provider=claude&run_id=r1');
  assert.equal(h.directLink.target, undefined, 'phone opens it in place');
  assert.deepEqual(h.assigned, [], 'an unconfirmed address is offered, never followed automatically');
});

test('a slow route offers the direct line after 8 s; desktop opens it in a new tab', async () => {
  const h = mount({ shell: 'desktop', fetch: async () => never() });
  h.mount(); fire(h, 0); await flush();
  assert.equal(h.direct.hidden, true);
  fire(h, 8000);
  assert.equal(h.direct.hidden, false);
  assert.equal(h.directLink.target, '_blank');
});

test('phone: a fresh Open Troubleshooter tap follows a confirmed direct line automatically', async () => {
  const h = mount({ stored: 'https://wizard.tail.ts.net:9691/troubleshoot/', fetch: async (u, o) => o.method === 'HEAD' ? { ok: false, status: 504 } : never() });
  h.context.WizOpenApp = () => { h.mount(); return true; };
  h.context.WizReach.open(); fire(h, 0); await flush();
  assert.deepEqual(h.assigned, ['https://wizard.tail.ts.net:9691/troubleshoot/']);
  const d = mount({ shell: 'desktop', stored: 'https://wizard.tail.ts.net:9691/troubleshoot/', fetch: async (u, o) => o.method === 'HEAD' ? { ok: false, status: 504 } : never() });
  d.context.WizOpenApp = () => { d.mount(); return true; };
  d.context.WizReach.open(); fire(d, 0); await flush();
  assert.deepEqual(d.assigned, [], 'desktop never leaves the shell by itself');
  assert.equal(d.direct.hidden, false);
});

test('the direct address is learned from Troubleshooter’s status and only for this same Wizard host', async () => {
  const h = mount({ fetch: async u => u === '/troubleshoot/api/status' ? { ok: true, status: 200, json: async () => ({ overall: 'ok', checks: [], direct: 'https://wizard.tail.ts.net:9700/troubleshoot/' }) } : { ok: true, status: 200 } });
  await h.context.WizReach.diagnose(0);
  assert.equal(h.store.get('wz.troubleshoot.direct'), 'https://wizard.tail.ts.net:9700/troubleshoot/');
  assert.equal(h.context.WizReach.directUrl('/troubleshoot/?x=1'), 'https://wizard.tail.ts.net:9700/troubleshoot/?x=1');
  const evil = mount({ stored: 'https://evil.example:9691/troubleshoot/', fetch: async () => never() });
  assert.equal(evil.context.WizReach.directUrl('/troubleshoot/'), 'https://wizard.tail.ts.net:9691/troubleshoot/');
  const lan = mount({ hostname: 'wizard.local', fetch: async () => never() });
  assert.equal(lan.context.WizReach.directUrl('/troubleshoot/'), '', 'no guessed direct line off the tailnet');
});

test('the recovery window carries the direct-line button, hidden until needed', () => {
  const h = mount({ fetch: async () => never() });
  const html = h.context.WizReach.recoveryHtml();
  assert.match(html, /<p data-recovery-direct hidden><a class="wz-button" data-recovery-direct-link/);
  assert.match(readFileSync(new URL('../web/core/polish.css', import.meta.url), 'utf8'), /\[data-recovery-direct\]\[hidden\] \{ display: none !important; \}/);
});
