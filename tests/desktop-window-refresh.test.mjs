import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { expression } from './fixtures/source-slice.mjs';

const js = withShellParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
const kinds = ['main', 'host-profile', 'container', 'restricted'];

const lineOf = k => { const i = js.indexOf(k); assert.ok(i >= 0, k); return js.slice(js.lastIndexOf('\n', i) + 1, js.indexOf('\n', i)); };

test('every desktop window bar has a Refresh button wired to reloadWin', () => {
  const bar = vm.runInNewContext('w => `' + expression(js, '${reloadable(w) ? `<button data-wact="reload"') + '`', { reloadable: w => !!w, MOD: '⌥', esc: String });
  assert.match(bar({ id: 'w1' }), /<button data-wact="reload" title="Refresh \(⌥R\)"/);
  const reloaded = [], act = vm.runInNewContext(`(id, act) => { ${lineOf("if (act === 'reload') return reloadWin(id);")} return 'other'; }`, { reloadWin: id => (reloaded.push(id), true) });
  assert.equal(act('w1', 'reload'), true); assert.deepEqual(reloaded, ['w1']);
  assert.equal(act('w1', 'close'), 'other');
});

test('⌥R refreshes what is in front; Home when no window is focused', () => {
  const calls = [], ctx = { calls, homeOpen: false, cur: 0, ws: [{ wins: ['w1'] }], focused: () => ({ id: 'w1' }),
    reloadWin: id => (calls.push('win:' + id), true), refreshHome: () => (calls.push('home'), true), hit: f => f() };
  vm.createContext(ctx);
  vm.runInContext(`${lineOf('function reloadCurrent()')}\nthis.key = (code, shift, e) => { ${lineOf("code === 'KeyR' && !shift")} };`, ctx);
  ctx.key('KeyR', false, { repeat: false }); assert.deepEqual(calls, ['win:w1']);
  ctx.key('KeyR', false, { repeat: true }); assert.deepEqual(calls, ['win:w1'], 'a held key refreshes once');
  ctx.homeOpen = true; ctx.key('KeyR', false, {}); assert.equal(calls.at(-1), 'home');
  ctx.homeOpen = false; ctx.ws[0].wins = []; ctx.key('KeyR', false, {}); assert.equal(calls.at(-1), 'home', 'an empty desk refreshes Home');
  // a cross-origin app window restarts at its start page, and stays open
  const r = harness(), frame = { src: 'https://other.test/app/', contentWindow: { get location() { throw new Error('cross-origin'); } } };
  const el = { querySelector: q => (q === '.wbody iframe' ? frame : null), remove: () => assert.fail('refresh must not close the window') };
  r.W.app = { id: 'app', app: 'frame', title: 'Calendar' }; r.winEl = () => el; const toasts = []; r.toast = (i, t) => toasts.push(t);
  assert.equal(r.reloadWin('app'), true);
  assert.deepEqual(toasts, ['Restarted Calendar'], 'cross-origin frames say they restarted');
});

test('Refresh is listed in the keys sheet and the command palette', () => {
  const WIN = vm.runInNewContext(`(() => { ${lineOf("const WIN = [['P', 'Float chat'")} return WIN; })()`);
  assert.ok(WIN.some(k => k[0] === 'R' && k[1] === 'Refresh window'), 'keys sheet');
  const ran = [], line = lineOf("{ kind: 'cmd', name: 'Refresh window'").trim().replace(/,$/, '');
  const cmd = vm.runInNewContext(`(${line})`, { MOD: '⌥', reloadCurrent: () => ran.push('reload') });
  assert.equal(cmd.keys, '⌥R'); assert.equal(cmd.icon, '↻'); cmd.run(); assert.deepEqual(ran, ['reload']);
});

// Agent chat parity: run the real reloadWin for a main Chats window and a routed window of every runtime kind,
// and check each refetches its own thread and repaints its own list, never another agent's.
function harness() {
  const start = js.indexOf('  const reloadable = w => !!w;');
  const end = js.indexOf('  function refreshHome(');
  assert.ok(start > 0 && end > start, 'refresh block found');
  const calls = [];
  const W = {}, els = {};
  const el = id => ({ querySelector: sel => sel.includes('::list') ? { list: id } : null });
  const ctx = {
    W, calls,
    winEl: id => (W[id] ? (els[id] ||= el(id)) : null),
    listWin: id => ({ id: id + '::list', agent: W[id].agent }),
    syncChatsPane: id => calls.push(['sync', id]),
    toast: () => {}, save: () => {}, winTitle: w => w.title || 'Chats',
    CHATS: {
      isHosted: () => false,
      loadThread: (w, force) => calls.push(['load', w.id, w.agent || '', w.thread, force]),
      renderChatList: (lw, lp) => calls.push(['list', lw.id, lw.agent || '', lp.list]),
    },
    LIVE: { refresh: () => { calls.push(['live']); return Promise.resolve(); } },
    window: { WizCore: { refreshApps: () => calls.push(['apps']) } },
  };
  vm.createContext(ctx);
  vm.runInContext(`${js.slice(start, end)}\nthis.reloadWin = reloadWin;`, ctx);
  return ctx;
}

test('Chats refresh refetches its own thread and list for main and every routed runtime kind', async () => {
  const ctx = harness();
  for (const kind of kinds) {
    const id = `w-${kind}`;
    ctx.W[id] = { id, app: 'chats', agent: kind === 'main' ? '' : `qa-${kind}`, thread: `s-${kind}` };
  }
  for (const kind of kinds) {
    ctx.calls.length = 0;
    const id = `w-${kind}`, agent = kind === 'main' ? '' : `qa-${kind}`;
    assert.equal(ctx.reloadWin(id), true);
    await new Promise(r => setTimeout(r, 0));
    const c = JSON.parse(JSON.stringify(ctx.calls));
    assert.deepEqual(c.filter(x => x[0] === 'load'), [['load', id, agent, `s-${kind}`, true]], kind);
    assert.deepEqual(c.filter(x => x[0] === 'list'), [['list', `${id}::list`, agent, id]], kind);
    assert.ok(c.some(x => x[0] === 'live'), `${kind}: live data refetched`);
  }
});

test('a New chat draft is never reloaded as a thread', async () => {
  const ctx = harness();
  ctx.W.d = { id: 'd', app: 'chats', agent: 'qa-container', thread: '__new__' };
  ctx.reloadWin('d'); await new Promise(r => setTimeout(r, 0));
  assert.equal(ctx.calls.filter(x => x[0] === 'load').length, 0);
});
