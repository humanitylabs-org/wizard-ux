// The first-run tour guards every tap outside its own targets (window-capture pointerdown + click). If Settings opens
// while it runs (a deeplink, notification or command), those taps would be swallowed under the scrim: on a phone the
// owner tapped "Your changes" and nothing happened. Opening Settings ends the tour as a handoff instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/core/tour.js', import.meta.url), 'utf8');

test('opening Settings mid-tour hands off: the tour finishes and stops guarding taps', () => {
  assert.match(src, /if \(type === 'sheet' && d\.which === 'settings'\) return finish\('handoff'\);/);
  const ev = src.indexOf("function event(type, d = {})"), guard = src.indexOf("d.which === 'settings'"), launcher = src.indexOf("d.which === 'launcher'");
  assert.ok(ev > 0 && guard > ev && guard < launcher, 'checked before any beat can steer the owner back');
  assert.match(src, /const active = \(\) => !!\(el && step > 0\);/);
  assert.match(src, /step = 0; inbox = false; busy = false; mark\(\);/, 'finish clears the step, so active() is false and taps pass');
});
