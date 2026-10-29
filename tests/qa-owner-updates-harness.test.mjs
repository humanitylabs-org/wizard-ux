import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../tools/qa-owner-app-updates-shell.cjs', import.meta.url), 'utf8');

async function run({ failNavigation = false, baseline = true } = {}) {
  const writes = new Map(), clicks = [], closed = [], errors = [], timers = new Set();
  const locator = selector => ({
    first() { return this; }, async waitFor() {}, async innerText() { return 'About & updates'; },
    async count() { return 0; }, async click() { clicks.push(selector); },
  });
  const page = { on() {}, setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
    async goto() { if (failNavigation) throw Error('navigation failed'); },
    async waitForFunction() {}, locator, async screenshot() {}, isClosed() { return false; }, async content() { return '<html>failure</html>'; },
  };
  const browser = { async newContext() { return { async route() {}, async addInitScript() {}, async newPage() { return page; }, async close() { closed.push('context'); } }; }, async close() { closed.push('browser'); } };
  const fakeFs = { mkdirSync() {}, readdirSync() { return []; }, writeFileSync(p, body) { writes.set(p, body); } };
  const process = { env: baseline ? { QA_BASELINE: '1' } : {}, exitCode: 0 };
  await vm.runInNewContext(source, {
    require(name) { if (name === 'fs') return fakeFs; if (name === './qa-playwright.cjs') return { chromium: { async launch() { return browser; } } }; return requireBuiltin(name); },
    __dirname: '/fixture/tools', process, console: { log() {}, error(e) { errors.push(String(e)); } },
    setTimeout(fn) { const id = {}; timers.add(id); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  return { writes, clicks, closed, errors, process, timers };
}
// No arbitrary module loading from the evaluated harness.
import path from 'node:path';
import crypto from 'node:crypto';
function requireBuiltin(name) { if (name === 'path') return path; if (name === 'crypto') return crypto; throw Error(`Unexpected dependency ${name}`); }

test('baseline records scoped request state for all four profiles', async () => {
  const r = await run();
  assert.equal(r.process.exitCode, 0, r.errors.join('\n'));
  const result = JSON.parse([...r.writes.values()].find(s => String(s).includes('web_sha256')));
  assert.equal(result.rows.length, 4);
  for (const row of result.rows) assert.deepEqual(row.calls, []);
  assert.equal(r.closed.filter(x => x === 'context').length, 4);
  assert.equal(r.closed.at(-1), 'browser');
  assert.equal(r.timers.size, 0);
});
test('each profile uses actual Settings category clicks, not dispatched events', async () => {
  const r = await run();
  assert.deepEqual(r.clicks, Array(4).fill('[data-st-page="about"]'));
  assert.doesNotMatch(source, /dispatchEvent|force:\s*true/);
});
test('navigation failure preserves diagnostic and closes context and browser', async () => {
  const r = await run({ failNavigation: true });
  assert.equal(r.process.exitCode, 1);
  assert.deepEqual(r.closed, ['context', 'browser']);
  assert.equal(r.timers.size, 0);
  assert.ok([...r.writes.keys()].some(p => p.endsWith('-failure.json')));
});
