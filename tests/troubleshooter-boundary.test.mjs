import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// Browser owner boundary (wizard-os#133): with the box switch on, the Troubleshooter window's repair page runs
// sandboxed like every app page, so the shell never reads it. Its answer on the boundary channel is the proof it loaded.
// With the switch off, the window is exactly as before (tests/troubleshooter-direct-line.test.mjs).
const source = readFileSync(new URL('../web/core/reach.js', import.meta.url), 'utf8');
const SANDBOX = 'allow-scripts allow-forms allow-downloads';
function mount({ boundary = true, fetch = async (u, o) => (o.method === 'HEAD' ? { ok: true, status: 200 } : new Promise(() => {})) } = {}) {
  const timers = new Map(), handlers = {}, attached = []; let id = 0, ready = false;
  const frame = {
    hidden: true, attrs: boundary ? { sandbox: SANDBOX } : {},
    addEventListener(type, fn) { handlers[type] = fn; },
    getAttribute(k) { return k === 'src' ? this.src : this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    // Reading a sandboxed document is what the boundary forbids: any read fails the test.
    get contentDocument() { if (boundary) throw new Error('the shell read a sandboxed repair page'); return { location: { pathname: '/troubleshoot/' }, querySelector() { return {}; } }; },
  };
  const direct = { hidden: true }, directLink = { removeAttribute() {} };
  const elements = { iframe: frame, details: { open: true }, '[data-recovery-check]': { addEventListener() {} }, '[data-recovery-message]': {}, '[data-recovery-rows]': {}, '[data-recovery-remote]': {}, '[data-recovery-direct]': direct, '[data-recovery-direct-link]': directLink };
  const root = { isConnected: true, classList: { add() {}, remove() {} }, querySelector(s) { assert.ok(elements[s], s); return elements[s]; } };
  const context = { navigator: { onLine: true }, document: { hidden: false, documentElement: { dataset: { shell: 'desktop' } } }, location: { hostname: 'wizard.tail.ts.net', assign() {} }, Date, Event, AbortController, URL,
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame(fn) { fn(); }, setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(t) { timers.delete(t); }, dispatchEvent() {},
    fetch };
  if (boundary) context.WizBrowserBoundary = { enabled: true, frameAttributes: () => `sandbox="${SANDBOX}"`, attach(f) { attached.push(f); return () => {}; }, ready: () => ready, owns: f => attached.includes(f) };
  context.window = context; vm.runInNewContext(source, context);
  return { context, root, frame, direct, timers, handlers, attached, answer() { ready = true; handlers['wizard:boundary-ready']?.(); }, mount: () => context.WizReach.mountRecovery(root, '/troubleshoot/') };
}
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const fire = (h, ms) => { for (const [k, t] of [...h.timers]) if (t.ms === ms) { h.timers.delete(k); t.fn(); } };

test('switch on: the repair frame is written sandboxed, without same-origin access', () => {
  const h = mount();
  const html = h.context.WizReach.recoveryHtml();
  assert.match(html, new RegExp(`<iframe class="appframe" data-own-app="troubleshooter"[^>]* sandbox="${SANDBOX}"`));
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.doesNotMatch(mount({ boundary: false }).context.WizReach.recoveryHtml(), /sandbox=/, 'switch off: unchanged');
});

test('switch on: the page loading is not proof; its answer on the boundary channel shows the repair page', async () => {
  const h = mount();
  h.mount(); fire(h, 0); await flush();
  assert.deepEqual(h.attached, [h.frame], 'the window joins the boundary channel');
  assert.equal(h.frame.src, '/troubleshoot/');
  h.handlers.load();
  assert.equal(h.frame.hidden, true, 'a load alone (it may be an error page) shows nothing');
  h.answer();
  assert.equal(h.frame.hidden, false);
  assert.equal(h.direct.hidden, true);
  fire(h, 8000);
  assert.equal(h.frame.hidden, false, 'a working repair page stays');
});

test('switch on: the answer may come before the frame load event', async () => {
  const h = mount();
  h.mount(); fire(h, 0); await flush();
  h.answer(); h.handlers.load();
  assert.equal(h.frame.hidden, false);
  fire(h, 8000);
  assert.equal(h.frame.hidden, false);
});

test('switch on: a page that never answers falls back to local help and the direct line', async () => {
  const h = mount();
  h.mount(); fire(h, 0); await flush();
  h.handlers.load();
  fire(h, 8000);
  assert.equal(h.frame.hidden, true);
  assert.equal(h.direct.hidden, false, 'the direct line is offered');
});

test('switch off: the loaded document is still the proof, read as before', async () => {
  const h = mount({ boundary: false });
  h.mount(); fire(h, 0); await flush();
  h.handlers.load();
  assert.equal(h.frame.hidden, false);
  assert.deepEqual(h.attached, []);
});
