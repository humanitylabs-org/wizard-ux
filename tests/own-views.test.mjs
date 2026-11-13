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

// Browser boundary (wizard-os#133): a sandboxed own screen can't be read and speaks from origin `null`.
function frameHarness({ boundary = true, sandbox = 'allow-scripts allow-forms allow-downloads', api = '/habits/api/' } = {}) {
  const events = new Map(), frameOn = {}, timers = new Map(), clock = { t: 1000 };
  const entries = [{ ...a, view:{ ...a.view, ...(api ? { api } : {}) } }];
  const win = { WosSettings:{ register() {}, refresh() {} }, WizCore:{ apps:() => ({ APPS:entries }), deeplink:{ route() {} } } };
  win.top = win; if (boundary) win.WizBrowserBoundary = { enabled:true };
  const child = {}, note = [], srcSets = [];
  const host = { querySelector:() => null };
  const frame = { dataset:{ ownApp:'habits' }, isConnected:true, contentWindow:child, attrs:{ src:'/wizard/views/habits/', ...(sandbox ? { sandbox } : {}) },
    getAttribute(k) { return this.attrs[k] ?? null; }, hasAttribute(k) { return k in this.attrs; },
    get src() { return this.attrs.src; }, set src(v) { srcSets.push(v); this.attrs.src = v; },
    get contentDocument() { throw new Error('SecurityError'); },
    addEventListener:(t, fn) => { frameOn[t] = fn; }, removeEventListener:(t, fn) => { if (frameOn[t] === fn) delete frameOn[t]; },
    closest:() => host, parentElement:{ insertBefore:p => note.push(p.textContent) } };
  const document = { currentScript:{ src:'https://box.test/wizard-os-home/core/own-views.js' }, readyState:'complete', body:{},
    querySelectorAll:q => (q === 'iframe[data-own-app]' ? [frame] : []), addEventListener() {}, createElement:() => ({ setAttribute() {} }) };
  class MutationObserver { observe() {} }
  let tid = 0;
  vm.runInNewContext(source, { window:win, document, URL, MutationObserver, location:{ origin:'https://box.test', href:'https://box.test/wizard-os-home/', pathname:'/wizard-os-home/' },
    addEventListener:(name, fn) => events.set(name, fn), performance:{ timeOrigin:0, now:() => clock.t },
    setTimeout:fn => { timers.set(++tid, fn); return tid; }, clearTimeout:id => timers.delete(id),
    fetch:async () => ({ ok:true, headers:{ get:() => 'text/html' } }) });
  return { frame, child, note, srcSets, clock, entries, apps:() => events.get('wizard:apps')(),
    expire:() => { const fns = [...timers.values()]; timers.clear(); fns.forEach(fn => fn()); },
    load:() => frameOn.load(), message:(origin, type, at, source = child) => events.get('message')({ origin, source, data:{ type, file:'app.js', ...(at !== undefined ? { at } : {}) } }) };
}
test('boundary on: a sandboxed own screen is not read on load; its null-origin ready and error messages count', async () => {
  const h = frameHarness(); await tick();
  h.load(); assert.equal(h.frame.src, '/wizard/views/habits/', 'an unreadable document is not a failure');
  h.message('null', 'wizard:own-view:ready', 900, {}); assert.equal(h.frame.dataset.ownReady, undefined, 'another window: ignored');
  h.message('null', 'wizard:own-view:ready', 900); assert.equal(h.frame.dataset.ownReady, 'true');
  h.expire(); assert.equal(h.frame.src, '/wizard/views/habits/', 'ready: no fallback');
  const e = frameHarness(); await tick();
  e.message('null', 'wizard:own-view:error', 900); assert.equal(e.frame.src, '/habits/'); assert.match(e.note[0], /couldn’t load app\.js/);
});
test('boundary on: every later document is proved again; an earlier document\'s ready does not count (Codex P2)', async () => {
  // A reload that lands on an error page (no boot script): no new ready, so the watchdog falls back.
  const h = frameHarness(); await tick();
  h.message('null', 'wizard:own-view:ready', 900); h.load();
  h.clock.t = 5000; h.load(); assert.equal(h.frame.dataset.ownReady, undefined, 'readiness reset');
  h.message('null', 'wizard:own-view:ready', 900); assert.equal(h.frame.dataset.ownReady, undefined, 'a stale ready is ignored');
  h.expire(); assert.equal(h.frame.src, '/habits/');
  // A reload whose new document says ready, before or after its load event: it stays.
  for (const early of [true, false]) {
    const r = frameHarness(); await tick();
    r.message('null', 'wizard:own-view:ready', 900); r.load();
    r.clock.t = 5000;
    if (early) r.message('null', 'wizard:own-view:ready', 3000);
    r.load();
    if (!early) r.message('null', 'wizard:own-view:ready', 3000);
    assert.equal(r.frame.dataset.ownReady, 'true', 'early ' + early);
    r.expire(); assert.equal(r.frame.src, '/wizard/views/habits/', 'early ' + early);
  }
});
test('boundary on: an API folder that arrives later (cached app list) loads the sandboxed own screen again (Codex P1)', async () => {
  const h = frameHarness({ api:'' }); await tick();
  h.apps(); assert.deepEqual(h.srcSets, [], 'nothing changed: no reload');
  h.entries[0] = { ...h.entries[0], view:{ ...h.entries[0].view, api:'/habits/api/' } };
  h.apps(); assert.deepEqual(h.srcSets, ['/wizard/views/habits/']);
  h.apps(); assert.equal(h.srcSets.length, 1, 'once');
  const same = frameHarness({ api:'', sandbox:'' }); await tick();
  same.entries[0] = { ...same.entries[0], view:{ ...same.entries[0].view, api:'/habits/api/' } };
  same.apps(); assert.deepEqual(same.srcSets, [], 'a same-origin own screen keeps its 307');
});
test('boundary off or a same-origin frame: a null-origin message is ignored and an unreadable document falls back', async () => {
  for (const opts of [{ boundary:false }, { sandbox:'' }, { sandbox:'allow-scripts allow-same-origin' }]) {
    const h = frameHarness(opts); await tick();
    h.message('null', 'wizard:own-view:ready', 900); assert.equal(h.frame.dataset.ownReady, undefined, JSON.stringify(opts));
    h.message('null', 'wizard:own-view:error', 900); assert.equal(h.frame.src, '/wizard/views/habits/', JSON.stringify(opts));
    h.load(); assert.equal(h.frame.src, '/habits/', JSON.stringify(opts));
  }
});
