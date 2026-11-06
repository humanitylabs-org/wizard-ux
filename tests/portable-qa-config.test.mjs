import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const resolver = readFileSync(new URL('../tools/qa-playwright.cjs', import.meta.url), 'utf8');
function resolve(env, modules) {
  const requests = [], module = { exports: {} };
  vm.runInNewContext(resolver, { process: { env }, module, require(name) {
    requests.push(name);
    if (modules[name]) {
      if (modules[name] instanceof Error) throw modules[name];
      return modules[name];
    }
    throw Object.assign(new Error(`Cannot find module '${name}'`), { code: 'MODULE_NOT_FOUND' });
  } });
  return { result: module.exports, requests };
}
test('shared Playwright resolver prefers explicit override, then playwright, then core', () => {
  const preferred = { chromium: 'preferred' }, fallback = { chromium: 'core' };
  const modules = { playwright: preferred, 'playwright-core': fallback, custom: preferred };
  assert.equal(resolve({ QA_PLAYWRIGHT: 'custom', PW: 'unused' }, modules).result, preferred);
  assert.deepEqual(resolve({}, modules).requests, ['playwright']);
  assert.equal(resolve({}, { 'playwright-core': fallback }).result, fallback);
  for (const alias of ['PLAYWRIGHT_PATH', 'PW', 'PW_MODULE', 'PLAYWRIGHT_MODULE', 'PLAYWRIGHT_DIR', 'QA_PW']) {
    assert.equal(resolve({ [alias]: 'custom' }, modules).result, preferred);
  }
});
test('Playwright resolver errors are actionable and never mask broken explicit installs', () => {
  assert.throws(() => resolve({}, {}), /npm install --no-save playwright/);
  assert.throws(() => resolve({ QA_PLAYWRIGHT: 'missing' }, { playwright: {} }), /Cannot load QA_PLAYWRIGHT/);
  const error = Object.assign(new Error("Cannot find module 'missing-transitive-dependency'"), { code: 'MODULE_NOT_FOUND' });
  assert.throws(() => resolve({}, { playwright: error, 'playwright-core': {} }), /missing-transitive-dependency/);
});
test('portable work roots create directories, reject sibling paths and preserve origin ports', () => {
  const tools = require('../tools/qa-paths.cjs');
  const temp = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'portable-paths-'));
  const saved = { ...process.env };
  try {
    process.env.WIZARD_WORK_ROOT = path.join(temp, 'work space');
    assert.equal(tools.workRoot(), process.env.WIZARD_WORK_ROOT);
    assert.equal(tools.workPath('qa', 'result.json'), path.join(process.env.WIZARD_WORK_ROOT, 'qa', 'result.json'));
    assert.ok(tools.inWorkRoot(tools.workPath('qa')));
    assert.equal(tools.inWorkRoot(process.env.WIZARD_WORK_ROOT + '-sibling'), false);
    delete process.env.WIZARD_BUILD_HOST;
    assert.throws(() => tools.buildHost(), /Set WIZARD_BUILD_HOST/);
    process.env.WIZARD_BUILD_HOST = 'user@worker.example';
    assert.equal(tools.buildHost(), 'user@worker.example');
    process.env.WIZARD_BUILD_HOST = '-oProxyCommand=unsafe';
    assert.throws(() => tools.buildHost(), /SSH host/);
    process.env.WIZARD_ORIGIN = 'http://127.0.0.1:19371/';
    assert.equal(tools.origin(), 'http://127.0.0.1:19371');
    delete process.env.WIZARD_ORIGIN;
    assert.equal(tools.origin(), 'http://127.0.0.1:9371');
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
    rmSync(temp, { recursive: true, force: true });
  }
});
test('server keeps local origins and admits only configured comma-separated remote origins', () => {
  const server = new URL('../server.py', import.meta.url).pathname;
  const code = `import runpy,json,os
os.environ['WIZARD_OS_HOME_PORT']='19271'
a=runpy.run_path(${JSON.stringify(server)})['ALLOWED_ORIGINS']
assert a=={'http://127.0.0.1:19271','http://localhost:19271','https://wizard.example.ts.net','https://preview.example.ts.net'}
os.environ.pop('WIZARD_ORIGIN')
a=runpy.run_path(${JSON.stringify(server)})['ALLOWED_ORIGINS']
assert a=={'http://127.0.0.1:19271','http://localhost:19271'}
print('allowed origins verified')`;
  const result = spawnSync('python3', ['-c', code], { encoding: 'utf8', env: { ...process.env, WIZARD_ORIGIN: ' https://wizard.example.ts.net/ , , https://preview.example.ts.net ' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
