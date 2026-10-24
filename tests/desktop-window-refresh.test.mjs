import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const kinds = ['main', 'host-profile', 'container', 'restricted'];

test('every desktop window bar has a Refresh button wired to reloadWin', () => {
  assert.match(js, /\$\{reloadable\(w\) \? `<button data-wact="reload" title="Refresh \(\$\{MOD\}R\)"/);
  assert.match(js, /if \(act === 'reload'\) return reloadWin\(id\);/);
});

test('⌥R refreshes what is in front; Home when no window is focused', () => {
  assert.match(js, /code === 'KeyR' && !shift\) return hit\(\(\) => \{ if \(!e\.repeat\) reloadCurrent\(\); \}\)/);
  assert.match(js, /function reloadCurrent\(\) \{ if \(homeOpen \|\| !ws\[cur\]\.wins\.length\) return refreshHome\(\);/);
  const body = js.slice(js.indexOf('function reloadWin('), js.indexOf('function refreshHome('));
  assert.ok(!/closeWin\(/.test(body), 'refresh must not close the window');
  assert.match(body, /Restarted \$\{winTitle\(w\)\}/, 'cross-origin frames say they restarted');
});

test('Refresh is listed in the keys sheet and the command palette', () => {
  assert.match(js, /\[`\$\{MOD\}R`, 'Refresh window'\]/);
  assert.match(js, /name: 'Refresh window', icon: '↻', keys: `\$\{MOD\}R`/);
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
