import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url).pathname;
const fx = require('../tools/qa-proof-fixture.cjs');
const { scan } = require('../tools/qa-request-inventory.cjs');
const inventory = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/proof-request-inventory.json'), 'utf8'));
const HARNESSES = ['qa-instant-ui-taps.cjs', 'qa-offline-popup.cjs', 'qa-search-archive-routed.cjs'];

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
  const bad = spawnSync(process.execPath, ['-e', script(`fx.response('/wizard/one','GET');fx.response('/wizard/two','POST');console.log('still running');process.exit(0)`)], { encoding: 'utf8', env: tenv });
  assert.equal(bad.status, 1); assert.match(bad.stdout, /still running/);
  assert.match(bad.stderr, /REFUSED 2 uncatalogued/); assert.match(bad.stderr, /GET \/wizard\/one/); assert.match(bad.stderr, /POST \/wizard\/two/);
  const file = readdirSync(dir).find(f => f.startsWith('refused-'));
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, file), 'utf8')).map(r => r.request), ['GET /wizard/one', 'POST /wizard/two']);
  const clean = spawnSync(process.execPath, ['-e', script(`fx.response('/wizard/v1/bootstrap','GET')`)], { encoding: 'utf8', env: tenv });
  assert.equal(clean.status, 0);
  // A harness that already failed keeps its own code.
  const failed = spawnSync(process.execPath, ['-e', script(`process.exitCode=2`)], { encoding: 'utf8', env: tenv });
  assert.equal(failed.status, 2);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('all three harnesses use the shared collect-all fence and never answer unknown paths with a silent success', () => {
 for (const name of HARNESSES) {
  const src = readFileSync(path.join(root, name), 'utf8');
  assert.match(src, /fx\.failAtExit\(/, name);
  assert.doesNotMatch(src, /Uncatalogued/, name);
 }
 const instant = readFileSync(path.join(root, HARNESSES[0]), 'utf8');
 assert.doesNotMatch(instant, /return json\(\{\}\);/);
 assert.ok(!existsSync(path.join(root, 'qa-hosted-notes-read.cjs.disabled')));
});

test('refused-*.json lands in the harness default output directory, resolved at exit, and writes are never silent successes', () => {
 const dir = mkdtempSync(path.join(tmpdir(), 'refused-default-'));
 try {
  const cp = spawnSync(process.execPath, ['-e', "const fx=require(process.env.T_FIXTURE);fx.failAtExit(()=>OUT);const OUT=process.env.T_DIR;fx.response('/wizard/x','POST')"], { encoding: 'utf8', env: { ...process.env, T_FIXTURE: path.join(root, 'tools/qa-proof-fixture.cjs'), T_DIR: dir, QA_OUT: '', QA_REFUSED_DIR: '' } });
  assert.equal(cp.status, 1);
  assert.equal(readdirSync(dir).filter(f => f.startsWith('refused-')).length, 1);
 } finally { rmSync(dir, { recursive: true, force: true }); }
 for (const name of HARNESSES) assert.match(readFileSync(path.join(root, name), 'utf8'), /failAtExit\(\(\) => (?:out|OUT)\)/, name);
 const search = readFileSync(path.join(root, HARNESSES[2]), 'utf8');
 assert.doesNotMatch(search, /ok: true, record/);
 assert.match(search, /writes\.push\(\{ method, path: u\.pathname \}\); return route\.fulfill\(fx\.response\(u\.pathname, method\)\)/);
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
