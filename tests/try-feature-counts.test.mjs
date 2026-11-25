// wizard/try-feature-counts (wizard-app-manager#701): the shell reads the Try new features state of the apps the App
// Manager can't call itself (no owner proof) and posts only {id, issues, tried, vote} to the App Manager's owner route.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { baseURI: 'https://box.example.ts.net:8444/wizard-os-home/', visibilityState: 'visible' };
const { collect } = (await import('../web/tweaks/wizard/try-feature-counts/tweak.js')).default;

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json' }, json: async () => body });

test('reads apps the App Manager could not call and posts only the counts', async () => {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push([url, init]);
    if (url === '/wizard-os-home/store-install/_feature-switches') return res(200, { switches: [], apps: [
      { id: 'notes', ok: false, status: 503 }, { id: 'messenger', ok: true }, { id: 'mail', ok: false }, { id: '../x', ok: false }] });
    if (url === '/notes/api/switches') return res(200, { switches: [{ id: 'a', name: 'Secret', description: 'd', on: true, tried: true, vote: 'up', issues: ['o/r#1'] }] });
    if (url === '/mail/api/switches') return res(404, {});
    if (url === '/mail/api/view/switches') return res(403, { error: 'owner_only' });
    if (url === '/wizard-os-home/store-install/_switch-feedback') return res(200, { on: true, recorded: ['notes'] });
    throw new Error('unexpected ' + url);
  };
  assert.deepEqual(await collect(fetchFn), { apps: 1, status: 200 });
  assert.ok(!calls.some(([u]) => u.startsWith('/messenger/')), 'apps the App Manager reads itself are left to it');
  assert.equal(calls.find(([u]) => u === '/notes/api/switches')[1].headers['X-Wizard-Switch'], '1');
  const [, post] = calls.at(-1);
  assert.equal(post.method, 'POST'); assert.equal(post.headers['X-Wizard-Store'], '1');
  assert.deepEqual(JSON.parse(post.body), { apps: [{ id: 'notes', switches: [{ id: 'a', issues: ['o/r#1'], tried: true, vote: 'up' }] }] });
});

test('nothing to report posts nothing', async () => {
  const calls = [];
  const fetchFn = async url => { calls.push(url); return res(200, { switches: [], apps: [{ id: 'messenger', ok: true }] }); };
  assert.deepEqual(await collect(fetchFn), { apps: 0 });
  assert.equal(calls.length, 1);
});
