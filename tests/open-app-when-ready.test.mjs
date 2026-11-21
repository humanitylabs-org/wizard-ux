// Issue 1651: a tap on an app the Store just installed must never do nothing. While the registry has no page for it
// yet, the shell says it is starting, keeps re-checking, and opens it once it is ready. The wait lives once in
// core/apps.js (WizCore.whenOpenable); the phone and desktop shells' wizard:open-app handlers use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
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
  return { wait: id => window.WizCore.whenOpenable(id, opts), said, APP, reads: () => reads, pump: c.pump };
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

for (const file of ['web/app.js', 'web/desktop/desktop.js']) {
  test(`${file}: the Store's open-app message waits through WizCore.whenOpenable, not one refresh`, () => {
    const src = read(file);
    const i = src.indexOf("d.type !== 'wizard:open-app'");
    const handler = src.slice(i, src.indexOf('});', i));
    assert.match(handler, /await whenOpenable\(d\.id, d\.name\)/);
    assert.doesNotMatch(handler, /refreshApps/);
    assert.match(src, /const whenOpenable = \(id, hint\) => window\.WizCore\.whenOpenable\(id, \{ openable: hostedOpenable, name: id => APP\[id\]\?\.name \|\| /);
  });
}

test('the Store names the app in its open-app message, so the starting note says which app', () => {
  const src = read('web/store/store.js');
  assert.match(src, /type: 'wizard:open-app', id, name \}/);
  assert.match(src, /type: 'wizard:open-app', id: openId\(a\), name: a\.name, replace: true/);
});
