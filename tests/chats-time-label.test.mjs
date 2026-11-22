import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shortTime } from '../web/layouts/ai-apps/parts.js';
import { withParts } from './fixtures/chats-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
const read = p => withShellParts(withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8')));
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
// Each surface gets its label from the one core helper: give WizCore an ago that marks what it was asked, run the
// surface's real code (its own destructure of WizCore included) and read the label it drew.
const mark = t => `ago<${t}>`;
test('all Chats surfaces delegate labels; message stamps and day dividers keep their existing meaning', () => {
  const t1 = { id: 's1', title: 'Plan trip', lastAssistantAt: '2026-11-03T01:00:00Z', updatedAt: '2026-11-02T01:00:00Z', status: 'idle' };
  // phone (app.js): the launcher's thread hits
  const app = read('web/app.js'), painted = [];
  const phone = runRecording(between(app, '  const ago = window.WizCore.ago;', '\n') + '\n' + block(app, '  function renderLauncher(q, live) {') + '\nglobalThis.run = renderLauncher;',
    { window: { WizCore: { ago: mark, isMaintenanceApp: () => false } }, $: () => ({ set innerHTML(h) { painted.push(h); }, get innerHTML() { return ''; } }), APPS: [], norm: x => String(x).toLowerCase(), esc: String, emoOf: () => '',
      LIVE: { ok: true, sessions: [t1], isNew: () => false }, sig: () => '', searchUrl: () => '', appRow: () => '' });
  phone.run('plan');
  assert.match(painted.at(-1), /<small>ago<2026-11-03T01:00:00Z><\/small>/, 'phone launcher: the core label of the last reply');
  // classic desktop (desktop.js): the palette's thread rows
  const desk = read('web/desktop/desktop.js');
  const d = runRecording(between(desk, '  const C = window.WizCore;', '\n') + '\n' + between(desk, '  const { esc, clip, norm, ago, emoOf } = C;', '\n') + '\n' + block(desk, '  function palBuild(q) {') + '\nglobalThis.run = palBuild;',
    { window: { WizCore: { ago: mark, esc: String, clip: String, norm: x => String(x || '').toLowerCase(), emoOf: () => '', isMaintenanceApp: () => false }, WizConfig: { agent: () => 'Wizard' } },
      APPS: [], searchApps: () => [], LIVE: { ok: true, sessions: [t1], cardAt: s => s.updatedAt, isNew: () => false }, WORKING_ST: new Set(), commands: () => [], searchUrl: () => '' });
  const rows = d.run('plan').find(g => g.grp === 'Threads').items;
  assert.equal(rows[0].sub, 'ago<2026-11-02T01:00:00Z>', 'desktop palette: the core label');
  // shared Chats (core/chats.js): the thread header
  const chats = withParts(read('web/core/chats.js'));
  const c = runRecording(between(chats, '  const { esc, clip, norm, ago, emoOf } = window.WizCore;', '\n') + '\n' + block(chats, '  function threadState(s, agent) {') + '\nglobalThis.run = threadState;',
    { window: { WizCore: { ago: mark, esc: String, clip: String, norm: String, emoOf: () => '' } }, isWorking: () => false, snoozeLast: () => false });
  assert.equal(c.run(t1, 'wizard').sub, 'Updated ago<2026-11-03T01:00:00Z>', 'shared thread header');
  // AI apps (layouts/ai-apps/parts.js): shortTime gives the core labels (the first test above); its sidebar and rail
  // flyout draw them ('desktop AI apps sidebar and rail flyout keep phone hours across midnight', ai-apps-view.test.mjs)
  assert.doesNotMatch(read('web/layouts/ai-apps/parts.js'), /Yesterday|setHours\(0, 0, 0, 0\)/);
});
