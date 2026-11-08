import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { modelContext } from './fixtures/chats-list-model.mjs';
const source = p => readFileSync(process.env.QA_TREE ? path.join(process.env.QA_TREE, p) : new URL('../' + p, import.meta.url), 'utf8');
const desktop = source('web/layouts/ai-apps/desktop.js');
const classic = source('web/desktop/desktop.js');
const phone = source('web/layouts/ai-apps/layout.js');
const app = source('web/app.js');
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
class Node {
  constructor(tag = 'div', cls = '', attrs = {}) { this.tag = tag; this.cls = cls; this.attrs = { ...attrs }; this.children = []; this.dataset = {}; this.textContent = attrs.text || ''; this.hidden = false; this.innerHTML = ''; this.classList = { contains: () => false }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k, v) { this.attrs[k] = v; }
  querySelectorAll(sel) { return this.children.flatMap(n => [...(sel.startsWith('.') && n.cls.split(' ').includes(sel.slice(1)) ? [n] : []), ...n.querySelectorAll(sel)]); }
  get childElementCount() { return this.children.length; }
}
function harness() {
  const storage = new Map();
  const c = { console, AbortSignal, document: { documentElement: { dataset: {} }, readyState: 'loading', hidden: false, addEventListener() {} }, navigator: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    setInterval() {}, setTimeout() {}, addEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    WizConfig: { dayStart: n => n - n % 864e5, dayParts: () => ({ dow: 0, d: 1, m: 1 }), hm: () => '', dateLabel: () => '' },
    WosAgents: { isOther: id => id !== 'hermes', get: id => ({ id, privacy: 'standard' }) },
    WosBell: { unreadCount: () => 0, readyMore: () => false, inChats: () => false, isOff: () => false },
    WizSigil: { of: () => ({ color: 'purple' }), html: () => '<i></i>' } };
  c.window = c; modelContext(c); vm.runInContext(source('web/live.js'), c); vm.runInContext(source('web/core/workspace-navigation.js'), c);
  const L = c.WizLive, N = c.WizCore.workspaceNav, M = c.WizChatsListModel;
  L.ok = true; L.seen = { initializedAt: 1, threads: {} };
  const stamp = new Date(Date.now() - 60000).toISOString();
  L.sessions = Array.from({ length: 88 }, (_, i) => ({ id: 'thread-' + i, title: (i < 37 ? 'Read' : 'Unread') + ' · ' + i,
    runtime: 'direct', status: 'completed', attention: { state: i < 37 ? 'done' : 'fyi' }, previewRole: 'assistant', preview: 'Synthetic reply',
    updatedAt: stamp, previewAt: stamp, lastAssistantAt: stamp, messageCount: 2 }));
  L.sessions.slice(0, 37).forEach(s => L.markSeen(s.id));
  const scroll = new Node(), rList = new Node(), menuCount = new Node(), menuBtn = new Node(), status = new Node();
  const els = { '#status': status, '#logo': new Node(), '#wsList': new Node() };
  Object.assign(c, { LIVE: L, C: c.WizCore, APP: { wizard: { id: 'wizard' } }, CHATS_APP: { id: 'wizard' }, CHATS: 'wizard',
    ...M, sessions: null, badgeMap: {}, root: { dataset: { aadSide: 'open' } }, scroll, rList, menuCount, menuBtn,
    q: '', secOpen: { ready: true }, KINDS: ['working', 'snoozed', 'ready', 'archive'], SECTIONS: [['working', 'Working'], ['ready', 'Ready']], EMPTY: {},
<<<<<<< HEAD
    drawn: '', railDrawn: '', gm: 'none', workingOrder: () => 'alphabetical', readyOrder: () => 'newest', groupBy: () => c.gm, desks: () => [], here: () => ({}),
=======
    drawn: '', railDrawn: '', gm: 'none', workingOrder: () => 'alphabetical', archiveTop: () => false, sectionsFor: () => c.SECTIONS, readyOrder: () => 'newest', groupBy: () => c.gm, desks: () => [], here: () => ({}),
>>>>>>> origin/main
    badgeText: id => N.label(id), readSessions: () => c.sessions, markCurrent() {}, closeMenu() {}, railNow: () => null, fly: null,
    RAIL_WORDS: {}, railGo() {}, flyWant() {}, flyLeave() {}, el: (...args) => new Node(...args), icon: () => new Node(),
    chatRow: r => new Node('div', 'chat-row', { text: r.id }), api: { apps: { list: () => [], badgeText: id => N.label(id) }, listen() {}, storage: { set() {} } },
    GROUP_ORDERS: [['newest', 'Newest first']], GROUP_MODES: M.GROUP_MODES,
    home: { paint() {} }, open: false, togBtn: new Node(), paintFuel() {}, paintVt() {},
    $: id => els[id], ws: [], W: {}, appOf: () => ({ id: 'wizard' }), homeOpen: false, cur: 0, MOD: 'Alt',
    live: () => L.groups(), DOWL: ['Sunday'], MON: ['January'], gearBtn: () => '', unsentCard: () => '', sideCard: () => '' });
  vm.runInContext(between(desktop, '  function paintList(', '  /** the chat in front'), c);
  vm.runInContext(between(desktop, '  function railRow(', '  /* the hover flyout'), c);
  vm.runInContext(between(classic, '  function paintBar()', '  function tickClock()'), c);
  vm.runInContext(between(app, '  function renderHome()', '  setInterval(() =>'), c);
  vm.runInContext(between(phone, '  function paintBadges()', '  /* ---------- a chat row'), c);
  c.phonePaintBadges = c.paintBadges;
  // Execute the real publication statements from both shells.
  const publishers = ['web/app.js', 'web/desktop/desktop.js'].map(p => source(p).split('\n').find(l => /workspaceNav\.refreshChats\(/.test(l)));
  function sync() {
    for (const statement of publishers) vm.runInContext(statement, c);
    c.badgeMap = { ...N.counts };
    c.sessions = M.sessionList(L.workGroups(), { live: L, chats: { stiKind: s => s.attention?.state === 'done' ? 'done' : 'fyi', threadActions: () => [] } });
  }
  sync();
  return { c, L, N, M, scroll, rList, menuCount, status, sync, render() {
    c.phonePaintBadges(); c.root.dataset.aadSide = 'open'; c.paintList();
    c.root.dataset.aadSide = 'rail'; c.paintRail(); c.paintBar();
  } };
}
const texts = (root, cls) => root.querySelectorAll('.' + cls).map(n => n.textContent);

test('88 Ready rows with 51 unread: phone, desktop header/rail and Classic all show 51, not 88', () => {
  const h = harness(); h.render();
  assert.equal(h.menuCount.textContent, '51');
  assert.deepEqual(texts(h.scroll, 'aad-sec-n'), ['51']);
  assert.deepEqual(texts(h.rList, 'aad-rk-wn'), ['51']);
  assert.match(h.status.innerHTML, /title="Unread"[^]*?<\/i>51<\/span>/);
  assert.match(h.c.renderHome(), /aria-label="Ready, 51 unread"/);
  assert.equal(h.scroll.querySelectorAll('.chat-row').length, 88, 'read Ready rows still render');
  assert.equal(h.L.workGroups().ready.length, 88);
});

test('reading clears every pill without changing Ready membership; unread-only changes repaint folded rail', () => {
  const h = harness(); h.render();
  for (const s of h.L.sessions) h.L.markSeen(s.id);
  h.sync(); h.render();
  assert.equal(h.menuCount.hidden, true);
  assert.deepEqual(texts(h.scroll, 'aad-sec-n'), []);
  assert.deepEqual(texts(h.rList, 'aad-rk-wn'), []);
  assert.doesNotMatch(h.status.innerHTML, /title="Unread"/);
  assert.match(h.c.renderHome(), /data-act="ready" aria-label="Ready"/);
  assert.doesNotMatch(h.c.renderHome().match(/data-act="ready"[^]*?<\/button>/)[0], /class="n"/);
  assert.equal(h.scroll.querySelectorAll('.chat-row').length, 88);
  const s = h.L.sessions[0]; s.previewAt = s.lastAssistantAt = new Date(Date.now() + 1000).toISOString();
  h.sync(); h.render();
  assert.deepEqual(texts(h.rList, 'aad-rk-wn'), ['1']);
  assert.deepEqual(texts(h.scroll, 'aad-sec-n'), ['1']);
});

test('status/project subgroup pills count only their unread rows, preserving read groups and navigation inventory', () => {
  const h = harness();
  for (const mode of ['status', 'project']) {
    h.c.gm = mode; h.render();
    assert.deepEqual(texts(h.scroll, 'aad-grp-n'), ['51']);
    assert.deepEqual(texts(h.rList, 'aad-rk-wn'), ['51']);
    assert.equal(h.scroll.querySelectorAll('.chat-row').length, 88);
    assert.equal(h.rList.children.length, 2, 'read-only group remains navigable but has no count');
  }
  assert.equal(h.M.unreadCount([{ id: 'same', unread: true }, { id: 'same', unread: true }]), 1);
});

test('routed unread notes and badge-only changes use phone canonical feed; caps/plus labels match', () => {
  const h = harness(); h.render();
  h.c.WosBell.unreadCount = () => 2; h.c.WosBell.readyMore = () => true; h.sync(); h.render();
  assert.equal(h.menuCount.textContent, '53+');
  assert.deepEqual(texts(h.scroll, 'aad-sec-n'), ['53+']);
  assert.deepEqual(texts(h.rList, 'aad-rk-wn'), ['53+']);
  h.c.WosBell.unreadCount = () => 100; h.sync(); h.render();
  assert.equal(h.menuCount.textContent, '99+');
  assert.deepEqual(texts(h.scroll, 'aad-sec-n'), ['99+']);
  assert.deepEqual(texts(h.rList, 'aad-rk-wn'), ['99+']);
});
