import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/chats-view.js', import.meta.url), 'utf8');
const VERSION = 'wizard.chats-view/1';
function harness({ fixture = false, storage = {} } = {}) {
  let paint = 0, removed = 0, callback, host;
  const el = { isConnected: true, classList: { toggle() {} }, replaceChildren() {}, addEventListener() {}, removeEventListener() { removed++; } };
  const w = { id: 'a', app: 'chats', thread: null }, notes = [], sessions = [{ id: 'one', title: 'One' }];
  const s = { URL, URLSearchParams, console, location: { origin: 'https://wizard.invalid', search: fixture ? '?chatsview=fixture' : '' }, localStorage: { getItem: k => storage[k] || null }, document: { currentScript: { src: 'https://wizard.invalid/wizard-os-home/core/chats-view.js' }, createElement: () => ({}), documentElement: {} }, MutationObserver: class { observe() {} disconnect() {} } };
  s.window = s; s.WizLive = { sessions, onChange: fn => { callback = fn; return () => { callback = null; }; }, isNew: () => false };
  s.WosOutbox = {};
  s.WizCore = { chats: H => {
    const render = (state = w) => { if (!H.renderView(state, el, () => render(state), state.thread ? 'thread' : 'list')) paint++; };
    return { render, forget() {}, openChat: (_id, sid) => { w.thread = sid; render(); }, chatsBack: () => { w.thread = null; render(); }, sendChat() {} };
  } };
  vm.runInNewContext(source, s);
  const core = s.WizChatsHost.create({ win: () => w, save() {}, toast: (...args) => notes.push(args) });
  return { api: s.WizChatsHost, core, el, w, notes, sessions, s, get paint() { return paint; }, get removed() { return removed; }, get callback() { return callback; } };
}
const entry = (overrides = {}) => ({ id: 'miguel-chats', name: 'Miguel Chats', source: 'apps.json', url: '/miguel-chats/', provides: ['chats'], chats_view: { contract: VERSION, module: 'view.js' }, ...overrides });
test('default is registered through the contract; default painting changes no DOM', () => {
  const h = harness(); h.core.render(); h.core.render(); assert.equal(h.paint, 2);
  assert.equal(h.api.defaultId(), 'wizard-chats'); assert.equal(h.api.tiles().length, 0);
  assert.throws(() => h.api.register({ id: 'arbitrary', name: 'No', contract: VERSION, mount() {} }), /installed/);
});
test('only explicitly opted-in fixtures exist, never a production launcher entry', () => {
  assert.equal(harness().api.installed().length, 1);
  assert.equal(harness({ fixture: true }).api.installed().length, 3);
  assert.equal(harness({ storage: { 'wos.chatsview.fixture': '1' } }).api.installed().length, 3);
});
test('registry admission rejects cross-origin, escaped paths, launcher links and wrong contracts', () => {
  const h = harness(); assert.equal(h.api.moduleURL(entry()), 'https://wizard.invalid/miguel-chats/view.js');
  for (const a of [entry({ source: 'owner' }), entry({ provides: [] }), entry({ url: '/' }), entry({ chats_view: { contract: VERSION, module: '../evil.js' } }), entry({ chats_view: { contract: VERSION, module: 'https://evil.invalid/evil.js' } }), entry({ chats_view: { contract: 'wrong', module: 'view.js' } })]) assert.equal(h.api.moduleURL(a), null);
});
test('slot default is an installed provider; stale and unknown choices fall back safely', () => {
  const h = harness(); h.api.configure({ apps: [entry()], slots: { chats: { default: 'miguel-chats' } } });
  assert.equal(h.api.defaultId(), 'miguel-chats');
  h.api.configure({ apps: [], parking: [{ slot: 'chats', active: 'miguel-chats' }] });
  assert.equal(h.api.defaultId(), 'wizard-chats'); assert.equal(h.api.installed().length, 1);
});
test('throwing mount falls back to unchanged default with a plain-words provider name', () => {
  const h = harness({ fixture: true }); h.w.chatsProvider = 'chats-throws'; h.core.render();
  assert.equal(h.paint, 1); assert.equal(h.w.chatsProvider, 'wizard-chats');
  assert.match(h.notes[0][1], /Broken Chats \(fixture\).*Showing Chats instead/);
});
test('provider receives same live authority, thread navigation and lifecycle cleanup', () => {
  const h = harness(); let seenHost, updates = 0, unmounts = 0;
  h.api.configure({ apps: [entry()] });
  h.api.register({ contract: VERSION, id: 'miguel-chats', name: 'Miguel', mount: (_el, host) => {
    seenHost = host; host.listen('click', () => {}); host.subscribe(() => {});
    return { update() { updates++; host.renderDefault(); }, unmount() { unmounts++; } };
  } });
  h.w.chatsProvider = 'miguel-chats'; h.core.render();
  assert.equal(seenHost.live, h.s.WizLive); assert.equal(seenHost.outbox, h.s.WosOutbox); assert.equal(seenHost.threads[0], h.sessions[0]);
  seenHost.openThread('one'); assert.equal(h.w.thread, 'one'); seenHost.back(); assert.equal(h.w.thread, null); assert.equal(updates, 3);
  h.core.forget('a'); assert.equal(unmounts, 1); assert.equal(h.callback, null); assert.equal(h.removed, 1);
});
test('fixture uses only the host API, including skin-package banned API rules', () => {
  const text = fs.readFileSync(new URL('../web/core/chats-fixture-view.js', import.meta.url), 'utf8');
  for (const token of ['addEventListener', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch(', 'XMLHttpRequest', '__wos', '__wux', 'localStorage', 'sessionStorage', 'innerHTML', 'outerHTML', 'history.', 'document.cookie', 'eval(', 'new Function', 'import(', 'WebSocket']) assert.ok(!text.includes(token), token);
});
