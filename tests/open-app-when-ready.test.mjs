// Issue 1651: a tap on an app the Store just installed must never do nothing. While the registry has no page for it
// yet, the shell says it is starting, keeps re-checking, and opens it once it is ready. The wait lives once in
// core/apps.js (WizCore.whenOpenable); the phone and desktop shells' wizard:open-app handlers use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { between, block } from './fixtures/source-slice.mjs';

const read = f => withShellParts(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const appsJs = read('web/core/apps.js');

// A fake clock: setTimeout fires in time order, instantly, so a minute of waiting runs in milliseconds.
function clock() {
  let t = 0; const q = [];
  const setT = (fn, ms = 0) => { const id = { at: t + ms, fn }; q.push(id); return id; };
  const clearT = id => { const i = q.indexOf(id); if (i >= 0) q.splice(i, 1); };
  const pump = async () => { for (let n = 0; n < 5000; n++) { await new Promise(r => setImmediate(r)); if (!q.length) continue; q.sort((a, b) => a.at - b.at); const x = q.shift(); t = Math.max(t, x.at); x.fn(); } };
  return { now: () => t, setT, clearT, pump };
}

function harness({ readyAfter = Infinity, stuck = false } = {}) {
  const start = appsJs.indexOf('  const openWaits = new Map();');
  const end = appsJs.indexOf('    openWaits.set(id, p); return p;\n  };', start);
  assert.ok(start > 0 && end > start, 'WizCore.whenOpenable not found in core/apps.js');
  const body = appsJs.slice(start, end) + '    openWaits.set(id, p); return p;\n  };';
  const c = clock(), said = [], APP = {};
  let reads = 0;
  const loadRemote = () => { reads++; if (stuck) return new Promise(() => {}); if (reads >= readyAfter) APP.tracker = { id: 'tracker', name: 'WizardOS Tracker', url: '/wizardos-tracker/' }; return Promise.resolve(true); };
  const window = { WizCore: {} };
  const DateStub = { now: c.now };
  new Function('window', 'loadRemote', 'setTimeout', 'clearTimeout', 'Date', body)(window, loadRemote, c.setT, c.clearT, DateStub);
  const opts = { openable: id => (APP[id]?.url ? APP[id] : null), name: id => APP[id]?.name, say: t => said.push(t) };
  return { wait: id => window.WizCore.whenOpenable(id, opts), waitWith: (id, o) => window.WizCore.whenOpenable(id, o), said, APP, reads: () => reads, pump: c.pump };
}

test('an already openable app comes back at once, with no read and no note', async () => {
  const h = harness();
  h.APP.tracker = { id: 'tracker', url: '/wizardos-tracker/' };
  assert.equal((await h.wait('tracker')).id, 'tracker');
  assert.equal(h.reads(), 0); assert.deepEqual(h.said, []);
});

test('ready on the first re-read: opens with no Starting… flash', async () => {
  const h = harness({ readyAfter: 1 });
  const p = h.wait('tracker'); await h.pump();
  assert.equal((await p).url, '/wizardos-tracker/');
  assert.deepEqual(h.said, []);
});

test('still starting: says so, keeps re-reading, opens once the list has its page; a second tap joins', async () => {
  const h = harness({ readyAfter: 4 });
  const p = h.wait('tracker'), second = h.wait('tracker'); await h.pump();
  const a = await p;
  assert.equal(a.url, '/wizardos-tracker/'); assert.equal(await second, a);
  assert.equal(h.reads(), 4);
  assert.deepEqual(h.said, ['The app is starting…']);
});

test('never gets a page: says it is still starting instead of doing nothing, after about a minute', async () => {
  const h = harness();
  const p = h.wait('tracker'); await h.pump();
  assert.equal(await p, null);
  assert.ok(h.reads() > 20 && h.reads() < 45, `bounded re-reads: ${h.reads()}`);
  assert.equal(h.said.length, 2);
  assert.match(h.said[1], /installed but still starting\. Try again in a moment\./);
});

test('a read that never settles still shows Starting… and still ends', async () => {
  const h = harness({ stuck: true });
  const p = h.wait('tracker'); await h.pump();
  assert.equal(await p, null);
  assert.equal(h.said[0], 'The app is starting…');
  assert.match(h.said[1], /still starting/);
});

// The shell's real wizard:open-app handler (sliced from the phone or desktop shell, parts put back) over the real
// WizCore.whenOpenable above: a Store frame posts, the shell waits for the app's page and opens it.
function shell(file, { readyAfter = 4 } = {}) {
  const src = read(file);
  const from = src.indexOf('  const whenOpenable = (id, hint) =>');
  const at = src.indexOf("d.type !== 'wizard:open-app'", from), to = src.indexOf('\n  });\n', at);
  assert.ok(from > 0 && at > from && to > at, `${file}: the open-app handler`);
  const h = harness({ readyAfter }), listeners = {}, toasts = [], opened = [], closed = [];
  const store = { contentWindow: {}, closest: () => host }, host = { dataset: { win: 'w1' }, isConnected: true };
  const ctx = {
    window: { WizCore: {} },
    APP: h.APP, hostedOpenable: id => (h.APP[id]?.url ? h.APP[id] : null), toast: (...a) => toasts.push(a), esc: v => String(v),
    location: { origin: 'https://wizard.test' }, addEventListener: (t, f) => (listeners[t] ||= []).push(f),
    document: { querySelectorAll: () => [store] }, W: { w1: { appId: 'app-store' } },
    openApp: a => { opened.push(a.id); }, closeWin: id => { closed.push(id); },
  };
  ctx.window.WizCore.whenOpenable = (id, o) => h.waitWith(id, o);
  vm.runInNewContext(src.slice(from, to + 6), ctx);
  const post = async (data, source = store.contentWindow) => {
    const done = Promise.all((listeners.message || []).map(f => f({ origin: 'https://wizard.test', source, data })));
    await h.pump(); await done;
  };
  return { post, toasts, opened, closed, h, ctx };
}

for (const file of ['web/app.js', 'web/desktop/desktop.js']) {
  test(`${file}: the Store's open-app message waits through WizCore.whenOpenable, not one refresh`, async () => {
    const s = shell(file, { readyAfter: 4 });
    await s.post({ type: 'wizard:open-app', id: 'tracker', name: 'WizardOS Tracker', replace: true });
    assert.equal(s.h.reads(), 4, 'kept re-reading the app list until the page was there');
    assert.deepEqual(s.opened, ['tracker'], 'then opened it');
    assert.deepEqual(s.closed, ['w1'], 'Get more: the app takes the Store window\'s place');
    assert.deepEqual(s.toasts.map(t => t[1]), ['WizardOS Tracker is starting…']);
    // Never ready: says so instead of doing nothing, and opens nothing.
    const never = shell(file, { readyAfter: Infinity });
    await never.post({ type: 'wizard:open-app', id: 'tracker', name: 'WizardOS Tracker' });
    assert.deepEqual(never.opened, []);
    assert.match(never.toasts.at(-1)[1], /^WizardOS Tracker is installed but still starting/);
    // Only trusted system frames may ask.
    const other = shell(file, { readyAfter: 1 });
    await other.post({ type: 'wizard:open-app', id: 'tracker' }, {});
    other.ctx.W.w1.appId = 'notes'; await other.post({ type: 'wizard:open-app', id: 'tracker' });
    assert.deepEqual(other.opened, []); assert.equal(other.h.reads(), 0);
  });
}

test('the Store names the app in its open-app message, so the starting note says which app', async () => {
  const store = read('web/store/store.js'), posted = [];
  const base = { parent: { postMessage: m => posted.push(JSON.parse(JSON.stringify(m))) }, location: { origin: 'https://wizard.test', search: '?open=1' }, URLSearchParams, toast() {}, esc: v => String(v) };
  // Open from My apps after the Starting… wait.
  const c = { ...base, S: { apps: [{ id: 'tracker', name: 'WizardOS Tracker' }], late: new Set() }, openId: x => x.id };
  vm.runInNewContext(block(store, '  async function openInShell(id)') + '\nthis.openInShell = openInShell;', c);
  await c.openInShell('tracker');
  // Get more (?open=1) right after an install: in place of the Store window.
  const line = between(store, "if (framed && new URLSearchParams(location.search).get('open') === '1' && openId(a))", '\n');
  vm.runInNewContext(line, { ...base, framed: true, a: { id: 'wizardos-tracker', name: 'WizardOS Tracker' }, openId: () => 'tracker' });
  assert.equal(JSON.stringify(posted), '[{"type":"wizard:open-app","id":"tracker","name":"WizardOS Tracker"},'
    + '{"type":"wizard:open-app","id":"tracker","name":"WizardOS Tracker","replace":true}]');
  // The shell's note then names it.
  const s = shell('web/app.js', { readyAfter: 3 });
  await s.post(posted[1]);
  assert.equal(s.toasts[0][1], 'WizardOS Tracker is starting…');
});
