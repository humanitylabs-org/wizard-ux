// wizard-ux issue 1989: other agents' chats are apps (core/apps.js agentTile, `agent:<id>`), so the phone Apps panel
// and launcher can list and open them.
// 1. The phone's app registry is first asked for by core/app-services.js, before core/agents.js has loaded; it must
//    still follow the agents, or agent tiles appear only after something else rebuilds the list.
// 2. Opening an agent's tile on the phone, while Chats shows its Activity list (the Inbox), opens that agent's own list
//    (the Chats switcher's agent view). A bare agent Focus there was dropped on the next paint (Activity shows every
//    agent), so the tap landed on the main agent's Inbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';

const appsSrc = readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8');

function registryBeforeAgents() {
  const store = new Map(), on = {};
  const win = {
    WizCore: {}, location: { origin: 'http://x', pathname: '/' }, document: { readyState: 'loading' },
    addEventListener(t, f) { (on[t] ||= []).push(f); }, removeEventListener() {}, dispatchEvent() { return true; },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  };
  const ctx = { window: win, document: { addEventListener() {}, hidden: false }, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    localStorage: win.localStorage, location: win.location, addEventListener() {}, fetch: async () => ({ ok: false }), setTimeout, clearTimeout, console };
  ctx.self = win; ctx.globalThis = ctx;
  vm.createContext(ctx); vm.runInContext(appsSrc, ctx);
  return { win, fire: t => (on[t] || []).forEach(f => f()) };
}
function agents(list) {
  const fns = new Set();
  const AG = { list, visible: () => AG.list.filter(a => !a.hidden), onChange: fn => { fns.add(fn); return () => fns.delete(fn); }, emit: () => fns.forEach(f => f(AG)),
    title: a => a.label, glyph: () => '✦', colour: () => '#888' };
  return AG;
}

test('a registry made before core/agents.js loaded lists agent tiles and follows agent changes', () => {
  const { win, fire } = registryBeforeAgents();
  const R = win.WizCore.apps('mobile'); // core/app-services.js asks this early
  assert.ok(!R.APP['agent:philosopher']);
  const AG = win.WosAgents = agents([{ id: 'hermes', label: 'Wizard', is_default: true }, { id: 'philosopher', label: 'Philosopher Agent' }]);
  fire('DOMContentLoaded');
  assert.equal(R.APP['agent:philosopher']?.agent, 'philosopher', 'the agent tile is there once the page has loaded');
  AG.list = [...AG.list, { id: 'private', label: 'Private Agent' }]; AG.emit();
  assert.equal(R.APP['agent:private']?.name, 'Private Agent', 'a new agent appears without another rebuild');
});

const read = p => withShellParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
function opener(view) {
  const w = { id: 'main-chats', app: 'chats', thread: null }, calls = [];
  const CHATS = { chanView: () => view, switcher: { go: (win, key) => { calls.push('go ' + win.id + ' ' + key); return true; } },
    setFocus: (win, f) => { calls.push('focus ' + win.id + ' ' + f.kind + ':' + f.key); return true; }, openNewDraft() {} };
  const AG = { get: id => (id === 'philosopher' ? { id } : null), load: async () => {} };
  const ctx = vm.createContext({ window: { WosAgents: AG }, CHATS, LIVE: null, toast() {}, closeSheets() {}, placeApp: () => w, mainChats: () => true });
  const code = read('web/app.js'), a = code.indexOf('  async function openAgentChats('), b = code.indexOf('  window.WizOpenAgentChats', a);
  assert.ok(a > 0 && b > a, 'openAgentChats found');
  vm.runInContext(code.slice(a, b) + '\nthis.open = openAgentChats;', ctx);
  return { open: ctx.open, calls };
}

test('the phone opens an agent tile as that agent\'s own list when Chats shows its Inbox (Activity)', async () => {
  const o = opener('activity');
  assert.equal(await o.open('philosopher'), true);
  assert.deepEqual(o.calls, ['go main-chats #@agent:philosopher']);
});

test('Chats on its Channels list keeps today\'s agent Focus', async () => {
  const o = opener('channels');
  assert.equal(await o.open('philosopher'), true);
  assert.deepEqual(o.calls, ['focus main-chats agent:philosopher']);
});
