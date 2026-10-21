import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { schedulerFixture } from './fixtures/scheduler.mjs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const settle = async f => { const until = Date.now() + 3000; while (!f()) { if (Date.now() > until) throw Error('Fixture did not settle'); await new Promise(r => setTimeout(r, 5)); } };
async function harness(t, { missing = false, shell = 'phone', timeZone = 'Europe/London', now = '2026-10-21T12:00:00Z' } = {}) {
  const fixture = schedulerFixture(); fixture.missing = missing;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const d = fixture.handle(req.url, req.method, body ? JSON.parse(body) : {});
    res.writeHead(d.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(d.body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`, opened = [], notices = [];
  const s = { console, Map, Set, WeakMap, Date, String, CSS: { escape: String }, setTimeout, requestAnimationFrame: f => f(), document: { activeElement: null }, navigator: { userAgent: 'Fixture' }, location: { host: 'example.test' }, localStorage: { getItem: () => null }, fetch: (url, opts) => fetch(origin + url, opts) };
  s.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Date.parse(now); } };
  s.window = s; s.WizCore = {}; s.WizBrand = { html: 'W' }; s.WizConfig = { timeZone: () => timeZone };
  vm.runInNewContext(read('web/core/settings.js'), s);
  vm.runInNewContext(read('web/core/schedules.js'), s);
  const roots = [];
  function mount() {
    const events = {}, root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false, querySelector: () => null, querySelectorAll: () => [], addEventListener: (k, f) => events[k] = f, removeEventListener() {} };
    const view = s.WosSettings.mount(root, { shell, live: { sessions: [{ id: 'chat-brief', title: 'Daily notes' }], session: id => id === 'chat-brief' ? { title: 'Daily notes' } : null }, toast: (...a) => notices.push(a), openThread: id => opened.push(id) });
    roots.push({ root, view, events }); return roots.at(-1);
  }
  const h = mount();
  t.after(async () => { roots.forEach(h => h.view.destroy()); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  await s.WosSchedules.load();
  const act = (action, id = '', target = h) => {
    const button = { dataset: { sc: action, scId: id } };
    target.view.dispatch({ closest: sel => sel === '[data-sc]' ? button : sel === '[data-settings-feature]' ? { dataset: { settingsFeature: 'schedules' } } : null });
  };
  const input = (key, value, target = h) => {
    const field = { dataset: { scField: key }, value };
    const el = { closest: sel => sel === '[data-settings-feature]' ? { dataset: { settingsFeature: 'schedules' } } : sel === '[data-sc-field]' ? field : null };
    target.events.input({ target: el }); target.events.change({ target: el });
  };
  return { ...h, s, fixture, opened, notices, mount, act, input };
}
test('one registration is loaded by both entrypoints; colours only use Appearance tokens', () => {
  for (const f of ['web/index.html', 'web/desktop.html']) assert.match(read(f), /core\/schedules\.js/);
  const css = read('web/core/settings.css').split('/* Shared approved')[0];
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|var\(--(?!wz-)/i);
  assert.match(css, /background: transparent/);
  assert.match(read('web/desktop/desktop.js'), /if \(settingsView.back\(\)\) return 'settings-page'; closeSettings\(\)/, 'desktop browser Back uses the shared nested Settings stack before closing');
});
test('404 older Agent Service hides the category and body in both layouts', async t => {
  for (const shell of ['phone', 'desktop']) {
    const h = await harness(t, { missing: true, shell });
    assert.equal(h.s.WosSchedules.available, false);
    h.view.focus('schedules'); assert.equal(h.view.page, '', 'unsupported direct links return to Settings');
    assert.doesNotMatch(h.root.innerHTML, /data-st-page="schedules"|data-settings-feature="schedules"/);
  }
});
test('list shows name, English when, destination and last/next runs in owner timezone; chat opens exact thread', async t => {
  const h = await harness(t); h.view.focus('schedules');
  for (const text of ['Morning brief', 'Every day 07:00', 'Every 5 min', 'Daily notes', 'New chat on first run', 'Last run 07:00 · Posted', 'Last run · not yet', 'Next 07:00 tomorrow', 'Next · paused']) assert.ok(h.root.innerHTML.includes(text), text);
  assert.doesNotMatch(h.root.innerHTML, /Never run|Last run.*2026|proof|debug/);
  h.act('chat', 'morning'); assert.deepEqual(h.opened, ['chat-brief']);
});
test('all run outcomes, escaped short errors and older-service fields render honestly', async t => {
  const h = await harness(t); h.view.focus('schedules');
  for (const [outcome, error, expected] of [['silent', null, 'Silent'], ['failed', '<offline>', 'Failed: &lt;offline&gt;'], ['running', null, 'Running']]) {
    Object.assign(h.fixture.jobs[0].lastRun, { outcome, error }); await h.s.WosSchedules.load();
    assert.ok(h.root.innerHTML.includes('Last run 07:00 · ' + expected));
    assert.doesNotMatch(h.root.innerHTML, /<offline>/);
  }
  delete h.fixture.jobs[0].lastRun; delete h.fixture.jobs[0].nextRun;
  await h.s.WosSchedules.load();
  assert.match(h.root.innerHTML, /Last run · unavailable/); assert.match(h.root.innerHTML, /Next · unavailable/);
  h.fixture.jobs[0].lastRun = { outcome: 'posted', scheduledFor: 'bad' }; h.fixture.jobs[0].nextRun = 'bad';
  await h.s.WosSchedules.load(); assert.match(h.root.innerHTML, /Last run · unavailable/); assert.match(h.root.innerHTML, /Next · unavailable/);
});
test('next labels use owner calendar days over midnight and DST, not job or device timezone', async t => {
  for (const [timeZone, now, nextRun, label] of [
    ['Asia/Bangkok', '2026-10-21T18:30:00Z', '2026-10-22T00:00:00Z', 'Next 07:00 today'],
    ['America/New_York', '2026-10-31T04:30:00Z', '2026-11-01T12:00:00Z', 'Next 07:00 tomorrow'],
    ['Europe/London', '2026-10-21T12:00:00Z', '2026-10-25T07:00:00Z', 'Next 07:00 25 Oct'],
  ]) {
    const h = await harness(t, { timeZone, now }); h.fixture.jobs[0].nextRun = nextRun;
    await h.s.WosSchedules.load(); h.view.focus('schedules'); assert.ok(h.root.innerHTML.includes(label), label);
  }
});
test('toggle PATCH changes only enabled and reads the list back', async t => {
  const h = await harness(t); h.view.focus('schedules'); h.act('toggle', 'morning');
  await settle(() => h.fixture.calls.some(c => c.method === 'PATCH') && h.fixture.calls.at(-1).method === 'GET' && h.root.innerHTML.includes('aria-label="Morning brief" aria-checked="false"'));
  const patch = h.fixture.calls.find(c => c.method === 'PATCH'); assert.deepEqual(patch.body, { enabled: false });
  assert.equal(h.fixture.calls.at(-1).method, 'GET'); assert.equal(h.fixture.jobs[0].model, 'kept-model');
});
test('Run now requests once, reads back and never claims completion', async t => {
  const h = await harness(t); h.view.focus('schedules'); h.act('run', 'morning'); h.act('run', 'morning');
  await settle(() => h.notices.length === 1);
  assert.equal(h.fixture.calls.filter(c => c.path.endsWith('/run')).length, 1);
  assert.equal(h.fixture.calls.at(-1).method, 'GET'); assert.equal(h.notices[0][1], 'Run requested');
});
test('import dry-run shows paused candidates and skipped scripts before explicit confirm', async t => {
  const h = await harness(t); h.view.focus('schedules'); h.act('import');
  await settle(() => h.root.innerHTML.includes('would import (paused)'));
  assert.match(h.root.innerHTML, /Disk cleanup/); assert.match(h.root.innerHTML, /not imported: script job/);
  assert.deepEqual(h.fixture.calls.filter(c => c.path.endsWith('import-hermes')).map(c => c.body), [{ dryRun: true }]);
  h.act('confirm-import'); await settle(() => h.root.innerHTML.includes('imported (paused)') && h.fixture.calls.at(-1).method === 'GET');
  assert.deepEqual(h.fixture.calls.filter(c => c.path.endsWith('import-hermes')).map(c => c.body), [{ dryRun: true }, { dryRun: false }]);
  assert.equal(h.fixture.jobs.at(-1).enabled, false);
});
test('Back closes edit sheet, then returns to Settings without closing the app', async t => {
  const h = await harness(t); h.view.focus('schedules'); h.act('edit', 'morning'); assert.match(h.root.innerHTML, /role="dialog"/);
  assert.equal(h.view.back(), true); assert.equal(h.view.page, 'schedules'); assert.doesNotMatch(h.root.innerHTML, /role="dialog"/);
  assert.equal(h.view.back(), true); assert.equal(h.view.page, ''); assert.equal(h.view.back(), false);
  assert.ok(h.root.innerHTML.includes('Settings')); assert.equal(h.fixture.calls.filter(c => c.method !== 'GET').length, 0);
});
test('create and edit fields are sent to fixture HTTP; PATCH retains non-editable job fields', async t => {
  const h = await harness(t); h.view.focus('schedules'); h.act('new');
  for (const [k, v] of Object.entries({ name: 'Five minutes', kind: 'every', timing: '5', prompt: 'Read my notes', thread: 'chat-brief' })) h.input(k, v);
  h.act('save'); await settle(() => !h.root.innerHTML.includes('role="dialog"'));
  const created = h.fixture.jobs.find(j => j.id === 'created'); assert.deepEqual(created.when, { every: 5 }); assert.equal(created.enabled, true); assert.equal(created.thread, 'chat-brief');
  h.act('edit', 'morning'); h.input('name', 'Earlier brief'); h.input('timing', '0 6 * * *'); h.act('save');
  await settle(() => !h.root.innerHTML.includes('role="dialog"'));
  const edited = h.fixture.jobs[0]; assert.equal(edited.name, 'Earlier brief'); assert.equal(edited.model, 'kept-model'); assert.equal(edited.timezone, 'Europe/London'); assert.equal(edited.agent, 'main');
  assert.deepEqual(h.fixture.calls.filter(c => c.method === 'PATCH')[0].body.when, { cron: '0 6 * * *' });
});
test('failed saves keep the draft and escaped server error; live re-render and second mount do not lose/mix drafts', async t => {
  const h = await harness(t), second = h.mount(); h.view.focus('schedules'); second.view.focus('schedules'); h.act('new'); h.input('name', '<My draft>'); h.input('prompt', 'Keep this');
  const mounted = h.root.innerHTML; h.s.WosSettings.refresh(); assert.equal(h.root.innerHTML, mounted, 'background refresh never replaces the live form'); assert.doesNotMatch(second.root.innerHTML, /role="dialog"/);
  h.fixture.fail = '<offline>'; h.act('save'); await settle(() => h.root.innerHTML.includes('&lt;offline&gt;'));
  assert.match(h.root.innerHTML, /&lt;My draft&gt;/); assert.match(h.root.innerHTML, /Keep this/); assert.doesNotMatch(h.root.innerHTML, /<offline>/);
  h.fixture.fail = null; h.act('save'); await settle(() => !h.root.innerHTML.includes('role="dialog"'));
  assert.equal(h.fixture.jobs.at(-1).name, '<My draft>');
});
test('Delete requires confirm; Cancel and Back do not mutate', async t => {
  const h = await harness(t); h.view.focus('schedules'); h.act('delete', 'morning'); assert.match(h.root.innerHTML, /role="alertdialog"/);
  h.act('close'); assert.equal(h.fixture.jobs.length, 2); h.act('delete', 'morning'); h.view.back(); assert.equal(h.fixture.jobs.length, 2);
  h.act('delete', 'morning'); h.act('confirm-delete', 'morning'); await settle(() => !h.root.innerHTML.includes('data-sc-row="morning"'));
  assert.equal(h.fixture.calls.filter(c => c.method === 'DELETE').length, 1); assert.equal(h.fixture.calls.at(-1).method, 'GET');
});
test('a delayed sheet autofocus never steals focus from a field already reached', async t => {
  const h = await harness(t), frames = []; h.s.requestAnimationFrame = f => frames.push(f);
  h.view.focus('schedules'); h.act('edit', 'morning');
  let stolen = 0; h.root.querySelector = sel => sel === '[data-sc-field="name"]' ? { focus: () => stolen++ } : null;
  h.s.document.activeElement = { closest: sel => sel === '.sc-sheet' ? {} : null };
  frames.forEach(f => f()); assert.equal(stolen, 0);
});
test('failed create readback keeps its returned id, so retry cannot create a second schedule', async t => {
  const h = await harness(t); h.view.focus('schedules'); await h.s.WosSchedules.load();
  h.act('new'); h.input('name', 'Keep the created id'); h.input('prompt', 'Fixture'); h.fixture.failReads = true; h.act('save');
  await settle(() => h.root.innerHTML.includes('Saved request, but could not refresh schedules'));
  assert.equal(h.fixture.jobs.filter(j => j.id === 'created').length, 1);
  h.fixture.failReads = false; h.act('save'); await settle(() => !h.root.innerHTML.includes('role="dialog"'));
  assert.equal(h.fixture.calls.filter(c => c.method === 'POST' && c.path === '/wizard/v1/schedules').length, 1);
  assert.ok(h.fixture.calls.some(c => c.method === 'PATCH' && c.path.endsWith('/created')));
  assert.equal(h.fixture.jobs.filter(j => j.id === 'created').length, 1);
});
test('invalid form sends no writes and permits correction', async t => {
  const h = await harness(t); h.view.focus('schedules'); h.act('new'); h.act('save');
  await settle(() => h.root.innerHTML.includes('Add a name'));
  h.input('name', 'Interval'); h.input('prompt', 'Do it'); h.input('kind', 'every'); h.input('timing', 'bad'); h.act('save');
  await settle(() => h.root.innerHTML.includes('Use an interval'));
  assert.equal(h.fixture.calls.filter(c => c.method !== 'GET').length, 0);
});
