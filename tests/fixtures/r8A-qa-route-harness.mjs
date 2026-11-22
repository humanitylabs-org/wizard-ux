// Run a Playwright QA harness in qa/scripts/ (a .cjs) in node:vm against a fake Chromium, far enough to catch the
// request router it installs with context.route('**/*', fn) (wizard-ux issue 1674: tests run the code). No browser
// starts and no server listens: page.goto never settles, so the run stops right after its first routing is set up.
// The real tools/qa-proof-fixture.cjs answers (fx.response), but its failAtExit is recorded instead of installed.
// harnessRoutes(name) -> { origin, routes: [fn...], failAtExit: [arg...], ask(method, url) -> fulfilled answer }.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = new URL('../../', import.meta.url).pathname;
const QA = path.join(ROOT, 'qa/scripts');
const require = createRequire(path.join(QA, 'x.cjs'));
export const fx = require('../../tools/qa-proof-fixture.cjs');

export async function harnessRoutes(name) {
  const src = fs.readFileSync(path.join(QA, name), 'utf8');
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'r8A-qa-'));
  const routes = [], failAtExit = [], logs = [];
  const page = { setDefaultTimeout() {}, on() {}, goto: () => new Promise(() => {}), evaluate: async () => ({}), close: async () => {} };
  const context = { route: async (pattern, fn) => { if (pattern === '**/*') routes.push(fn); }, routeWebSocket: async () => {}, addInitScript: async () => {}, newPage: async () => page, close: async () => {} };
  const chromium = { launch: async () => ({ newContext: async () => context, close: async () => {} }) };
  const server = { listen: (...a) => { const cb = a.find(x => typeof x === 'function'); if (cb) cb(); return server; }, address: () => ({ port: 4321 }), close() {}, on() {} };
  const fakes = {
    '../../tools/qa-playwright.cjs': { chromium, devices: {} },
    '../../tools/qa-proof-fixture.cjs': { ...fx, failAtExit: arg => { failAtExit.push(arg); } },
    'node:http': { ...require('node:http'), createServer: () => server },
  };
  const proc = { argv: ['node', name], env: { QA_MORNING_DIR: tmp, QA_OUT: path.join(tmp, 'out'), TMPDIR: tmp, QA_QUICK: '1' }, exitCode: undefined,
    exit: code => { proc.exitCode = code; }, cwd: () => tmp, on() {}, platform: process.platform };
  const ctx = { require: n => fakes[n] || require(n), process: proc, __dirname: QA, __filename: path.join(QA, name), module: { exports: {} }, console: { log: s => logs.push(s), error: s => logs.push(s), warn() {} },
    Buffer, URL, setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout, setInterval: () => 0, clearInterval() {} };
  vm.runInNewContext(src, ctx, { filename: name });
  for (let i = 0; i < 50 && !routes.length; i++) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 50));
  const origin = name === 'qa-instant-ui-taps.cjs' ? 'http://127.0.0.1:4321' : name === 'qa-offline-popup.cjs' ? fx.ORIGIN : 'https://wizard.test';
  // Ask the first router for one request: the answer it fulfills with, or 'abort'.
  const ask = (method, url) => new Promise((resolve, reject) => {
    const route = { request: () => ({ url: () => url, method: () => method, headers: () => ({}), postData: () => null, resourceType: () => 'fetch' }),
      fulfill: async a => resolve(a), abort: async () => resolve('abort'), continue: async () => resolve('continue'), fallback: async () => resolve('fallback') };
    Promise.resolve(routes[0](route)).catch(reject);
  });
  return { origin, routes, failAtExit, logs, ask, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}
