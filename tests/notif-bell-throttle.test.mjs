// The bell's count read is throttled so registry bursts never storm the Notifications app (26 Oct 2026), but an
// owner's own mark must still update the count at once instead of waiting out the throttle or the 60 s poll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8');
function load() {
  const S = { unread: 3, counts: 0, gate: null };
  const fetch = async url => {
    if (url.includes('/api/count')) {
      S.counts++; const unread = S.unread; // the server's count when this read started
      if (S.gate) await S.gate;
      return { ok: true, json: async () => ({ unread, needs: 0 }) };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  };
  const win = { WizCanOpen: () => true, WizAppOpen: () => false, addEventListener() {}, dispatchEvent() {}, CustomEvent: class {} };
  const ctx = { window: win, document: { addEventListener() {}, querySelectorAll: () => [] }, addEventListener() {}, setInterval() {}, setTimeout() {},
    fetch, CustomEvent: class {}, location: { origin: 'http://x' } };
  win.window = win; vm.runInNewContext(src, ctx);
  return { B: win.WosBell, S };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('a burst of refreshes reads the count once', async () => {
  const { B, S } = load();
  await B.refresh(); for (let i = 0; i < 50; i++) await B.refresh();
  assert.equal(S.counts, 1);
});

test('marking inside the throttle window still reads the new count', async () => {
  const { B, S } = load();
  await B.refresh(); assert.equal(B.state.unread, 3);
  S.unread = 2; await B.mark(['n1'], { read: true });
  assert.equal(S.counts, 2); assert.equal(B.state.unread, 2);
});

test('a mark during an in-flight read reruns once after it, never keeping the pre-mark count', async () => {
  const { B, S } = load();
  let open; S.gate = new Promise(r => { open = r; });
  const first = B.refresh(); await tick();
  S.unread = 1; const marked = B.mark(['n1'], { read: true }); await tick();
  S.gate = null; open(); await first; await marked; for (let i = 0; i < 5; i++) await tick();
  assert.equal(S.counts, 2); assert.equal(B.state.unread, 1);
});
