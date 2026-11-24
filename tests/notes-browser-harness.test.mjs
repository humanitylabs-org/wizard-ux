import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { runNotesSigil } from './fixtures/q2-notes-sigil-run.mjs';
const { assertReadOnlyFixture } = createRequire(import.meta.url)('./notes-fixture-write-policy.cjs');
const read = p => withShellParts(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('Notes browser entry matches the production Alt+KeyO apps shortcut', () => {
  // the production key line, run: Alt+O (no Shift) opens the apps picker once per press
  const keys = readFileSync(new URL('../web/desktop/desktop-pickany.js', import.meta.url), 'utf8');
  const i = keys.indexOf("    if (alt && !shift && code === 'KeyO')"), line = keys.slice(i, keys.indexOf('\n', i));
  const opened = [], key = vm.runInNewContext(`(alt, shift, code, e) => { ${line} return 'none'; }`, { hit: f => (f(), true), palToggle: k => opened.push(k) });
  assert.equal(key(true, false, 'KeyO', {}), true); assert.deepEqual(opened, ['apps']);
  assert.equal(key(true, true, 'KeyO', {}), 'none', 'Alt+Shift+O is something else');
  key(true, false, 'KeyO', { repeat: true }); assert.deepEqual(opened, ['apps'], 'a held key opens it once');
  // the browser harness presses that same key: the real canary, run against a fake Chromium
  const harness = read('./qa-notes-sigil.cjs');
  assert.doesNotMatch(harness, /keyboard\.press\('(?:Control|Meta)\+o'\)/);
});

test('Notes fixture permits only refused exact shell bootstrap attempts', () => {
  const refused = (method, path) => ({ method, path, status:405, refusedBeforeHandlers:true });
  const allowed = [refused('POST','/wizard/v1/ui-preferences/seed'), refused('PUT','/wizard/thread-seen')];
  const result = assertReadOnlyFixture([{method:'GET',path:'/notes/api/tree'}, ...allowed]);
  assert.equal(result.attempted.length,2);
  assert.equal(result.acceptedMutations.length,0);
  assert.equal(result.refusedShellBootstrap.length,2);
  for (const row of [
    refused('POST','/notes/api/tree'), refused('POST','/unknown'),
    refused('POST','/wizard/v1/ui-preferences/seed/'),
    refused('DELETE','/wizard/thread-seen'),
    {...allowed[0],status:200}, {...allowed[1],status:204},
    {...allowed[0],refusedBeforeHandlers:false},
    {method:'POST',path:'/wizard/v1/ui-preferences/seed'},
  ]) assert.throws(() => assertReadOnlyFixture([row]));
});

test('the canary presses the production Alt+O on the desktop and waits for the real palette and its Notes tile', async () => {
  const stopped = await runNotesSigil({ stopAtPalette: true });
  assert.deepEqual(stopped.presses, [['desktop', 'Alt+o']], 'the desktop picker opens with the production key; the phone uses its sheet');
  assert.deepEqual(stopped.locators.at(-1), ['#palette:not([hidden])'], 'then it waits for the open palette');
  assert.notEqual(stopped.exitCode, 0, 'a palette that never opens is no pass');
  const run = await runNotesSigil();
  assert.equal(run.exitCode, undefined, run.errors.join('\n'));
  assert.ok(run.locators.some(l => l[0] === 'filter' && l[1] === '#palette:not([hidden]) .pal-app' && l[2] === '.nm' && l[3] === '/^Notes$/'), 'the Notes tile by its exact name');
  assert.deepEqual(run.contexts.map(c => c.version + ' ' + c.shell), ['candidate phone', 'candidate desktop']);
  assert.equal(run.report.cases.length, 6, 'picker + Notes view, both skins, both shells');
});

test('with a baseline the canary runs the old sigils.js too and must find the old opaque logo there', async () => {
  const run = await runNotesSigil({ baseline: true });
  assert.equal(run.exitCode, undefined, run.errors.join('\n'));
  assert.deepEqual(run.contexts.map(c => c.version + ' ' + c.shell), ['candidate phone', 'candidate desktop', 'baseline phone', 'baseline desktop']);
  const sig = run.served.filter(x => x.path === '/wizard-os-home/core/sigils.js').map(x => x.body === '/* baseline sigils */');
  assert.deepEqual(sig.slice(0, 4), [false, false, true, true], 'the baseline contexts get the baseline sigils.js from the fixture server');
  assert.equal(run.report.cases.length, 12, 'the full matrix twice');
  const legacy = await runNotesSigil({ legacy: true });
  assert.equal(legacy.exitCode, 1, 'a candidate still painting the opaque logo fails'); assert.match(legacy.errors.join(' '), /failures|mask/);
});

test('the canary refuses writes before handlers and fails on any other write or a page error', async () => {
  const seed = await runNotesSigil({ writes: [['POST', '/wizard/v1/ui-preferences/seed']] });
  assert.equal(seed.exitCode, undefined, seed.errors.join('\n'));
  const posts = seed.served.filter(x => x.method === 'POST');
  assert.ok(posts.length >= 2 && posts.every(x => x.status === 405), 'every write is refused');
  assert.equal(seed.report.writePolicy.refusedShellBootstrap.length, posts.length, 'recorded as refused shell bootstrap attempts');
  const boot = await runNotesSigil({ writes: [['POST', '/wizard/v1/bootstrap']] });
  assert.equal(boot.exitCode, 1); assert.equal(boot.served.find(x => x.method === 'POST').status, 405, 'a write to a GET route is refused, not answered');
  const write = await runNotesSigil({ writes: [['POST', '/notes/api/tree']] });
  assert.equal(write.exitCode, 1); assert.match(write.errors.join(' '), /only exact refused shell bootstrap attempts/);
  const err = await runNotesSigil({ pageError: true });
  assert.equal(err.exitCode, 1); assert.match(err.errors.join(' '), /no browser page errors/);
});
