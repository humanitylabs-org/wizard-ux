// A back swipe the browser or OS makes (iOS Safari's left edge, Chrome's overscroll history swipe, Android's edge
// back) must not also run the shell's Back step when a skin gesture already owns that finger (api.gesture.claim): a
// layout's left-edge drawer (the AI apps view) opened AND the chat stepped back to the list, which that view turns into
// a New chat under the drawer (Miguel, 2 Nov 2026). Desks claims no finger, so its Back is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fixture } from './fixtures/tweaks.mjs';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

/* the shell's popstate handler and its Back watcher, run on their own with the shell's names stubbed */
function backHandlers(claimed) {
  const pop = app.match(/  addEventListener\('popstate', e => \{[\s\S]*?\n  \}\);\n/)[0];
  const watcher = app.match(/  function makeWatcher\(win, rearm\) \{[\s\S]*?\n  \}\n/)[0];
  const st = { backs: 0, guards: 0, handler: null, rearms: 0 };
  const ctx = { st, Date, setTimeout: fn => fn(), guardOn: false, ignorePop: 0, dropUntil: 0, watchers: new Set(),
    window: { WosSkinHost: { claimedLately: () => claimed.on } },
    addEventListener: (t, fn) => { if (t === 'popstate') st.handler = fn; },
    onBack: () => { st.backs++; }, ensureGuard: () => { st.guards++; } };
  vm.runInNewContext((app.match(/  const ownedSwipe = [^\n]+\n/) || [''])[0] + watcher + pop + ';st.makeWatcher = makeWatcher;', ctx);
  return st;
}

test('a browser back swipe under a finger a skin gesture owns is not a Back step; any other Back is', () => {
  const claimed = { on: true }, st = backHandlers(claimed);
  st.handler({ state: null });
  assert.equal(st.backs, 0, 'the owned swipe (the drawer\'s) does not step the chat back to the list');
  assert.equal(st.guards, 1, 'the guard is put back, so the next real Back is still caught');
  claimed.on = false; st.handler({ state: null });
  assert.equal(st.backs, 1, 'a Back with no owned finger is one Back step, as before');
});

test('the CloseWatcher Back (Android edge back) follows the same rule', () => {
  const claimed = { on: true }, st = backHandlers(claimed);
  class CW { constructor() { st.w = this; } destroy() {} }
  st.makeWatcher({ CloseWatcher: CW }, () => { st.rearms++; });
  st.w.onclose(); assert.equal(st.backs, 0, 'owned: no Back step'); assert.equal(st.rearms, 1, 're-armed');
  claimed.on = false; st.makeWatcher({ CloseWatcher: CW }, () => { st.rearms++; });
  st.w.onclose(); assert.equal(st.backs, 1, 'not owned: one Back step');
});

test('the host knows a claimed finger lately: while held and for a moment after it lifts; never otherwise', async () => {
  const f = fixture({ shell: 'phone' });
  assert.equal(f.host.claimedLately(), false, 'nothing claimed: every Back is a Back');
  let api = null;
  f.host.builtin('test-claim', a => { api = a; return () => {}; }, { when: 'any' });
  assert.ok(api, 'a built-in gesture gets the skin API');
  assert.equal(api.gesture.claim(4), true);
  assert.equal(f.host.claimedLately(), false, 'an ordinary claim never suppresses Back');
  f.host.release(4);
  assert.equal(f.host.claimedLately(), false, 'nor after an ordinary claimed gesture');
  assert.equal(api.gesture.claim(5, { backSwipe: true }), true);
  assert.equal(f.host.claimedLately(), true, 'held');
  f.host.release(5);
  assert.equal(f.host.claimedLately(), true, 'just lifted (the browser\'s back swipe ends after the finger)');
  assert.equal(f.host.claimedLately(0), false, 'and not for ever');
});
