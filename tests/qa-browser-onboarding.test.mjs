import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const seedOnboarding = createRequire(import.meta.url)('../tools/qa-browser-onboarding.cjs');

async function fixture() {
  const scripts = [], routes = new Map(), frame = {}, report = {};
  const page = { addInitScript: async fn => scripts.push(fn), route: async (pattern, handler) => routes.set(pattern, handler), mainFrame: () => frame };
  await seedOnboarding(page, 'synthetic-token', report);
  return { scripts, routes, frame, report };
}

test('onboarding init seeds every new top-level document, not opaque app storage', async () => {
  const { scripts } = await fixture();
  assert.equal(scripts.length, 1);
  for (const reload of [false, true]) {
    const storage = new Map(), window = {};
    window.top = window;
    vm.runInNewContext(`(${scripts[0].toString()})()`, { window, localStorage: { setItem: (k, v) => storage.set(k, v) } });
    assert.equal(storage.get('wos.welcome.v1'), 'done', `navigation reload=${reload}`);
    const opaqueStorage = new Map();
    vm.runInNewContext(`(${scripts[0].toString()})()`, { window: { top: window }, localStorage: { setItem: (k, v) => opaqueStorage.set(k, v) } });
    assert.equal(opaqueStorage.size, 0);
  }
});

test('onboarding fixtures are only token-bearing top-level GETs, including after reload', async () => {
  const { routes, frame, report } = await fixture();
  for (const pathname of ['/wizard/hermes/api/model/options', '/wizard/v1/setup']) {
    const handler = routes.get('**' + pathname);
    assert.equal(typeof handler, 'function');
    for (const [requestFrame, method, headers, allowed] of [
      [frame, 'GET', { 'x-wizard-shell-token': 'synthetic-token' }, true],
      [frame, 'GET', { 'x-wizard-shell-token': 'synthetic-token' }, true],
      [{}, 'GET', { 'x-wizard-shell-token': 'synthetic-token' }, false],
      [frame, 'GET', {}, false], [frame, 'GET', { 'x-wizard-shell-token': 'wrong' }, false],
      [frame, 'POST', { 'x-wizard-shell-token': 'synthetic-token' }, false],
    ]) {
      let continued = false, response;
      await handler({ request: () => ({ frame: () => requestFrame, method: () => method, headers: () => headers }), continue: async () => { continued = true; }, fulfill: async r => { response = r; } });
      assert.equal(continued, !allowed);
      assert.equal(!!response, allowed);
      if (allowed) {
        assert.equal(response.status, 200);
        const body = JSON.parse(response.body);
        if (pathname.endsWith('/model/options')) assert.equal(body.providers[0].authenticated, true);
        else assert.equal(body.first_run, false);
      }
    }
  }
  assert.deepEqual(report.onboardingFixture, { providerReads: 2, setupReads: 2 });
});
