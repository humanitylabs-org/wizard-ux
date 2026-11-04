import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const chats = read('web/core/chats.js');
function fixture() {
  const title = { dataset: { agentTitlebar: '', iconClass: 'ic', titleClass: 't' }, innerHTML: '' };
  const w = { id: 'chats', app: 'chats', focus: null, thread: null }, state = {};
  const ctx = { window: {}, document: { documentElement: { dataset: { leaving: '1' } }, querySelectorAll: () => [title] }, console,
    W: { chats: w }, owner: id => id.split('::')[0], track: { querySelector: () => title }, ch: () => state,
    winAgent: w => w.focus?.key || w.agent || '', LIVE: { agentOf: sid => ({ remote: 'second', main: '' })[sid] || '' },
    listTitle: () => '', AGS: () => ctx.window.WosAgents };
  vm.createContext(ctx); vm.runInContext(read('web/core/agents.js'), ctx);
  ctx.window.WosAgents.list = [{ id: 'primary', label: 'Custom Default', is_default: true }, { id: 'second', label: 'Second Mind' }, { id: 'future', label: 'Future Mind' }];
  const start = chats.indexOf('  function titleAgent(');
  if (start >= 0) vm.runInContext(chats.slice(start, chats.indexOf('  // One stable option order', start)), ctx);
  else vm.runInContext(chats.slice(chats.indexOf('  function syncListTitle('), chats.indexOf('  // One stable option order')), ctx);
  return { ctx, A: ctx.window.WosAgents, title, w, state, sync: () => ctx.syncListTitle(w) };
}
test('shared titlebar follows deep-link focus, picker, thread ownership and back without replacing its node', () => {
  const { w, state, title, sync } = fixture();
  w.focus = { kind: 'agent', key: 'second' }; sync(); // ?agent=second restores this Focus
  assert.equal(title.dataset.agentTitlebar, 'second'); assert.match(title.innerHTML, /Second Mind Agent/);
  w.focus = { kind: 'agent', key: 'future' }; sync(); // picker changes the same window
  assert.equal(title.dataset.agentTitlebar, 'future'); assert.match(title.innerHTML, /Future Mind Agent/);
  w.thread = 'remote'; sync(); // selected thread overrides unrelated Focus
  assert.equal(title.dataset.agentTitlebar, 'second');
  w.thread = 'main'; sync(); assert.match(title.innerHTML, /Custom Default Main Agent/);
  w.thread = '__new__'; w.focus = null; state.newModel = { agent: 'future' }; sync();
  assert.equal(title.dataset.agentTitlebar, 'future');
  w.thread = null; sync(); assert.match(title.innerHTML, /Custom Default Main Agent/);
});
test('registry reload keeps selected agent identity and resolves the default label without a harness name', () => {
  const { A, title, w, sync } = fixture();
  assert.equal(A.title(), 'Custom Default Main Agent');
  assert.equal(A.titleRecord('').label, 'Custom Default');
  assert.equal(A.titleRecord('missing').label, 'missing');
  w.focus = { kind: 'agent', key: 'second' }; sync();
  A.list = A.list.map(a => a.id === 'second' ? { ...a, label: 'Renamed Mind' } : a); A.refreshTitlebars();
  assert.match(title.innerHTML, /Renamed Mind Agent/); assert.equal(title.dataset.agentTitlebar, 'second');
  A.list = []; assert.doesNotMatch(A.title(), /Hermes/);
});
test('both shells initialize Chats headers through the shared current-agent resolver', () => {
  for (const file of ['web/app.js', 'web/desktop/desktop.js']) {
    assert.ok(!read(file).includes("WosAgents.titlebar(w.agent || ''"), file);
    assert.match(read(file), /WosAgents\.titlebar\(CHATS\.titleAgent\(w\)/);
  }
  assert.match(chats, /listTitle, titleAgent,/);
});
