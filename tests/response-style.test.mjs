import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../web/core/' + p, import.meta.url), 'utf8');
test('response style is an owner setting', async () => {
  const requests = [], saved = { response_style: 'summary' };
  let deny = false, stale = false;
  const box = { console, Intl, Date, URL, location: { href: 'https://fixture.invalid/' }, CustomEvent: class {}, localStorage: { getItem() { return null; }, setItem() {} }, document: { addEventListener() {} }, dispatchEvent() {}, fetch: async (url, init = {}) => {
    requests.push({ url, ...init });
    if (url.endsWith('bootstrap')) return { ok: true, json: async () => ({ bootstrap: 1, settings: saved }) };
    if (init.method === 'PUT') { if (deny) return { ok: false }; if (!stale) Object.assign(saved, JSON.parse(init.body)); }
    return { ok: true, json: async () => ({ settings: { ...saved } }) };
  } };
  box.window = box;
  vm.runInNewContext(read('config.js'), box);
  await box.WizConfig.ready;
  assert.equal(await box.WizConfig.responseStyle(), 'summary');
  assert.equal(await box.WizConfig.responseStyle('concise'), 'concise');
  assert.deepEqual(requests.filter(r => r.method === 'PUT').map(r => JSON.parse(r.body)), [{ response_style: 'concise' }]);
  assert.equal(requests.at(-1).cache, 'no-store');
  deny = true;
  await assert.rejects(box.WizConfig.responseStyle('summary'), /Could not save/);
  assert.equal(box.WizConfig.raw.settings.response_style, 'concise');
  deny = false; stale = true;
  await assert.rejects(box.WizConfig.responseStyle('summary'), /not confirmed/);
  await assert.rejects(box.WizConfig.responseStyle('bad'), /Choose/);
});
test('both shells explain that reply style lives with each agent, with no Wizard-level picker', async () => {
  const box = { console, Map, Set, Date, String, navigator: { userAgent: 'Fixture' }, CSS: { escape: String }, document: { activeElement: null }, WizCore: {}, WizConfig: { responseStyle: async () => { throw Error('retired picker must not load'); } } };
  box.window = box;
  vm.runInNewContext(read('settings.js'), box);
  for (const shell of ['phone', 'desktop']) {
    const root = { innerHTML: '', dataset: {}, scrollTop: 0, classList: { add() {} }, contains: () => false, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
    const view = box.WosSettings.mount(root, { shell });
    view.focus('chats');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(root.innerHTML, /Reply style/);
    assert.match(root.innerHTML, /Each agent keeps its own/);
    assert.doesNotMatch(root.innerHTML, /data-response-style|Summary: context/);
    assert.equal(view.back(), true);
    assert.equal(view.page, '');
    view.destroy();
  }
});
