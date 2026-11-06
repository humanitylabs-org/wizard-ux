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
  const h = harness();
  const text = fs.readFileSync(new URL('../web/core/chats-fixture-view.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => h.api.lint(text));
  for (const token of ['addEventListener', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch(', 'XMLHttpRequest', '__wos', '__wux', 'localStorage', 'sessionStorage', 'innerHTML', 'outerHTML', 'history.', 'document.cookie', 'eval(', 'new Function', 'import(', 'WebSocket']) assert.ok(!text.includes(token), token);
  for (const bad of ['fetch("/secret")', 'import x from "./child.js"', 'import ("/child.js")', 'window.__wos.reset()']) assert.throws(() => h.api.lint(bad), /banned|import/);
});

function surfaceFixture() {
  const h = harness(); let live = true, paints = 0, moves = 0;
  function node() {
    return { dataset: {}, children: [], parentNode: null, parts: new Map(),
      get parentElement() { return this.parentNode; },
      contains(n) { return this === n || this.children.some(c => c.contains(n)); },
      appendChild(n) {
        moves++; if (n.parentNode) n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1);
        if (n.contains(h.s.document.activeElement)) h.s.document.activeElement = null;
        this.children.push(n); n.parentNode = this; return n;
      },
      querySelector(selector) { return this.parts.get(selector) || null; },
      querySelectorAll(selector) { return this.children.flatMap(c => [...(selector === '*' || c.dataset.chats ? [c] : []), ...c.querySelectorAll(selector)]); },
    };
  }
  h.s.document.createElement = node;
  const stage = node(), first = node(), second = node(), outside = node(); stage.appendChild(first); stage.appendChild(second);
  const core = h.api.create({ win: id => live && id === h.w.id ? h.w : null, root: () => stage });
  core.renderChats = () => paints++;
  return { ...h, core, stage, first, second, outside, node, get paints() { return paints; }, get moves() { return moves; }, close: () => { live = false; } };
}
test('Chats mounts create once, retain identity and focus/read/composer state in another supplied slot', () => {
  const h = surfaceFixture(), s = h.core.surface('a');
  assert.ok(Object.isFrozen(s)); assert.equal(s.root, null); assert.equal(h.core.surface('missing'), null);
  const root = s.mount(h.first); assert.equal(s.root, root); assert.equal(s.slot, h.first); assert.equal(root.dataset.chats, 'a'); assert.equal(h.paints, 1);
  const field = h.node(); field.value = 'unsent draft'; field.selectionStart = 3; field.scrollTop = 19;
  field.setSelectionRange = (start, end) => { field.selectionStart = start; field.selectionEnd = end; };
  field.focus = () => { h.s.document.activeElement = field; }; root.appendChild(field); field.focus(); root.scrollTop = 91;
  const moves = h.moves; assert.equal(s.mount(h.first), root); assert.equal(h.moves, moves, 'same slot is a no-op');
  assert.equal(s.mount(h.second), root); assert.equal(s.root, root); assert.equal(s.slot, h.second);
  assert.equal(h.s.document.activeElement, field); assert.equal(field.value, 'unsent draft'); assert.equal(field.selectionStart, 3); assert.equal(field.scrollTop, 19); assert.equal(root.scrollTop, 91);
  assert.equal(h.paints, 1, 'adopting a retained body never rerenders its provider');
  assert.equal(s.mount(root), null, 'cannot mount a body inside itself'); assert.equal(s.mount(field), null, 'cannot mount into its own descendant');
  assert.equal(s.mount(h.outside), null, 'event-root escape refused'); assert.equal(s.mount(null), null);
  h.close(); assert.equal(s.root, null); assert.equal(s.mount(h.first), null); assert.equal(h.core.surface('a'), null);
});
test('Chats exposes live owned parts only; notification actions share one placement implementation', () => {
  const h = surfaceFixture(), s = h.core.surface('a'), root = s.mount(h.first);
  const composer = h.node(), thread = h.node(), route = h.node(), acts = h.node(), title = { textContent: 'Review this' }, button = h.node();
  root.parts.set('.ch-compose', composer); root.parts.set('.ch-thread.ch-notif-thread', thread);
  root.parts.set('.ch-thread.ch-notif-thread .ch-head .ti b', title); root.parts.set('[data-notify-menu]', button); root.parts.set('[data-chact="done"]', button);
  thread.parts.set('.ch-notif-route', route); thread.parts.set('.ch-tacts', acts); route.parentNode = thread;
  let quiet = true; route.classList = { contains: () => quiet };
  acts.insertBefore = n => { n.parentNode = acts; };
  assert.equal(s.composer, composer); assert.equal(s.notification, thread); assert.equal(s.notificationTitle, 'Review this'); assert.equal(s.routeButton, button);
  assert.equal(s.action('done'), button); assert.equal(s.action('unknown'), null); assert.equal(s.action('done"] *'), null);
  assert.equal(s.placeNotificationRoute(), false, 'quiet route stays under notification'); quiet = false;
  assert.equal(s.placeNotificationRoute(), true); assert.equal(route.parentNode, acts); assert.equal(s.placeNotificationRoute(), false, 'no re-entrant mutation echo');
  root.parts.set('.ch-compose', button); assert.equal(s.composer, button, 'handles follow live repaints');
  h.close(); assert.equal(s.composer, null); assert.equal(s.action('done'), null); assert.equal(s.placeNotificationRoute(), false);
});
