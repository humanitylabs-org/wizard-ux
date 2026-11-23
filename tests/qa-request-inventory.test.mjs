import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
import { harnessRoutes, fx as rfx } from './fixtures/r8A-qa-route-harness.mjs';
const root = new URL('../', import.meta.url).pathname;
const fx = require('../tools/qa-proof-fixture.cjs');
const { scan } = require('../tools/qa-request-inventory.cjs');
const inventory = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/proof-request-inventory.json'), 'utf8'));
const HARNESSES = ['qa-instant-ui-taps.cjs', 'qa-offline-popup.cjs', 'qa-search-archive-routed.cjs'];
const QA_DIR = path.join(root, 'qa/scripts'); // where the QA harnesses live
// A node run of `code` with the real fixture, then the refused-*.json files it left in `dir` (the run's own output).
const fenceRun = (code, dir, env) => {
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env });
  const files = readdirSync(dir).filter(f => f.startsWith('refused-'));
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, files, refused: files.map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))) };
};

test('every network path in web/ is classified in the committed inventory (and nothing stale)', () => {
 const found = scan(root), known = new Set(Object.keys(inventory.paths));
 const missing = [...found.keys()].filter(p => !known.has(p)).map(p => `${p}  (first seen in ${found.get(p)})`);
 assert.deepEqual(missing, [], 'Uncatalogued request path(s). Add each to tests/fixtures/proof-request-inventory.json as catalogued (with a synthetic response in tools/qa-proof-fixture.cjs) or not-exercised (with a reason).');
 assert.deepEqual([...known].filter(p => !found.has(p)), [], 'Inventory lists a path that no longer appears in web/');
 assert.deepEqual(inventory.harnesses, HARNESSES);
});

test('catalogued paths answer with synthetic data; not-exercised paths are refused', () => {
 fx.resetRefusals();
 let catalogued = 0;
 for (const [p, row] of Object.entries(inventory.paths)) {
  assert.ok(['catalogued', 'not-exercised'].includes(row.status), p);
  if (row.status === 'catalogued') {
   assert.ok(row.examples.length, p); catalogued++;
   for (const { method, path: example } of row.examples) {
    const answer = fx.response(example, method);
    assert.notEqual(answer.status, 451, `${method} ${example} must be catalogued`);
    assert.ok(typeof answer.body === 'string' || Buffer.isBuffer(answer.body));
   }
  } else {
   assert.ok(row.note && row.kind, p);
   const answer = fx.response(p.replaceAll('{}', 'x').replace('/{app}', '/x'), row.kind === 'write-or-stream' ? 'POST' : 'GET');
   assert.equal(answer.status, 451, `${p} is not exercised and must be refused`);
  }
 }
 assert.ok(catalogued >= 30);
 assert.equal(fx.refused().length, Object.values(inventory.paths).filter(r => r.status === 'not-exercised').length);
 fx.resetRefusals();
});

test('unknown requests are refused (451, no data) and ALL of them are collected, not just the first', () => {
 fx.resetRefusals();
 const a = fx.response('/wizard/never/seen-one', 'GET'), b = fx.response('/wizard/v1/ui-preferences/other', 'POST'), c = fx.response('/morning/ready.json', 'DELETE');
 for (const r of [a, b, c]) { assert.equal(r.status, 451); assert.doesNotMatch(r.body, /"data"|"state"/); }
 fx.response('/wizard/never/seen-one', 'GET');
 assert.deepEqual(fx.refused().map(r => [r.request, r.count]), [['DELETE /morning/ready.json', 1], ['GET /wizard/never/seen-one', 2], ['POST /wizard/v1/ui-preferences/other', 1]]);
 assert.equal(fx.response('/wizard/v1/bootstrap', 'GET').status, 200);
 fx.resetRefusals();
});

test('a run with refusals continues, then exits non-zero with the full list and refused-*.json; a clean run exits 0', () => {
 const dir = mkdtempSync(path.join(tmpdir(), 'refused-'));
 try {
  const tenv = { ...process.env, T_FIXTURE: path.join(root, 'tools/qa-proof-fixture.cjs'), T_DIR: dir, QA_OUT: '', QA_REFUSED_DIR: '' };
  const script = body => `const fx=require(process.env.T_FIXTURE);fx.failAtExit(process.env.T_DIR);${body}`;
  const bad = fenceRun(script(`fx.response('/wizard/one','GET');fx.response('/wizard/two','POST');console.log('still running');process.exit(0)`), dir, tenv);
  assert.equal(bad.status, 1); assert.match(bad.stdout, /still running/);
  assert.match(bad.stderr, /REFUSED 2 uncatalogued/); assert.match(bad.stderr, /GET \/wizard\/one/); assert.match(bad.stderr, /POST \/wizard\/two/);
  assert.equal(bad.files.length, 1);
  assert.deepEqual(bad.refused[0].map(r => r.request), ['GET /wizard/one', 'POST /wizard/two']);
  const clean = spawnSync(process.execPath, ['-e', script(`fx.response('/wizard/v1/bootstrap','GET')`)], { encoding: 'utf8', env: tenv });
  assert.equal(clean.status, 0);
  // A harness that already failed keeps its own code.
  const failed = spawnSync(process.execPath, ['-e', script(`process.exitCode=2`)], { encoding: 'utf8', env: tenv });
  assert.equal(failed.status, 2);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Each harness runs in node:vm against a fake Chromium (tests/fixtures/r8A-qa-route-harness.mjs) until its request
// router is installed; then the router itself is asked for paths no fixture knows.
test('all three harnesses use the shared collect-all fence and never answer unknown paths with a silent success', async () => {
 for (const name of HARNESSES) {
  rfx.resetRefusals();
  const h = await harnessRoutes(name);
  try {
   assert.equal(h.failAtExit.length, 1, name + ': installs the collect-all fence once');
   assert.equal(typeof h.failAtExit[0], 'function', name + ': its output folder, resolved at exit');
   assert.match(String(h.failAtExit[0]()), /\/out$/, name + ': the harness default output directory');
   assert.ok(h.routes.length >= 1, name + ': routes every request');
   for (const [method, p] of [['GET', '/totally/unknown'], ['GET', '/wizard/never/seen-r8a'], ['POST', '/wizard/never/seen-r8a']]) {
    const answer = await h.ask(method, h.origin + p);
    assert.ok(answer && typeof answer === 'object' && answer.status >= 400, `${name}: ${method} ${p} is refused, never a silent success (${JSON.stringify(answer)})`);
   }
   if (name === HARNESSES[2]) { // its writes are answered by the fixture itself: a catalogued write as catalogued
    const seen = await h.ask('PUT', h.origin + '/wizard/thread-seen');
    assert.equal(JSON.stringify(seen), JSON.stringify(rfx.response('/wizard/thread-seen', 'PUT')), 'a write gets the fixture\'s answer');
   }
   const refused = rfx.refused().map(r => r.request);
   assert.ok(refused.includes('GET /totally/unknown') && refused.includes('GET /wizard/never/seen-r8a'), `${name}: unknown reads are collected for the exit report: ${refused}`);
  } finally { h.done(); rfx.resetRefusals(); }
 }
});
test('no harness keeps its own uncatalogued handling or a disabled copy', () => {
 for (const name of HARNESSES) assert.doesNotMatch(readFileSync(path.join(QA_DIR, name), 'utf8'), /Uncatalogued/, name);
 assert.doesNotMatch(readFileSync(path.join(QA_DIR, HARNESSES[0]), 'utf8'), /return json\(\{\}\);/);
 assert.ok(!existsSync(path.join(QA_DIR, 'qa-hosted-notes-read.cjs.disabled')));
});

test('refused-*.json lands in the harness default output directory, resolved at exit, and writes are never silent successes', () => {
 const dir = mkdtempSync(path.join(tmpdir(), 'refused-default-'));
 try {
  const cp = fenceRun("const fx=require(process.env.T_FIXTURE);fx.failAtExit(()=>OUT);const OUT=process.env.T_DIR;fx.response('/wizard/x','POST')", dir, { ...process.env, T_FIXTURE: path.join(root, 'tools/qa-proof-fixture.cjs'), T_DIR: dir, QA_OUT: '', QA_REFUSED_DIR: '' });
  assert.equal(cp.status, 1);
  assert.equal(cp.files.length, 1);
 } finally { rmSync(dir, { recursive: true, force: true }); }
 // (each harness hands failAtExit its output folder as a function, read at exit: the harness-routes test runs them)
 const search = readFileSync(path.join(QA_DIR, HARNESSES[2]), 'utf8');
 assert.doesNotMatch(search, /ok: true, record/);
 fx.resetRefusals();
 assert.equal(fx.response('/wizard/thread-seen', 'PUT').status, 200);
 assert.equal(fx.response('/wizard/hermes/api/sessions', 'DELETE').status, 451);
 fx.resetRefusals();
});

test('census retains untracked static fetches and derives literal app reads without prefix/extension exclusions', () => {
 const dir = mkdtempSync(path.join(tmpdir(), 'census-'));
 try {
  mkdirSync(path.join(dir, 'web/core'), { recursive: true });
  writeFileSync(path.join(dir, 'web/ux-version.txt'), 'generated but untracked');
  writeFileSync(path.join(dir, 'web/core/web-update.js'), `fetch(url('ux-version.txt'));fetch('/another-service/api/state');fetch('/wizard-os-home/future.txt');fetch('build.css');api.data.read.app('backup','overview');api.data.read.app('new-app','status');`);
  const found = scan(dir);
  for (const p of ['/wizard-os-home/ux-version.txt', '/another-service/api/state', '/wizard-os-home/future.txt', '/wizard-os-home/build.css', '/backup/api/overview', '/new-app/api/status']) assert.ok(found.has(p), p);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the census finds request targets outside any known API prefix', () => {
 const found = scan(root);
 assert.ok(found.has('/mizel-live/orb-events'), 'orb-handoff endpoint must be discovered');
 assert.ok(inventory.paths['/mizel-live/orb-events']);
 for (const p of ['/wizard-os-home/ux-version.txt', '/backup/api/overview']) {
  assert.ok(found.has(p), p + ' discovered from production request construction');
  assert.equal(inventory.paths[p]?.status, 'catalogued');
 }
});

test('Look file fixture is explicitly absent and its writes remain refused', () => {
 fx.resetRefusals();
 const answer=fx.response('/wizard/v1/pages/wizard-look/look.json','GET');
 assert.equal(answer.status,403);assert.equal(JSON.parse(answer.body).error,'fixture_look_unavailable');
 assert.equal(fx.response('/wizard/v1/pages/wizard-look/look.json','PUT').status,451);
 fx.resetRefusals();
});
