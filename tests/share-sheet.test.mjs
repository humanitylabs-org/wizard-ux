import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../web/core/share-sheet.js', import.meta.url), 'utf8');
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
function load({ apps = { messenger: { kind: 'wizard', name: 'Messenger' } }, open = () => true, agents = null } = {}, recent = null) {
  const events = [];
  let ops = null;
  const window = { WizCore: { apps: () => ({ APP: apps }) }, WizOpenApp: open, dispatchEvent: e => events.push(e), WizAppServices: { claimShare: o => (ops ? false : (ops = o, true)) } };
  if (agents) {
    window.WizOpenAgentChats = async () => false;
    window.WosAgents = { list: agents, visible: () => agents.filter(a => !a.hidden), get: id => agents.find(a => a.id === id), defaultId: () => (agents.find(a => a.is_default) || {}).id || 'hermes', isPrivate: a => a?.privacy === 'private' };
  }
  const storage = store();
  if (recent) storage.setItem('wos.share.recent.v1', JSON.stringify(recent));
  const ctx = { window, localStorage: storage, sessionStorage: store(), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, document: {}, requestAnimationFrame: f => f(), setTimeout };
  vm.runInNewContext(src, ctx);
  return { S: Object.assign({}, window.WosShareSheet, ops), G: window.WosShareSheet, events, storage, claim: window.WizAppServices.claimShare };
}

test('Messenger is offered before it was ever opened; with no receiver installed Share goes straight out', async () => {
  assert.equal(load().S.wants('text'), true);
  const { S } = load({ apps: { calendar: { kind: 'wizard', name: 'Calendar' } } });
  assert.equal(S.wants('text'), false);
  assert.equal(await S.show({ text: 'hi' }, async () => 'shared'), 'shared');
  assert.equal(S.isOpen(), false);
});

test('registry: only declared kinds, only installed Wizard apps, targets cleaned and capped', () => {
  const { S } = load();
  assert.equal(S.register('messenger', { accepts: ['text', 'file', 'evil'], targets: [{ id: 'p1', name: 'Miguel\u0007', detail: 'Telegram' }, { id: 'p1', name: 'dup' }, { id: '', name: 'x' }, { id: 'p2', name: '' }] }), true);
  const r = S._state().receivers.messenger;
  assert.deepEqual([...r.accepts], ['text', 'file']);
  assert.deepEqual([...r.targets.map(t => t.id + ':' + t.name)], ['p1:Miguel']);
  assert.equal(S.wants('text'), true);
  assert.equal(S.wants('url'), false);
  S.register('ghost', { accepts: ['text'] }); // not installed: never offered
  S.register('messenger', { accepts: [] }); // unregister falls back to the reviewed default
  assert.equal(S.wants('text'), true);
  assert.ok(S.setTargets('ghost', Array.from({ length: 40 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))));
  assert.equal(S._state().receivers.ghost.targets.length, 24);
});

test('pending items belong to one app, survive until acked once', () => {
  const { S } = load();
  S.register('messenger', { accepts: ['text'] });
  assert.equal(S.pending('messenger').length, 0);
  assert.equal(S.ack('messenger', 'nope'), false);
});

test('isolation: receiver ops are handed to app services once and never exposed on the global', () => {
  const { G, claim } = load();
  for (const k of ['register', 'setTargets', 'pending', 'ack']) assert.equal(G[k], undefined, k);
  assert.equal(claim({ pending: () => ['stolen'] }), false); // a later claimant (e.g. a frame) is refused
  assert.equal(Object.isFrozen(G), true);
});

test('deliver keeps the item in memory for that app only, acked once', () => {
  const { S, events } = load();
  S.register('messenger', { accepts: ['text'], targets: [{ id: 'p1', name: 'Miguel' }] });
  assert.equal(S.pending('messenger').length, 0);
});

test('a pending share goes to one frame: the first live puller claims it until it closes', () => {
  const { S } = load();
  S.register('messenger', { accepts: ['text'] });
  assert.equal(S.deliver('messenger', { text: 'hi' }, 'p1'), true);
  let aOpen = true; const a = { owner: 'A', alive: () => aOpen }, b = { owner: 'B', alive: () => true };
  assert.equal(S.pending('messenger', a).length, 1);
  assert.equal(S.pending('messenger', b).length, 0, 'second window never gets the same item');
  assert.equal(S.pending('messenger', a).length, 1, 'the claimant can pull again (e.g. after unlock)');
  aOpen = false;
  const got = S.pending('messenger', b);
  assert.equal(got.length, 1, 'a closed claimant releases it');
  assert.equal(S.ack('messenger', got[0].id), true);
  assert.equal(S.pending('messenger', b).length, 0);
});

test('Messenger defaults stay text/url; images only once a Messenger registers them', () => {
  const { S } = load();
  assert.equal(S.wants('image'), false, 'a never-opened Messenger may not stage photos yet');
  assert.equal(S.wants('file'), false);
  S.register('messenger', { accepts: ['text', 'url', 'image'] });
  assert.equal(S.wants('image'), true);
  assert.equal(S.wants('file'), false);
  S.register('messenger', { accepts: ['text', 'url'] });
  assert.equal(S.wants('image'), false, 'older app registration replaces it');
});

test('Blob handoffs preserve bytes and metadata; claim, isolate, clone and ack once', async () => {
  const { S, G, storage } = load();
  S.register('messenger', { accepts: ['image', 'file'] });
  for (const [type, kind] of [['image/png', 'image'], ['application/pdf', 'file'], ['', 'file']]) {
    const file = new File(['private file bytes'], 'example.bin', { type });
    assert.equal(S.deliver('messenger', { file, text: 'caption' }, 'p1'), true);
    const a = { owner: 'A', alive: () => true }, b = { owner: 'B', alive: () => true };
    const [item] = S.pending('messenger', a);
    assert.equal(item.file, file); assert.equal(item.kind, kind); assert.equal(item.name, 'example.bin');
    assert.equal(item.mime, type || 'application/octet-stream'); assert.equal(item.size, file.size);
    assert.equal(item.target, 'p1'); assert.equal(item.text, 'caption');
    assert.equal(S.pending('messenger', b).length, 0); assert.equal(S.pending('other').length, 0);
    const clone = structuredClone(item);
    assert.ok(clone.file instanceof Blob); assert.equal(await clone.file.text(), 'private file bytes');
    assert.equal(S.ack('other', item.id), false);
    assert.equal(S.ack('messenger', item.id), true); assert.equal(S.ack('messenger', item.id), false);
  }
  assert.equal(S.deliver('messenger', {file: new Blob([new Uint8Array(32 * 1024 * 1024 + 1)])}), false);
  assert.equal(S.deliver('messenger', {file: {type: 'image/png', size: 1}}), false);
  assert.doesNotMatch(storage.getItem('wos.share.receivers.v1'), /private file bytes|example.bin|caption/);
  assert.doesNotMatch(JSON.stringify(G._state()), /private file bytes|example.bin|caption/);
});

test('generic files without receivers keep the old path; oversized files never reach it', async () => {
  const { S } = load(); let calls = 0;
  assert.equal(await S.show({file: new Blob(['pdf'], {type: 'application/pdf'})}, () => { calls++; return 'shared'; }), 'shared');
  assert.equal(await S.show({file: new Blob([new Uint8Array(32 * 1024 * 1024 + 1)])}, () => { calls++; }), 'unsupported');
  assert.equal(calls, 1);
});

const AGENTS = [
  { id: 'hermes', label: 'Archimedes', is_default: true, privacy: 'standard', status: 'running', permissions: {} },
  { id: 'philosopher', label: 'Philosopher', privacy: 'standard', status: 'running', permissions: { files: 'none' } },
  { id: 'vault', label: 'Vault', privacy: 'private', status: 'running', permissions: {} },
  { id: 'ghost', label: 'Ghost', privacy: 'standard', status: 'running', hidden: true, permissions: {} },
];

test('Agents row: every visible agent, main agent first, hidden ones never; recent use reorders', () => {
  const { G, storage } = load({ agents: AGENTS });
  assert.deepEqual([...G._agents('text')], ['hermes', 'philosopher', 'vault']);
  assert.ok(storage); // recent order is read at load: seed it through a fresh context
  const src2 = { agents: AGENTS };
  const { G: G2 } = load(src2, ['agent:vault', 'agent:philosopher']);
  assert.deepEqual([...G2._agents('text')], ['vault', 'philosopher', 'hermes']);
});

test('Agents row privacy: a private chat offers only its own agent; Incognito offers none', () => {
  const { G } = load({ agents: AGENTS });
  assert.deepEqual([...G._agents('text', { chat: true, agent: 'vault', private: true })], ['vault']);
  assert.deepEqual([...G._agents('text', { chat: true, agent: 'hermes', private: true, incognito: true })], []);
  assert.deepEqual([...G._agents('text', { chat: true, agent: 'philosopher', private: false })], ['hermes', 'philosopher', 'vault']);
});

test('Agents row: an agent with file access off is not offered images or files', () => {
  const { G } = load({ agents: AGENTS });
  assert.deepEqual([...G._agents('image')], ['hermes', 'vault']);
  assert.deepEqual([...G._agents('url')], ['hermes', 'philosopher', 'vault']);
});

test('quote: attribution line stays as is above a Markdown quote, with room for his note', () => {
  const { G } = load({ agents: AGENTS });
  assert.equal(G._quote({ text: 'From Archimedes:\n\nLine one\n\nLine two' }), 'From Archimedes:\n> Line one\n>\n> Line two\n\n');
  assert.equal(G._quote({ text: 'plain words' }), '> plain words\n\n');
  assert.equal(G._quote({ url: 'https://x.test/a', title: 'A page' }), '> [A page](https://x.test/a)\n\n');
  assert.equal(G._quote({ text: 'see https://x.test/a', url: 'https://x.test/a' }), '> see https://x.test/a\n\n');
  assert.equal(G._quote({ file: {} }), '');
});

test('no app receivers but agents present: the sheet still opens (Agents row) instead of going straight out', () => {
  const { G } = load({ apps: {}, agents: AGENTS });
  assert.equal(G.wants('text'), false);
  assert.ok(G._agents('text').length > 0);
});
