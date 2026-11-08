import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// James, 7 Nov 2026: his desktop stayed on an afternoon build through ten releases because the interface only
// reloaded on a tap. The desktop now applies a pending update by itself when its window is hidden or quiet, and
// never while someone is typing or anything a tap would wait on is in flight. Synthetic documents only.
function fixture({ autoApply = true } = {}) {
  const intervals = new Map(), timeouts = [], docEvents = new Map(), session = new Map(); let id = 0, now = 1_000_000;
  const f = { busy: false, revision: 'a'.repeat(40), plan: { ok: true, blocking: [], capture: { safe: true } }, reloads: 0, saved: 0 };
  const element = () => ({ dataset: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, remove() {}, innerHTML: '' });
  const body = { appendChild() {}, prepend() {} };
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
  vm.runInNewContext(readFileSync(new URL('../web/core/web-update.js', import.meta.url), 'utf8'), context);
  f.web = window.WizWebUpdate; f.doc = document; f.session = session;
<<<<<<< HEAD
  f.web.init({ shell: 'desktop', autoApply, mount: () => body, prepend: true, busy: () => f.busy, beforeReload: () => { f.saved++; }, toast() {} });
=======
  f.web.init({ shell: 'desktop', autoApply, mount: () => body, prepend: true, busy: () => f.busy, beforeReload: () => { f.saved++; f.onBeforeReload?.(); }, toast() {} });
>>>>>>> origin/main
  f.advance = ms => { now += ms; };
  f.update = async () => { await f.web.check(true); f.revision = 'b'.repeat(40); await f.web.check(true); assert.equal(f.web.pending, true); };
  f.tick = async () => { for (const t of [...intervals.values()]) if (t.ms === 30e3) t.fn(); for (let n = 0; n < 20; n++) await Promise.resolve(); };
  f.input = n => { for (const fn of docEvents.get(n) || []) fn({}); };
  f.hide = async () => { document.hidden = true; for (const fn of docEvents.get('visibilitychange') || []) fn(); for (let n = 0; n < 20; n++) await Promise.resolve(); };
  return f;
}

test('desktop: a hidden window reloads into a pending update by itself, saving drafts first', async () => {
  const f = fixture(); await f.update();
  await f.hide();
  assert.equal(f.reloads, 1); assert.equal(f.saved, 1, 'beforeReload saves drafts as a tap does');
});

test('desktop: a visible window waits for 10 quiet minutes; any input restarts the wait', async () => {
  const f = fixture(); await f.update();
  f.advance(9 * 60e3); await f.tick(); assert.equal(f.reloads, 0);
  f.input('pointermove'); f.advance(9 * 60e3); await f.tick(); assert.equal(f.reloads, 0, 'input 9 min ago is not quiet yet');
  f.advance(2 * 60e3); await f.tick(); assert.equal(f.reloads, 1);
});

test('desktop: never while typing into a field with text', async () => {
  const f = fixture(); await f.update();
  f.doc.activeElement = { tagName: 'TEXTAREA', value: 'half a thought' };
  f.advance(30 * 60e3); await f.tick(); assert.equal(f.reloads, 0);
  f.doc.activeElement = { tagName: 'TEXTAREA', value: '' };
  await f.tick(); assert.equal(f.reloads, 1);
});

test('desktop: never past a hold a tap would wait on (voice/sending, recording, kept meeting)', async () => {
  for (const hold of [
    f => { f.busy = true; },
    f => { f.plan = { ok: false, blocking: [{ kind: 'capture', appId: 'recorder' }], capture: { safe: true, waitForEnd: true }, recording: true }; },
    f => { f.plan = { ok: true, blocking: [], keeps: { appId: 'mizel', id: 'm1' }, capture: { safe: true } }; },
  ]) {
    const f = fixture(); await f.update(); hold(f);
    await f.hide(); f.advance(30 * 60e3); await f.tick();
    assert.equal(f.reloads, 0);
  }
});

test('desktop: one quiet reload per build, so a reload that lands on the old build cannot loop', async () => {
  const f = fixture(); await f.update(); await f.hide(); assert.equal(f.reloads, 1);
  const g = fixture(); for (const [k, v] of f.session) g.session.set(k, v);
  await g.update(); await g.hide(); assert.equal(g.reloads, 0, 'same target build retried too soon');
});

<<<<<<< HEAD
=======
test('desktop: focus inside an app frame is never quiet while visible; a same-origin field with text holds even hidden', async () => {
  const f = fixture(); await f.update();
  f.doc.activeElement = { tagName: 'IFRAME', contentDocument: null }; // a cross-origin app frame: its input never bubbles here
  f.advance(30 * 60e3); await f.tick(); assert.equal(f.reloads, 0, 'visible window with an app frame focused');
  await f.hide(); assert.equal(f.reloads, 1, 'hidden window still applies');
  const g = fixture(); await g.update();
  g.doc.activeElement = { tagName: 'IFRAME', contentDocument: { activeElement: { tagName: 'INPUT', value: 'typed in the app' } } };
  await g.hide(); g.advance(30 * 60e3); await g.tick(); assert.equal(g.reloads, 0, 'same-origin app field with text');
});

test('desktop: a quiet attempt that stands down at the last check does not start the per-build cooldown', async () => {
  const f = fixture(); await f.update();
  let once = true; f.onBeforeReload = () => { if (once) { once = false; f.plan = { ok: false, blocking: [{ kind: 'save' }], capture: { safe: true } }; } };
  await f.hide(); assert.equal(f.reloads, 0, 'hold exposed by beforeReload stands down');
  assert.equal(f.session.get('wos.web.quiet'), undefined, 'no cooldown recorded for a reload that did not happen');
  f.plan = { ok: true, blocking: [], capture: { safe: true } };
  f.advance(60e3); await f.tick(); assert.equal(f.reloads, 1, 'retries as soon as the hold clears');
});

>>>>>>> origin/main
test('phone (no autoApply) still reloads only when tapped', async () => {
  const f = fixture({ autoApply: false }); await f.update();
  await f.hide(); f.advance(60 * 60e3); await f.tick();
  assert.equal(f.reloads, 0);
});

test('desktop host opts in', () => {
  const src = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  assert.match(src, /WizWebUpdate\?\.init\(\{[\s\S]{0,200}autoApply: true/);
});
