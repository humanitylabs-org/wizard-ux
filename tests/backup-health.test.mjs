// Backup health in Resources (wizard-ux issue 1743, switch wizard/backup-health). The real core/usage.js +
// core/resources.js + core/features.js run in node:vm on the mini-dom with a fake box: with the switch on, Health shows
// the App Manager's rows from this box's own backup (store-install/_backup-health) even with no watchdog, a watchdog row
// with the same key wins, Include it posts once and shows the answer, and ?view=backup-health opens Health. With the
// switch off nothing is read and Health is exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const BACKUP = { key: 'backups', label: 'Backup', status: 'ok', value: 'Last backup 11h ago, checked, 4 kept', detail: '' };
const AGENT = { key: 'main-agent-backup', label: 'Main agent', status: 'warn', value: 'not in backup',
  detail: 'Your main agent (its memory, skills and every chat) isn’t in your backup.', action: { id: 'include-main-agent', label: 'Include it' } };

function boot({ on = true, watchdog = null, own = { available: true, checks: [BACKUP, AGENT], checkedAt: new Date().toISOString() }, include } = {}) {
  const doc = createDocument(), proto = Object.getPrototypeOf(doc.body);
  proto.getClientRects ||= function () { return this.isConnected ? [{}] : []; };
  proto.before ||= function (...n) { for (const x of n) this.parentNode.insertBefore(x, this); };
  proto.focus ||= function () {};
  if (on) doc.documentElement.dataset.tweaks = 'wizard/backup-health';
  const fetches = [], posts = [], timers = [], listeners = {};
  const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const ctx = { document: doc, localStorage: { getItem: () => null, setItem() {} }, queueMicrotask, AbortController, Event, console, Date, URL,
    setTimeout: (f, ms) => (timers.push({ f, ms }), timers.length), clearTimeout: id => { if (timers[id - 1]) timers[id - 1].f = null; },
    requestAnimationFrame: f => f(), getComputedStyle: () => ({ visibility: 'visible' }), location: { href: 'https://box.example.ts.net/wizard-os-home/' },
    fetch: async (url, opts = {}) => {
      url = String(url); fetches.push(url);
      if (url.endsWith('/store-install/_backup-health')) {
        if (opts.method === 'POST') { posts.push({ body: JSON.parse(opts.body), headers: opts.headers }); return answer(200, include ? include() : { ok: true, message: 'Done.' }); }
        return own === 404 ? answer(404, { error: 'not found' }) : answer(200, own);
      }
      if (url.includes('/load')) return answer(200, { cpuLoad: 10, percentUsedMemory: 40, percentUsed: 50 });
      if (url.includes('devices')) return answer(200, { devices: [] });
      if (url.includes('/api/system/health')) return watchdog ? answer(200, watchdog) : answer(404, { error: 'not_found' });
      return answer(200, { providers: [] });
    } };
  ctx.window = ctx; ctx.addEventListener = (t, f) => (listeners[t] ||= []).push(f); ctx.dispatchEvent = () => {};
  vm.createContext(ctx);
  vm.runInContext(`document.currentScript = { src: 'https://box.example.ts.net/wizard-os-home/core/resources.js' };`, ctx);
  vm.runInContext(read('web/core/usage.js'), ctx);
  vm.runInContext(read('web/core/resources.js'), ctx);
  vm.runInContext(read('web/core/features.js'), ctx);
  doc.body.innerHTML = '<div class="device"><div data-home-resources></div></div>';
  const settle = async () => { for (let i = 0; i < 40; i++) await null; };
  const H = ctx.WosFeatures;
  H.install({ openFeature() {} });
  return { doc, ctx, R: ctx.WosResources, F: H, fetches, posts, settle };
}
const openHealth = async b => { assert.ok(b.F.open('backup-health'), '?view=backup-health opens Health'); await b.settle(); return b.doc.querySelector('[data-res-body]'); };

test('switch on, no watchdog: Health shows the box\'s own backup rows and Home names the left-out main agent', async () => {
  const b = boot();
  const body = await openHealth(b);
  assert.ok(b.fetches.includes('https://box.example.ts.net/wizard-os-home/store-install/_backup-health'));
  const rows = body.querySelectorAll('[data-health]');
  assert.deepEqual(rows.map(r => r.dataset.health), ['main-agent-backup', 'backups'], 'problems first');
  assert.match(body.querySelector('[data-health="backups"]').textContent, /Last backup 11h ago, checked, 4 kept/);
  assert.doesNotMatch(body.textContent, /unavailable|showing last reading/, 'no "unavailable" on a box without a watchdog');
  assert.equal(body.querySelector('[data-res-bh]').textContent, 'Include it');
  assert.deepEqual(JSON.parse(JSON.stringify(b.R.healthProblems().map(p => p.text))), ['Main agent not in backup'], 'Home line until it clears');
});

test('Include it posts once, shows the plain answer, and reads the rows again', async () => {
  const b = boot({ include: () => ({ ok: false, state: 'no_room', reason: 'Not enough room yet: backing up your main agent needs 106.0 GB free, 72.0 GB free.' }) });
  const body = await openHealth(b);
  const btn = body.querySelector('[data-res-bh]');
  btn.click();
  await b.settle();
  assert.equal(b.posts.length, 1);
  assert.deepEqual(b.posts[0].body, { action: 'include-main-agent' });
  assert.equal(b.posts[0].headers['X-Wizard-Store'], '1');
  const msg = b.doc.querySelector('[data-res-body] .rs-h-msg');
  assert.match(msg.textContent, /needs 106\.0 GB free, 72\.0 GB free/);
  assert.equal(b.doc.querySelector('[data-res-bh]').textContent, 'Include it', 'can try again after freeing disk');
  assert.equal(b.fetches.filter(u => u.endsWith('_backup-health')).length >= 2, true, 'rows read again after the tap');
});

test('a watchdog row with the same key wins; other watchdog rows stay', async () => {
  const watchdog = { available: true, checkedAt: new Date().toISOString(), stale: false, status: 'ok', counts: { ok: 2, warn: 0, error: 0 },
    checks: [{ key: 'backups', label: 'Backups', status: 'ok', value: 'watchdog says fine', detail: '' }, { key: 'services', label: 'Services', status: 'ok', value: '0 failed', detail: '' }] };
  const b = boot({ watchdog });
  const body = await openHealth(b);
  assert.deepEqual(body.querySelectorAll('[data-health]').map(r => r.dataset.health), ['main-agent-backup', 'backups', 'services']);
  assert.match(body.querySelector('[data-health="backups"]').textContent, /watchdog says fine/);
});

test('switch off: nothing is read and Health is exactly as before', async () => {
  const b = boot({ on: false });
  b.R.update(true); await b.settle();
  assert.ok(!b.fetches.some(u => u.includes('_backup-health')));
  assert.equal(b.R.healthProblems().length, 0);
  assert.equal(b.R.state.health, null);
});

test('switch on but the App Manager answers 404 (its half off or older): Health as before', async () => {
  const b = boot({ own: 404 });
  const body = await openHealth(b);
  assert.match(body.textContent, /Health checks unavailable right now/);
  assert.equal(b.R.healthProblems().length, 0);
});
