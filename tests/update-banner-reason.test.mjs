import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Synthetic documents only: no live chats, sends, Look writes or capture commands.
function fixture(shell = 'phone') {
  const els = new Map(), intervals = new Map(), timeouts = [], events = new Map(); let id = 0;
  const f = { busy: false, revision: 'a'.repeat(40), plan: { ok: true, blocking: [], capture: { safe: true } }, reloads: 0, paints: 0 };
  const element = () => ({ dataset: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener() {},
    remove() { els.delete(this.id); }, set innerHTML(v) { this.html = v; f.paints++; }, get innerHTML() { return this.html || ''; } });
  const body = { appendChild(e) { if (e.id) els.set(e.id, e); }, prepend(e) { this.appendChild(e); } };
  const document = { currentScript: { src: 'https://synthetic.invalid/wizard-os-home/core/web-update.js' }, body,
    querySelector: () => null, querySelectorAll: () => [], getElementById: n => els.get(n), createElement: element, addEventListener() {} };
  const window = { WizAppServices: { update: { announce() {}, reloadPlan: () => f.plan } }, WizAppCapture: { staleTakes: () => f.takes || [] },
    WosOutbox: { onChange(fn) { f.outboxChanged = fn; } }, WizCore: { apps: () => ({ APPS: [{ id: 'recorder', name: 'Recorder' }] }) } };
  const context = { window, document, URL, Date, navigator: { onLine: true }, location: { href: 'https://synthetic.invalid/wizard-os-home/', reload() { f.reloads++; } },
    fetch: async () => ({ ok: true, text: async () => f.revision, json: async () => ({ updates: [] }) }),
    setInterval(fn, ms) { const n = ++id; intervals.set(n, { fn, ms }); return n; }, clearInterval(n) { intervals.delete(n); },
    setTimeout(fn, ms) { timeouts.push({ fn, ms }); return ++id; }, clearTimeout() {}, addEventListener(n, fn) { events.set(n, fn); } };
  vm.runInNewContext(readFileSync(new URL('../web/core/web-update.js', import.meta.url), 'utf8'), context);
  f.web = window.WizWebUpdate; f.window = window; f.intervals = intervals;
  f.web.init({ shell, mount: () => body, busy: () => f.busy, toast() {} });
  f.show = async () => { await f.web.check(true); f.revision = 'b'.repeat(40); await f.web.check(true); };
  f.tick = () => { for (const t of [...intervals.values()]) if (t.ms === 1000) t.fn(); };
  f.fire = async ms => { timeouts.find(t => t.ms === ms).fn(); for (let n = 0; n < 20; n++) await Promise.resolve(); };
  f.event = n => events.get(n)?.(); f.html = () => els.get('dvWeb')?.innerHTML || '';
  f.watchers = () => [...intervals.values()].filter(t => t.ms === 1000).length;
  return f;
}
for (const shell of ['phone', 'desktop']) {
  test(shell + ': busy reason appears, clears without any event, watcher stops, Reload navigates once', async () => {
    const f = fixture(shell); f.busy = true; await f.show();
    assert.match(f.html(), /Wizard is sending audio or saving your work/); assert.match(f.html(), /wos-reload-dot/); assert.equal(f.watchers(), 1);
    assert.equal(f.web.reload('tap'), false); assert.equal(f.reloads, 0);
    const paints = f.paints; f.tick(); assert.equal(f.paints, paints, 'unchanged state must not replace focused controls');
    f.busy = false; f.tick();
    assert.doesNotMatch(f.html(), /wos-reload-detail|sending audio|finish recording/); assert.equal(f.watchers(), 0); assert.equal(f.web.busy(), false);
    assert.equal(f.web.reload('tap'), true); await f.fire(900); assert.equal(f.reloads, 1);
  });
  test(shell + ': outbox and voice events refresh an already visible idle banner', async () => {
    const f = fixture(shell); await f.show(); assert.equal(f.watchers(), 0);
    f.busy = true; f.event('wizard-voice-state'); assert.match(f.html(), /sending audio/);
    f.busy = false; f.outboxChanged(); await Promise.resolve(); assert.doesNotMatch(f.html(), /wos-reload-detail/); assert.equal(f.watchers(), 0);
  });
}
test('stale failed-check notice clears when capture becomes safe, without navigating automatically', async () => {
  const f = fixture(); f.plan = { ok: false, blocking: [{ kind: 'capture', appId: 'recorder' }], capture: { safe: false, recheck: true } };
  f.window.WizAppCapture.reconcileReload = () => new Promise(() => {});
  await f.show(); f.web.reload('tap'); await f.fire(4500); assert.match(f.html(), /voice note/);
  f.plan = { ok: true, blocking: [], capture: { safe: true } }; f.tick();
  assert.equal(f.web.reloadStatus().reason, ''); assert.doesNotMatch(f.html(), /wos-reload-detail/); assert.equal(f.reloads, 0); assert.equal(f.watchers(), 0);
});
test('host hand-off becoming reload-safe does not waive another app hold', async () => {
  const f = fixture(); f.busy = true; await f.show();
  f.plan = { ok: false, blocking: [{ kind: 'work', appId: 'recorder', reason: 'Saving' }] }; f.busy = false; f.tick();
  assert.match(f.html(), /Recorder is saving/); assert.equal(f.web.reload('tap'), false); assert.equal(f.reloads, 0);
});
test('shared reason has no separate panel; rescue controls retain pill shape and 44px targets', () => {
  const css = readFileSync(new URL('../web/core/update-banner.css', import.meta.url), 'utf8');
  assert.match(css, /\.wos-reload-detail \{ background: transparent/);
  assert.match(css, /\.wos-reload-rescue button \{ min-height: 44px;[^}]*border-radius: 99px/);
  assert.match(css, /#bar:has\(#dvWeb \.wos-reload-detail\) \.bar-r \{ align-self: start/);
  assert.match(css, /background: var\(--wz-panel/); assert.match(css, /color: var\(--wz-text-secondary/);
});
