// node --test tests/own-views.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/own-views.js', import.meta.url), 'utf8');
const module = { exports:{} }; vm.runInNewContext(source, { module });
const { own, frameUrl, marker } = module.exports;
const a = { id:'habits', name:'Habits', source:'apps.json', originalUrl:'/habits/', url:'/wizard/views/habits/', view:{ mode:'own', url:'/wizard/views/habits/' } };
test('own version supersedes original and persisted original URLs, but preserves navigation inside own version', () => {
  assert.equal(own(a), true);
  assert.equal(frameUrl(a), a.view.url);
  assert.equal(frameUrl(a, '/habits/old'), a.view.url);
  assert.equal(frameUrl(a, '/wizard/views/habits/nested'), '/wizard/views/habits/nested');
});
test('reverted and overlay screens use original and remove persisted own-view URLs', () => {
  for (const mode of ['original', 'overlay']) {
    const original = { ...a, url:'/habits/', view:{ mode, url:'/habits/' } };
    assert.equal(frameUrl(original), '/habits/');
    assert.equal(frameUrl(original, '/wizard/views/habits/'), '/habits/');
    assert.equal(marker(original), '');
  }
});
test('only the exact installed view path can show Your version, never a launcher hint or foreign path', () => {
  for (const change of [{ source:'launcher.json' }, { view:{ mode:'own', url:'https://other.test/' } }, { view:{ mode:'own', url:'/wizard/views/another/' } }]) assert.equal(own({ ...a, ...change }), false);
  assert.match(marker(a), /Your version/);
  assert.match(marker(a), /data-own-original="habits"/);
});
async function harness(active = false) {
  const entries = [{ ...a, view:{ ...a.view } }], calls = [], clicks = [], events = new Map(), features = [];
  let registryCalls = 0;
  const win = { WosSettings:{ register:f => features.push(f), refresh() {} }, WizCore:{
    apps:() => { registryCalls++; return { APPS:entries }; }, deeplink:{ route:u => clicks.push(u) },
    refreshApps:async () => { entries[0] = { ...a, url:a.originalUrl, view:{ mode:'original', url:a.originalUrl } }; },
  } };
  win.top = win;
  const document = { currentScript:{ src:'https://box.test/wizard-os-home/core/own-views.js' }, readyState:'loading',
    querySelectorAll:() => [], addEventListener:(name, fn) => events.set('doc:' + name, fn) };
  vm.runInNewContext(source, { window:win, document, URL, location:{ origin:'https://box.test', pathname:'/wizard-os-home/' },
    addEventListener:(name, fn) => events.set(name, fn), clearTimeout, setTimeout,
    fetch:async (url, init = {}) => { calls.push({ url, ...init }); return { ok:true, json:async () => ({ active }) }; } });
  const click = (attr, id, trusted = true) => {
    const button = { dataset:{ [attr]:id }, hasAttribute:key => key === 'data-' + attr.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) };
    events.get('doc:click')({ target:{ closest:() => button }, isTrusted:trusted, view:win, stopImmediatePropagation() {}, preventDefault() {} });
  };
  return { calls, features, click, events, registryCalls:() => registryCalls, clicks };
}
const tick = () => new Promise(r => setTimeout(r, 0));
test('real shell confirmation uses owner listener, reads active and registry back; registries are cached', async () => {
  const h = await harness(); h.click('ownOriginal', 'habits');
  assert.equal(h.calls.length, 0); assert.match(h.clicks[0], /view=own-views/);
  h.click('ownConfirm', 'habits'); await tick(); await tick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, 'https://box.test/wizard-os-home/store-install/_views/habits');
  assert.equal(h.calls[0].method, 'POST'); assert.equal(h.calls[0].headers['X-Wizard-Store'], '1');
  assert.deepEqual(JSON.parse(h.calls[0].body), { action:'revert' });
  assert.match(h.features[0].html(), /Using the original screen/);
  h.events.get('wizard:apps')(); assert.equal(h.registryCalls(), 2);
});
test('unconfirmed readback keeps owner selection and never reports success', async () => {
  const h = await harness(true); h.click('ownOriginal', 'habits'); h.click('ownConfirm', 'habits'); await tick();
  assert.match(h.features[0].html(), /hasn’t confirmed/);
  assert.doesNotMatch(h.features[0].html(), /Using the original screen/);
});
test('synthetic shell clicks and app messages cannot authorize revert', async () => {
  const h = await harness(); h.click('ownOriginal', 'habits', false); h.click('ownConfirm', 'habits', false);
  h.events.get('message')({ origin:'https://box.test', data:{ type:'wizard:own-view:revert', app:'habits' } });
  await tick(); assert.equal(h.calls.length, 0);
});

test('both renderers use the same frame and marker helpers without a new history/Back stack', () => {
  for (const path of ['web/app.js', 'web/desktop/desktop.js']) {
    const text = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    assert.match(text, /WosOwnViews\?\.frameUrl/); assert.match(text, /WosOwnViews\?\.marker/);
    assert.match(text, /data-own-app=/);
  }
  assert.doesNotMatch(source, /history\.(?:pushState|replaceState|back)/);
  assert.match(source, /!e\.isTrusted/);
  assert.match(source, /e\.view !== window/);
  assert.match(source, /check\.json\(\)\)\.active !== false/);
});
