import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { fixture } from './fixtures/web-update-harness.mjs';
import { runWithStubs } from './fixtures/source-slice.mjs';

// James, 7 Nov 2026: his desktop stayed on an afternoon build through ten releases because the interface only
// reloaded on a tap. The desktop now applies a pending update by itself when its window is hidden or quiet, and
// never while someone is typing or anything a tap would wait on is in flight. Synthetic documents only.
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

test('phone (no autoApply) still reloads only when tapped', async () => {
  const f = fixture({ autoApply: false }); await f.update();
  await f.hide(); f.advance(60 * 60e3); await f.tick();
  assert.equal(f.reloads, 0);
});

test('desktop host opts in', () => {
  // the desktop's real init call, run with a stub WizWebUpdate that keeps the options it gets
  const src = withShellParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
  const i = src.indexOf('window.WizWebUpdate?.init({');
  let depth = 0, j = src.indexOf('(', i);
  for (; j < src.length; j++) { if (src[j] === '(') depth++; else if (src[j] === ')' && --depth === 0) break; }
  let got = null;
  runWithStubs(src.slice(i, j + 1), { window: { WizWebUpdate: { init: o => { got = o; } } } });
  assert.equal(got?.autoApply, true);
  assert.equal(got?.shell, 'desktop');
});
