// wizard-ux issue 1443: the desktop AI apps sidebar mounts the owner's Default Chats look (on for everyone; the switch
// wizard/sidebar-chats-view was removed). These run the real core/chats-view.js: the list region a layout mounts through
// views.mount, the shell hooks that route its taps to the main chat (viewOpen / viewTarget), the main chat kept on the
// standard look (mainLook), the fallback when a look fails, and the repaint signal when Default Chats changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { lookBox } from './fixtures/r5A-experience.mjs';
const source = withShellParts(fs.readFileSync(new URL('../web/core/chats-view.js', import.meta.url), 'utf8'));
const VERSION = 'wizard.chats-view/1';
const entry = id => ({ id, name: 'Look ' + id, source: 'apps.json', url: `/${id}/`, provides: ['chats'], chats_view: { contract: VERSION, module: 'view.js' } });
function harness(H = {}, sessions = [{ id: 'one', title: 'One' }]) {
  const calls = [], events = [], notes = [];
  const el = () => ({ isConnected: true, classList: { toggle() {} }, replaceChildren() { calls.push(['clear']); }, addEventListener() {}, removeEventListener() {} });
  const main = { id: 'main', app: 'chats', thread: null, chatsProvider: 'look' };
  const stand = { id: 'cview-1', app: 'chats', thread: null, chatsProvider: 'look' };
  const list = { id: 'cview-1::side', get thread() { return null; } };
  const wins = { main, 'cview-1': stand, 'cview-1::side': list };
  class CustomEvent { constructor(type) { this.type = type; } }
  const s = { URL, URLSearchParams, console, CustomEvent, location: { origin: 'https://wizard.invalid', search: '' }, localStorage: { getItem: () => null },
    document: { currentScript: { src: 'https://wizard.invalid/wizard-os-home/core/chats-view.js' }, createElement: () => ({}), documentElement: {} },
    MutationObserver: class { observe() {} disconnect() {} }, dispatchEvent: e => events.push(e.type) };
  s.window = s; s.WizLive = { sessions, onChange: () => () => {}, isNew: () => false, agentOf: id => sessions.find(r => r.id === id)?.agent || '' };
  s.WizCore = { chats: () => ({ forget() {}, openChat: (wid, sid) => calls.push(['openChat', wid, sid]), chatsBack() {}, sendChat: (wid, ...a) => calls.push(['sendChat', wid, ...a]) }) };
  vm.runInNewContext(source, s);
  const core = s.WizChatsHost.create({ win: id => wins[id], owner: id => String(id).replace(/::(list|side)$/, ''), save() {}, toast: (...a) => notes.push(a), ...H });
  return { api: s.WizChatsHost, core, el, main, stand, list, calls, events, notes };
}
const provider = (id, seen) => ({ contract: VERSION, id, name: 'Look ' + id, mount: (_el, host) => { seen.host = host; return { update() { seen.updates = (seen.updates || 0) + 1; }, unmount() { seen.unmounted = true; } }; } });

test('views.mount gives the picked look a list region whose taps go to the shell\'s main chat', () => {
  const routed = [];
  const h = harness({ viewOpen: (key, sid) => { routed.push([key, sid]); return key === 'cview-1::side'; }, viewTarget: key => (key === 'cview-1::side' ? 'main' : '') });
  h.api.configure({ apps: [entry('look')], slots: { chats: { default: 'look' } } });
  const seen = {}; h.api.register(provider('look', seen));
  assert.equal(h.core.views.usable('look'), true);
  let painted = 0; const node = h.el();
  assert.equal(h.core.views.mount(h.list, node, () => painted++), true);
  assert.equal(seen.host.region, 'list', 'a list region, as in the Chats window');
  assert.equal(seen.host.windowId, 'cview-1');
  assert.equal(seen.host.thread, null, 'the sidebar never holds a thread');
  assert.equal(painted, 0, 'the look draws: Chats paints nothing here');
  seen.host.openThread('one');
  assert.deepEqual(routed, [['cview-1::side', 'one']]);
  assert.ok(!h.calls.some(c => c[0] === 'openChat'), 'never opened in the stand-in window');
  seen.host.send('hi');
  assert.deepEqual(h.calls.find(c => c[0] === 'sendChat'), ['sendChat', 'main', 'hi'], 'a send from the look goes through the main Chats window');
  // a repaint updates the same instance; forgetting the list window unmounts it
  h.core.views.mount(h.list, node, () => painted++);
  assert.equal(seen.updates, 2);
  h.core.forget('cview-1::side'); assert.equal(seen.unmounted, true);
});

test('main vs routed threads: the sidebar look lists every agent\'s rows and opens each by its own id', () => {
  // main, host-profile, container and restricted agents (the routed kinds Chats serves); ids collide on purpose
  const rows = [['', 'main'], ['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']].flatMap(([agent, kind]) => [{ id: 'same', title: kind, agent, owner: kind === 'main' ? undefined : kind }, { id: 't-' + kind, title: kind + ' only', agent }]);
  const routed = [];
  const h = harness({ viewOpen: (key, sid) => (routed.push(sid), true), viewTarget: () => 'main' }, rows);
  h.api.configure({ apps: [entry('look')] });
  const seen = {}; h.api.register(provider('look', seen));
  h.core.views.mount(h.list, h.el(), () => {});
  assert.deepEqual(seen.host.threads.map(r => r.title), rows.map(r => r.title), 'no agent filter on the owner-wide sidebar list');
  for (const r of seen.host.threads) seen.host.openThread(r.id);
  assert.deepEqual(routed, rows.map(r => r.id), 'each tap hands the shell exactly that row id (the shell opens any agent\'s thread in the main chat)');
  assert.ok(!h.calls.some(c => c[0] === 'openChat'));
});

test('without the shell hooks (phone, Classic) a look\'s taps keep opening in its own window', () => {
  const h = harness();
  h.api.configure({ apps: [entry('look')] });
  const seen = {}; h.api.register(provider('look', seen));
  h.core.views.mount(h.list, h.el(), () => {});
  seen.host.openThread('one'); seen.host.send('x');
  assert.deepEqual(h.calls.filter(c => c[0] !== 'clear'), [['openChat', 'cview-1', 'one'], ['sendChat', 'cview-1', 'x']]);
});

test('mainLook keeps the main chat on standard Chats while the look fills the sidebar', () => {
  const h = harness({ mainLook: w => (w?.id === 'main' ? 'wizard-chats' : '') });
  h.api.configure({ apps: [entry('look')], slots: { chats: { default: 'look' } } });
  assert.equal(h.core.views.providerFor(h.main), 'wizard-chats');
  assert.equal(h.core.views.providerFor(h.stand), 'look');
  assert.equal(h.core.views.providerFor({ id: 'x', agent: 'box', chatsProvider: 'look' }), 'wizard-chats', 'agent windows stay standard');
  const plain = harness();
  plain.api.configure({ apps: [entry('look')], slots: { chats: { default: 'look' } } });
  assert.equal(plain.core.views.providerFor(plain.main), 'look', 'no hook: unchanged (phone, Classic)');
});

test('a look that fails to mount: a toast, Chats takes over, and the sidebar is told to draw its own rows', () => {
  const h = harness();
  h.api.configure({ apps: [entry('look')], slots: { chats: { default: 'look' } } });
  h.api.register({ contract: VERSION, id: 'look', name: 'Look look', mount() { throw Error('broken'); } });
  let painted = 0;
  h.core.views.mount(h.list, h.el(), () => painted++);
  assert.equal(painted, 1, 'paint runs once: the shell shows the stock rows');
  assert.equal(h.core.views.usable('look'), false);
  assert.equal(h.api.defaultId(), 'wizard-chats');
  assert.match(h.notes[0][1], /Look look couldn’t open\. Showing Chats instead/);
  assert.equal(h.stand.chatsProvider, 'wizard-chats', 'only the stand-in falls back');
  assert.equal(h.main.chatsProvider, 'look', 'the main window is untouched');
});

test('a Default Chats change asks layouts to repaint, only when it changes', () => {
  const h = harness();
  h.api.configure({ apps: [entry('look')] });
  assert.deepEqual(h.events, [], 'built-in stays built-in: no signal');
  h.api.configure({ apps: [entry('look')], slots: { chats: { default: 'look' } } });
  assert.deepEqual(h.events, ['wos:chats-view']);
  h.api.configure({ apps: [entry('look')], slots: { chats: { default: 'look' } } });
  assert.deepEqual(h.events, ['wos:chats-view'], 'same choice again: no repaint');
  h.api.configure({ apps: [] });
  assert.deepEqual(h.events, ['wos:chats-view', 'wos:chats-view'], 'uninstalled: back to built-in, repaint');
});

test('no switch any more: gone from the catalog and from Try new features', async () => {
  const SW = 'wizard/sidebar-chats-view';
  const catalog = JSON.parse(fs.readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8'));
  assert.ok(!catalog.tweaks.includes(SW), 'not in the catalog');
  assert.ok(!fs.existsSync(new URL('../web/tweaks/wizard/sidebar-chats-view/', import.meta.url)), 'its package is gone');
  const fresh = await lookBox({ shell: 'desktop' });
  assert.ok(!fresh.row(SW), 'not listed under Try new features');
});

// wizard-ux issue 1460: with another look picked, the AI apps desktop must treat its docked
// Chats window as the main chat (drawn as standard Chats), or sidebar taps open a hidden second Chats window.
test('AI apps + another Default Chats: the docked Chats window is the main chat (issue 1460)', () => {
  const dj = withShellParts(fs.readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
  const lines = dj.split('\n');
  const from = lines.findIndex(l => l.startsWith('  function mainStd()')), to = lines.findIndex((l, i) => i > from && l.startsWith('  const sideWin = id =>'));
  const main = lines.find(l => l.startsWith('  const mainChats = w =>')), look = lines.find(l => l.startsWith('    mainLook: w =>'));
  const run = ({ owns, tweaks, def }) => {
    const docked = { id: 'w-dock', app: 'chats', thread: null }, other = { id: 'w-look', app: 'chats', thread: '__new__', chatsProvider: 'look' }, agent = { id: 'w-ag', app: 'chats', agent: 'box' };
    const ctx = { ownsChatList: owns, document: { documentElement: { dataset: { tweaks } } }, W: { 'w-dock': docked, 'w-look': other, 'w-ag': agent },
      ws: [{ wins: ['w-dock'], focus: 'w-dock' }, { wins: ['w-look'], focus: 'w-look' }, { wins: ['w-ag'], focus: 'w-ag' }],
      CHATS: { views: { defaultId: () => def, providerFor: w => w.chatsProvider || def } } };
    vm.runInNewContext(`${lines.slice(from, to).join('\n')}\n${main}\nthis.mainLook = { ${look} }.mainLook;\nthis.mainChats = mainChats;`, ctx);
    return { ...ctx, docked, other, agent };
  };
  {
    const r = run({ owns: true, tweaks: '', def: 'look' });
    assert.equal(r.mainChats(r.docked), true, 'the docked window is the main chat');
    assert.equal(r.mainChats(r.other), false, 'a look window on another desk is not');
    assert.equal(r.mainChats(r.agent), false, 'agent windows never are');
    assert.equal(r.mainLook(r.docked), 'wizard-chats', 'the docked window draws standard Chats');
    assert.equal(r.mainLook(r.other), '', 'other windows keep their look');
  }
  // two Chats windows on the docked desk, the second focused: the first one is the main chat, as the layout draws it
  const two = run({ owns: true, tweaks: '', def: 'look' });
  two.W['w-2'] = { id: 'w-2', app: 'chats', thread: null }; two.ws[0].wins.push('w-2'); two.ws[0].focus = 'w-2';
  assert.equal(two.mainChats(two.docked), true, 'the first Chats window on the desk (the layout\'s mainChatWindow)');
  assert.equal(two.mainChats(two.W['w-2']), false, 'not the focused second one');
  // Classic (no layout owns the list): unchanged, the window with the picked look is the main one
  const c = run({ owns: false, tweaks: '', def: 'look' });
  assert.equal(c.mainChats(c.other), true); assert.equal(c.mainChats(c.docked), true);
  assert.equal(c.mainLook(c.docked), '');
  // built-in Chats picked on AI apps: unchanged rule
  const b = run({ owns: true, tweaks: '', def: 'wizard-chats' });
  assert.equal(b.mainChats(b.docked), true); assert.equal(b.mainChats(b.other), false); assert.equal(b.mainLook(b.docked), '');
});
