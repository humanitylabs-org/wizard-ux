// Home resource bars as one shared renderer (WosResources.bars): Home on skins that draw bars and Settings › Resources
// draw the same groups (AI resources, Compute resources) from one list, so a page never hand-rolls its own meters.
// The real core/usage.js + core/resources.js run in node:vm on a mini-dom with a fake fetch and manual timers, and
// the real settings.css is cascaded on the bars they drew (wizard-ux issue 1674: tests run the code).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const readings = (cpu = 20) => url => url.includes('/load') ? { cpuLoad: cpu, percentUsedMemory: 40, percentUsed: 50 }
  : url.includes('ai-usage') ? { providers: [{ id: 'claude:x', provider: 'claude', name: 'Claude', status: 'ok', fetchedAt: new Date().toISOString(), limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 60 }] }] }
    : url.includes('devices') ? { devices: [] } : { available: true, checks: [] };

function boot({ cpu = 20 } = {}) {
  const doc = createDocument(), proto = Object.getPrototypeOf(doc.body);
  proto.getClientRects ||= function () { return this.isConnected ? [{}] : []; }; // on screen = attached (no layout here)
  proto.before ||= function (...n) { for (const x of n) this.parentNode.insertBefore(x, this); };
  const fetches = [], timers = [], clock = { shift: 0 };
  const FakeDate = class extends Date { static now() { return Date.now() + clock.shift; } };
  const ctx = { document: doc, localStorage: { getItem: () => null, setItem() {} }, queueMicrotask, AbortController, Event, console, Date: FakeDate,
    setTimeout: (f, ms) => (timers.push({ f, ms }), timers.length), clearTimeout: id => { if (timers[id - 1]) timers[id - 1].f = null; },
    requestAnimationFrame: f => f(), getComputedStyle: () => ({ visibility: 'visible' }),
    fetch: async url => { fetches.push(url); return { ok: true, json: async () => readings(cpu)(url) }; } };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.dispatchEvent = () => {};
  vm.createContext(ctx);
  vm.runInContext(read('web/core/usage.js'), ctx);
  vm.runInContext(read('web/core/resources.js'), ctx);
  // Settings › Resources: the host core/settings.js registers for the page.
  doc.body.innerHTML = '<div class="st-root" data-settings-root><section><div class="st-group st-res" data-st-resources></div></section></div>';
  const host = doc.querySelector('[data-st-resources]');
  const settle = async () => { for (let i = 0; i < 30; i++) await null; };
  const pending = () => timers.filter(t => t.f && t.ms === 15000);
  return { doc, ctx, R: ctx.WosResources, host, fetches, timers, settle, pending, clock };
}

test('one group list feeds every bar host; Settings hosts count as viewers so readings stay fresh', async () => {
  const b = boot();
  assert.deepEqual([...b.R.groups()], ['ai', 'hw']);
  b.R.bars(b.host);
  await b.settle();
  assert.deepEqual(b.fetches, ['/api/system/load', '/api/system/devices', '/api/system/health', '/wizard/ai-usage'], 'a Settings host alone (no Home) reads');
  const groups = b.host.querySelectorAll('[data-rs-group]');
  assert.deepEqual(groups.map(g => g.dataset.rsGroup), ['ai', 'hw']);
  assert.deepEqual(groups.map(g => g.querySelector('.rs-gh b').textContent), ['AI resources', 'Compute resources']);
  assert.deepEqual(b.host.querySelectorAll('.rs-br .rs-bl').map(x => x.textContent), ['Claude', 'Memory', 'Disk', 'CPU']);
  // The same list, the same markup as Home's bars.
  assert.equal(b.host.innerHTML, b.R.barsHtml());
  // A second host draws the same bars; a detached host is dropped and no longer counts as a viewer.
  const other = b.doc.createElement('div'); b.doc.body.appendChild(other); b.R.bars(other);
  assert.equal(other.innerHTML, b.host.innerHTML);
  b.host.closest('.st-root').remove(); other.remove();
  const before = b.fetches.length;
  b.R.sync(); await b.settle();
  assert.equal(b.fetches.length, before, 'no viewer: no reads');
  assert.equal(b.R.state.timer, false, 'and no polling');
});

test('Settings styles the bars in the skin\'s own tokens (stock skins included), scoped to the Resources page', async () => {
  const css = read('web/core/settings.css');
  const b = boot({ cpu: 97 });
  b.R.bars(b.host); await b.settle();
  const widget = b.host.querySelector('.rs-barsw');
  assert.equal(cascade(widget, css).background?.value, 'none', 'Settings draws the bars flat on its own page');
  const fill = b.host.querySelector('.rs-bf');
  assert.equal(cascade(fill, css).background?.value, 'var(--dc)');
  assert.equal(cascade(fill.closest('.rs-bg'), css)['--dc']?.value, 'var(--wz-text)', 'ink is the skin text token');
  const crit = b.host.querySelector('[data-k="hw:cpu"] .rs-bs');
  assert.ok(crit.classList.contains('rs-crit'), 'CPU 97% used is critical');
  assert.equal(cascade(crit.querySelector('.rs-bf'), css).background?.value, 'var(--wz-danger)');
  for (const skin of ['nebula', 'novairecito', 'sepia']) {
    b.doc.documentElement.dataset.skin = skin;
    assert.equal(cascade(fill, css).background?.value, 'var(--dc)', `${skin}: same token rule`);
  }
  // The same bars outside Settings › Resources get none of these rules.
  const home = b.doc.createElement('div'); b.doc.body.appendChild(home); home.innerHTML = b.R.barsHtml();
  assert.equal(cascade(home.querySelector('.rs-bf'), css).background, undefined);
  assert.doesNotMatch(css.slice(css.indexOf('Settings › Resources')), /html\[data-skin/, 'no per-skin rules');
});

test('a Settings host keeps the readings polling (not only Home), and the detail sheet returns focus to the bar that opened it', async () => {
  const b = boot();
  b.R.bars(b.host); await b.settle();
  assert.equal(b.pending().length, 1, 'the next read is scheduled while Settings shows the bars');
  const n = b.fetches.length;
  b.clock.shift = 16000; const t = b.pending()[0], fire = t.f; t.f = null; fire(); await b.settle();
  assert.ok(b.fetches.length > n, 'and it reads again');
  assert.equal(b.pending().length, 1, 'and keeps polling');
  // Tap the CPU bar: the sheet opens; closing returns focus to that very bar.
  const bar = b.host.querySelector('[data-k="hw:cpu"]');
  bar.click(); await b.settle();
  assert.equal(b.R.state.panel, true);
  assert.notEqual(b.doc.activeElement, bar);
  assert.equal(b.R.back(), true); await b.settle();
  assert.equal(b.R.state.panel, false);
  assert.equal(b.doc.querySelector('[data-k="hw:cpu"]'), b.doc.activeElement, 'focus is back on the bar that opened the sheet');
});
