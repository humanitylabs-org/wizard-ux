import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shortTime } from '../web/layouts/ai-apps/parts.js';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const now = Date.UTC(2026, 10, 3, 5);
function core(zone = 'UTC') {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', day: 'numeric' });
  const dayParts = t => { const p = Object.fromEntries(fmt.formatToParts(t).map(x => [x.type, x.value])); return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), d: Number(p.day) }; };
  const c = vm.createContext({ window: { WizConfig: { dayParts } } });
  vm.runInContext(read('web/core/core.js'), c);
  return c.window.WizCore.ago;
}
test('one core Chats label: elapsed hours across midnight; calendar day only after a full 24h', t => {
  const tz = process.env.TZ; process.env.TZ = 'UTC';
  t.after(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });
  const ago = core();
  for (const [at, want] of [
    [now, 'now'], [now + 60000, 'now'], [now - 5 * 60000, '5m'],
    [now - 15 * 3600000, '15h'], [now - 23 * 3600000, '23h'],
    [now - 86400000 + 1, '24h'], [now - 86400000, 'Mon 2'],
    [Date.UTC(2026, 9, 12, 9), 'Mon 12'], [0, 'Thu 1'],
  ]) {
    assert.equal(ago(at, now), want);
    assert.equal(ago(new Date(at).toISOString(), now), want);
    assert.equal(shortTime(new Date(at).toISOString(), now), want, 'AI apps sidebar/flyout alias matches phone and classic desktop');
  }
  for (const invalid of ['', undefined, 'not-a-date', NaN, Infinity]) assert.equal(ago(invalid, now), '');
});
test('classic boot and later ES-layout evaluation keep one helper instance and registered core modules', () => {
  const c = vm.createContext({ window: {} });
  vm.runInContext(read('web/core/core.js'), c);
  const original = c.window.WizCore.ago, chats = {};
  c.window.WizCore.chats = chats;
  vm.runInContext(read('web/core/core.js'), c);
  assert.equal(c.window.WizCore.ago, original);
  assert.equal(c.window.WizCore.chats, chats);
});
test('older labels follow the owner time zone, not the desktop midnight', () => {
  const at = Date.UTC(2026, 10, 1, 23, 30);
  assert.equal(core('Asia/Bangkok')(at, now), 'Mon 2');
  assert.equal(core('America/Los_Angeles')(at, now), 'Sun 1');
  assert.equal(core('Asia/Bangkok')(now - 15 * 3600000, now), '15h');
  assert.equal(core('America/Los_Angeles')(now - 15 * 3600000, now), '15h');
});
test('all Chats surfaces delegate labels; message stamps and day dividers keep their existing meaning', () => {
  assert.match(read('web/app.js'), /const ago = window\.WizCore\.ago;/);
  assert.match(read('web/desktop/desktop.js'), /const \{ esc, clip, norm, ago, emoOf \} = C;/);
  assert.match(read('web/core/chats.js'), /const \{ esc, clip, norm, ago, emoOf \} = window\.WizCore;/);
  assert.match(read('web/core/chats.js'), /const sub = [^\n]+ago\(/, 'shared thread header');
  const desktop = read('web/layouts/ai-apps/desktop.js');
  assert.match(desktop, /shortTime\(s\.at, Date\.now\(\)\)/, 'sidebar');
  assert.match(desktop, /shortTime\(r\.at, now\)/, 'rail flyout');
  assert.doesNotMatch(read('web/layouts/ai-apps/parts.js'), /Yesterday|setHours\(0, 0, 0, 0\)/);
});
