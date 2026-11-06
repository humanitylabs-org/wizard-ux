import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
// Agent chat parity (AGENTS.md) for the AI apps view's chat drawer / sidebar: its rows and row actions are the MAIN
// agent's Chats (LIVE.workGroups + the main Chats window). With a host-profile, container and restricted agent's
// Chats window also open (and in front), every drawer action lands on the main window only, and routed windows'
// threads and lists are never touched. Runs the real adapter code from web/app.js (phone) and web/desktop/desktop.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const kinds = ['main', 'host-profile', 'container', 'restricted'];
const src = f => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
const slice = (js, a, b) => { const i = js.indexOf(a), j = js.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return js.slice(i, j); };

function world(file, groups = {}) {
  const js = src(file), calls = [];
  // one Chats window per kind, each on its own desk; a routed agent's window is the one in front
  // Routed windows precede main in lookup order, so dropping the agent predicate cannot pass by accident.
  const W = {}; [...kinds.slice(1), 'main'].forEach(k => { W['w-' + k] = { id: 'w-' + k, app: 'chats', thread: `t-${k}`, agent: k === 'main' ? '' : `qa-${k}`, runtimeKind: k, desk: kinds.indexOf(k) }; });
  const sess = k => ({ id: `s-${k}`, title: `${k} chat`, agent: k === 'main' ? '' : `qa-${k}`, runtimeKind: k, status: 'idle' });
  const ctx = {
    W, calls, idx: 3, sheet: null, APP: { wizard: { id: 'wizard' } },
    CHATS: { views: { providerFor: () => 'wizard-chats', defaultId: () => 'wizard-chats' },
      threadAct: (wid, sid, act) => calls.push(['act', wid, sid, act]), openRenameSheet: (wid, sid) => calls.push(['rename', wid, sid]),
      openChat: (wid, t) => calls.push(['open', wid, t]), threadActions: () => ['snooze', 'done'], stiKind: () => '' },
    // the main agent's own groups: what the shell's Ready / Working read
    LIVE: { ok: true, workGroups: () => ({ working: [], ready: [sess('main')], deferred: [], archive: [], ...groups }), isNew: () => false, cardAt: () => '' },
    window: { WosChatPins: { has: () => false, toggle: id => (calls.push(['pin', id]), true) } },
    closeSheets() {}, deskOf: id => W[id]?.desk ?? -1, goDesk: n => calls.push(['desk', n]), focusWin: id => calls.push(['focus', id]),
    openApp: () => calls.push(['openApp']), toast() {}, findWin: fn => Object.values(W).find(fn) || null,
    skinShowChats: () => W['w-main'], newChat() {},
  };
  modelContext(ctx);
  const main = js.split('\n').find(l => l.startsWith('  const mainChats = w =>'));
  const show = file === 'app.js' ? slice(js, '  function showChats() {', '  /* Home\'s Unread and Working cards') : '';
  const list = slice(js, '    sessionList: () => window.WizChatsListModel.', '    sessionAct: (sid, act) => {');
  const act = slice(js, '    sessionAct: (sid, act) => {', '    showChats: () =>');
  vm.runInContext(`${main}\n${show}\nthis.api = { ${list} ${act} };`, ctx);
  return { api: ctx.api, calls, W };
}

for (const file of ['app.js', 'desktop/desktop.js']) {
  test(`${file}: Ready includes Errors and older day groups without touching routed windows`, () => {
    const row = (id, status = 'idle') => ({ id, title: id, status, agent: '' });
    const w = world(file, { ready: [row('ready')], errors: [row('failed', 'failed'), row('interrupted', 'interrupted')], yesterday: [row('yesterday')], pastWeek: [row('week')] });
    const rows = w.api.sessionList();
    assert.deepEqual(Array.from(rows.ready, r => r.id), ['failed', 'interrupted', 'ready', 'yesterday', 'week']);
    for (const k of kinds.slice(1)) assert.ok(!JSON.stringify(rows).includes(`qa-${k}`), `${k}: no routed row`);
    for (const row of rows.ready.filter(r => r.id !== 'ready')) {
      const sid = row.id;
      for (const action of ['done', 'snooze', 'rename']) {
        assert.ok(row.actions.includes(action), `${sid}: ${action} is offered by the production projection`);
        w.calls.length = 0;
        assert.equal(w.api.sessionAct(sid, action), true, `${sid}: ${action}`);
        const hits = w.calls.filter(c => c[0] === 'act' || c[0] === 'rename');
        assert.deepEqual(hits, [action === 'rename' ? ['rename', 'w-main', sid] : ['act', 'w-main', sid, action]], `${sid}: ${action} targets the main window and exact row once`);
        for (const k of kinds.slice(1)) assert.ok(!w.calls.some(c => c[1] === 'w-' + k), `${sid}: ${action} leaves ${k} untouched`);
        for (const k of kinds) assert.equal(w.W['w-' + k].thread, `t-${k}`, `${sid}: ${action} preserves ${k}'s thread`);
      }
    }
  });
  test(`${file}: the AI apps drawer lists and acts on the main agent's Chats only, with routed windows open`, () => {
    const w = world(file);
    const rows = w.api.sessionList();
    assert.deepEqual(Array.from(rows.ready, r => r.id), ['s-main'], 'only the main agent\'s rows');
    for (const k of kinds.slice(1)) assert.ok(!JSON.stringify(rows).includes(`qa-${k}`), `${k}: no routed row`);
    for (const a of ['done', 'snooze', 'rename']) { w.calls.length = 0; assert.equal(w.api.sessionAct('s-main', a), true, a);
      const hits = w.calls.filter(c => c[0] === 'act' || c[0] === 'rename');
      assert.deepEqual(hits, [a === 'rename' ? ['rename', 'w-main', 's-main'] : ['act', 'w-main', 's-main', a]], `${a} targets the main window and exact row once`);
      for (const k of kinds.slice(1)) assert.ok(!w.calls.some(c => c[1] === 'w-' + k), `${a}: ${k} window untouched`);
    }
    for (const k of kinds) assert.equal(w.W['w-' + k].thread, `t-${k}`, `${k}: its own thread kept`);
  });
}
