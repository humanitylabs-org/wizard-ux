import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
// Open Troubleshooter must show the repair page as soon as its own route answers, and open the Troubleshooter's
// direct line in the same window when Wizard's usual address can't load it (8 Nov 2026: the button did nothing
// while Wizard was stuck; 15 Nov, wizard-troubleshooter issue 37: a Connection help screen and a second tap first).
const source = readFileSync(new URL('../web/core/reach.js', import.meta.url), 'utf8');
function mount({ fetch, hostname = 'wizard.tail.ts.net', stored = null, shell = 'phone', url } = {}) {
  const calls = [], timers = new Map(), handlers = {}, assigned = []; let id = 0;
  const frame = { hidden: true, contentWindow: { direct: true }, addEventListener(type, fn) { handlers[type] = fn; }, getAttribute() { return this.src; }, contentDocument: { location: { pathname: '/troubleshoot/' }, querySelector() { return {}; } } };
  const direct = { hidden: true }, directLink = { target: '_blank', removeAttribute(k) { delete this[k]; } };
  const details = { open: true };
  const elements = { iframe: frame, details, '[data-recovery-check]': { addEventListener() {} }, '[data-recovery-message]': {}, '[data-recovery-rows]': {}, '[data-recovery-remote]': {}, '[data-recovery-direct]': direct, '[data-recovery-direct-link]': directLink };
  const cls = new Set(['opening']);
  const root = { isConnected: true, cls, classList: { add(c) { cls.add(c); }, remove(c) { cls.delete(c); } }, querySelector(s) { assert.ok(elements[s], s); return elements[s]; } };
  const store = new Map(stored ? [['wz.troubleshoot.direct', stored]] : []);
  const msgs = [];
  const context = { addEventListener(type, fn) { if (type === 'message') msgs.push(fn); }, navigator: { onLine: true }, document: { hidden: false, documentElement: { dataset: { shell } } }, location: { hostname, assign(u) { assigned.push(u); } }, Date, Event, AbortController, URL,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    requestAnimationFrame(fn) { fn(); }, setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(t) { timers.delete(t); }, dispatchEvent() {},
    fetch: async (u, o = {}) => { calls.push([u, o.method]); return fetch(u, o); } };
  context.window = context; vm.runInNewContext(source, context);
  return { context, root, details, ready: (origin = 'https://wizard.tail.ts.net:9691', source = frame.contentWindow) => msgs.forEach(fn => fn({ data: { type: 'wizard-troubleshooter:ready' }, origin, source })), calls, frame, direct, directLink, timers, handlers, assigned, store, mount: () => context.WizReach.mountRecovery(root, url) };
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

const DIRECT = 'https://wizard.tail.ts.net:9691/troubleshoot/';
const isDirect = u => String(u).startsWith('https://wizard.tail.ts.net:9691/');
const shown = h => ({ local: !h.root.cls.has('opening') && h.details.open, opening: h.root.cls.has('opening'), ready: h.root.cls.has('repair-ready') });

// owner-correction: humanitylabs-org/wizard-troubleshooter#37 · 2026-11-13 · "The user should never have to go outside WizardOS to fix a problem with WizardOS."
test('when Wizard’s usual address can’t serve it, the window opens the direct line in place, workflow kept', async () => {
  for (const shell of ['phone', 'desktop']) {
    const h = mount({ shell, url: '/troubleshoot/?provider=claude&run_id=r1', fetch: async (u, o) => o.method === 'HEAD' ? { ok: false, status: 502 } : isDirect(u) ? { ok: false, status: 0, type: 'opaque' } : never() });
    h.mount(); fire(h, 0); await flush();
    assert.equal(h.frame.src, DIRECT + '?provider=claude&run_id=r1', shell);
    assert.equal(shown(h).local, false, 'no Connection help screen first');
    h.handlers.load(); // a cross-origin page: a load alone (maybe an error page or a refused frame) shows nothing
    assert.equal(h.frame.hidden, true); assert.equal(shown(h).ready, false);
    h.ready('https://evil.example'); h.ready(undefined, {}); // another origin or another window proves nothing
    assert.equal(shown(h).ready, false);
    h.ready(); // the real repair page's own message
    assert.equal(h.frame.hidden, false); assert.equal(shown(h).ready, true); assert.equal(shown(h).opening, false);
    assert.equal(h.details.open, false); assert.equal(h.direct.hidden, true);
    assert.deepEqual(h.assigned, [], 'never leaves WizardOS for another browser');
  }
});

test('local Connection help shows only when the direct line does not answer either', async () => {
  const h = mount({ fetch: async (u, o) => o.method === 'HEAD' ? { ok: false, status: 502 } : isDirect(u) ? Promise.reject(Error('down')) : never() });
  h.mount(); fire(h, 0); await flush();
  assert.equal(h.frame.src, undefined);
  assert.equal(shown(h).local, true); assert.equal(h.direct.hidden, false);
  assert.equal(h.directLink.href, DIRECT); assert.equal(h.directLink.target, undefined, 'phone opens it in place');
  assert.deepEqual(h.assigned, []);
});

test('a slow usual route goes to the direct line after 8 s', async () => {
  const h = mount({ shell: 'desktop', fetch: async (u, o) => o.method === 'HEAD' ? never() : isDirect(u) ? { ok: false, status: 0, type: 'opaque' } : never() });
  h.mount(); fire(h, 0); await flush();
  assert.equal(h.frame.src, undefined); assert.equal(shown(h).local, false);
  fire(h, 8000); await flush();
  assert.equal(h.frame.src, DIRECT);
  h.handlers.load(); h.ready(); assert.equal(shown(h).ready, true);
});

test('a direct line whose page never says it is ready (error page, refused frame) falls back to local help', async () => {
  const h = mount({ fetch: async (u, o) => o.method === 'HEAD' ? { ok: false, status: 502 } : isDirect(u) ? { ok: false, status: 0, type: 'opaque' } : never() });
  h.mount(); fire(h, 0); await flush();
  assert.equal(h.frame.src, DIRECT);
  h.handlers.load();
  assert.equal(shown(h).local, false);
  fire(h, 8000);
  assert.equal(h.frame.hidden, true); assert.equal(shown(h).local, true); assert.equal(h.direct.hidden, false, 'its button stays as the last way out');
});

// Acceptance (James, 15 Nov): fresh install, empty localStorage, ts.net host, gateway ping fails -> one tap lands on
// the direct line with no visible recovery section.
// owner-correction: humanitylabs-org/wizard-troubleshooter#37 · 2026-11-04 · "First of all, clicking open troubleshooter should open the troubleshooter, not this pop-up."
test('empty localStorage + ts.net host + gateway down: one Open Troubleshooter tap lands on the direct line', async () => {
  const h = mount({ fetch: async (u, o) => isDirect(u) ? { ok: false, status: 0, type: 'opaque' } : Promise.reject(TypeError('Load failed')) });
  assert.equal(h.store.size, 0);
  h.context.WizOpenApp = () => { h.mount(); return true; };
  h.context.WizReach.open(); fire(h, 0); await flush();
  assert.equal(h.frame.src, DIRECT);
  assert.equal(shown(h).local, false, 'no Connection help, no second tap');
  h.handlers.load(); h.ready();
  assert.equal(shown(h).ready, true); assert.equal(h.frame.hidden, false);
  fire(h, 4000); fire(h, 15000); await flush(); // later failing checks never hide the open repair page
  assert.equal(h.frame.hidden, false); assert.equal(h.frame.src, DIRECT); assert.deepEqual(h.assigned, []);
});

test('the direct address is learned from Troubleshooter’s status and only for this same Wizard host', async () => {
  const h = mount({ hostname: 'wizard.example.com', fetch: async u => u === '/troubleshoot/api/status' ? { ok: true, status: 200, json: async () => ({ overall: 'ok', checks: [], direct: 'https://wizard.example.com:9691/troubleshoot/' }) } : { ok: true, status: 200 } });
  await h.context.WizReach.diagnose(0);
  assert.equal(h.store.get('wz.troubleshoot.direct'), 'https://wizard.example.com:9691/troubleshoot/');
  assert.equal(h.context.WizReach.directUrl('/troubleshoot/?x=1'), 'https://wizard.example.com:9691/troubleshoot/?x=1');
  // Another advertised port is ignored: the shell CSP lets the window reach only :9691.
  const other = mount({ stored: 'https://wizard.tail.ts.net:9700/troubleshoot/', fetch: async () => never() });
  assert.equal(other.context.WizReach.directUrl('/troubleshoot/'), 'https://wizard.tail.ts.net:9691/troubleshoot/');
  const evil = mount({ stored: 'https://evil.example:9691/troubleshoot/', fetch: async () => never() });
  assert.equal(evil.context.WizReach.directUrl('/troubleshoot/'), 'https://wizard.tail.ts.net:9691/troubleshoot/');
  const lan = mount({ hostname: 'wizard.local', fetch: async () => never() });
  assert.equal(lan.context.WizReach.directUrl('/troubleshoot/'), '', 'no guessed direct line off the tailnet');
});

test('the recovery window carries the direct-line button, hidden until needed', () => {
  const h = mount({ fetch: async () => never() });
  const html = h.context.WizReach.recoveryHtml();
  assert.match(html, /<p data-recovery-direct hidden><a class="wz-button" data-recovery-direct-link/);
  assert.match(html, /<section class="wz-recovery opening" data-recovery>/, 'the help stays out of sight while the repair page opens');
  // the real polish.css on that markup: the help and the hidden direct line take no room until needed
  const polish = readFileSync(new URL('../web/core/polish.css', import.meta.url), 'utf8');
  const doc = createDocument(); doc.body.innerHTML = html;
  const help = doc.querySelector('[data-recovery] > details'), direct = doc.querySelector('[data-recovery-direct]');
  assert.ok(help, 'the help sits in the window');
  assert.equal(cascade(help, polish).display?.value, 'none', 'opening: the help out of sight');
  assert.equal(cascade(direct, polish).display?.value, 'none', 'the direct line hidden');
  doc.querySelector('[data-recovery]').classList.remove('opening'); direct.removeAttribute('hidden');
  assert.notEqual(cascade(help, polish).display?.value, 'none', 'then the help shows');
  assert.notEqual(cascade(direct, polish).display?.value, 'none', 'and the direct line when needed');
});

test('a fresh tap that reuses the open window tries again at once and opens the direct line once it answers', async () => {
  let head = 0, up = false;
  const h = mount({ fetch: async (u, o) => o.method === 'HEAD' ? (head++, { ok: false, status: 504 }) : isDirect(u) ? (up ? { ok: false, status: 0, type: 'opaque' } : Promise.reject(Error('down'))) : never() });
  h.mount(); fire(h, 0); await flush();
  assert.equal(shown(h).local, true, 'nothing answers yet: local help');
  up = true;
  h.context.WizOpenApp = () => true; // the shell reuses and focuses the mounted window; mountRecovery is not rerun
  h.context.WizReach.open(); await flush();
  assert.equal(head, 2, 'the repair page is tried again on the fresh tap');
  assert.equal(h.frame.src, DIRECT, 'no wait for the next 15 s poll');
  assert.deepEqual(h.assigned, []);
});

test('a later failed health probe never hides a repair page that already loaded', async () => {
  const h = mount({ fetch: async (u, o) => o.method === 'HEAD' ? { ok: true, status: 200 } : never() });
  h.mount(); fire(h, 0); await flush();
  h.handlers.load();
  assert.equal(h.frame.hidden, false);
  fire(h, 4000); await flush(); // the ping and internet probes time out: Wizard's address looks unreachable
  assert.equal(h.frame.hidden, false, 'the loaded document stays usable');
  assert.equal(h.direct.hidden, true);
});
