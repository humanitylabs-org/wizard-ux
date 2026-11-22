// James: Archive is the owner's completion verb; Done remains the agent's status.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
const read = p => withShellParts(withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8')));
const src = withParts(read('web/core/chats.js'));
const slice = (a, b) => { const start = src.indexOf(a), end = src.indexOf(b, start); assert.ok(start >= 0 && end > start); return src.slice(start, end); };
function actions() {
  const ctx = vm.createContext({ followUpActive: s => !!s?.followUp?.active });
  vm.runInContext(slice('  const ACT = {', '  // Notification-thread only:') + slice('  const actionLabel =', '  const owner =') + 'this.api = { ACT, actionLabel };', ctx);
  return ctx.api;
}
test('row, thread header and swipe use Archive with the archive-box icon, not Done', () => {
  const { ACT, actionLabel } = actions();
  assert.equal(ACT.done.label, 'Archive'); assert.equal(ACT.done.hint, 'Archive');
  assert.equal(ACT.done.icon, ACT.file.icon);
  assert.equal(actionLabel({}, 'done'), 'Archive');
  assert.equal(actionLabel({ followUp: { active: true } }, 'done'), 'Archive for now');
  for (const a of Object.values(ACT)) assert.doesNotMatch(a.label + ' ' + a.hint, /\bDone\b|Mark done/);
  const thread = slice('    const tacts = NV ?', '    clearReading(w.id);');
  assert.match(thread, /ACT\[a\]\.hint/); assert.match(thread, /actionLabel\(s, a, true\)/);
  const swipe = slice('  function swipeTray(', '  function swipeA11y(');
  assert.match(swipe, /ACT\[a.file\]\.label, ACT\[a.file\]\.hint/);
  assert.doesNotMatch(thread + swipe, /['"]Done['"]/);
  assert.match(src, /Archived · still watching/); assert.match(src, /Couldn’t archive/);
  assert.doesNotMatch(src, /Marked done|Couldn’t mark done|['"]Done for now/);
});
test('agent completion status still says Done', () => {
  for (const name of ['ATT', 'STI_LAB', 'STI_TIP', 'PRI_LABEL']) {
    const statement = src.match(new RegExp('  const ' + name + ' = [^\\n]+'))?.[0]; assert.ok(statement, name);
    const ctx = vm.createContext({}); vm.runInContext(statement + '; this.value = ' + name, ctx);
    assert.equal(name === 'ATT' ? ctx.value.done.label : name === 'PRI_LABEL' ? ctx.value[4] : ctx.value.done, 'Done', name);
  }
});
const cut = (file, a, b) => { const t = read(file), i = t.indexOf(a), j = t.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return t.slice(i, j + b.length); };
test('remaining action labels say Archive; removed arrow hints stay absent and AI apps keeps E', () => {
  const desktop = read('web/desktop/desktop.js');
  assert.doesNotMatch(desktop, /\['\[data-chact="done"\]', '→', 'Archive'\]/);
  assert.doesNotMatch(desktop, /'Archive \/ Snooze'/);
  assert.doesNotMatch(desktop, /\['\[data-chact="done"\]', '→', 'Done'\]|act === 'done' \? 'Done'/);
  // Desktop ⌥E (chatAct, in its part desktop/desktop-pickany.js) names the action Archive in what it tells the owner.
  const toasts = [], acted = [];
  const d = vm.createContext({ MOD: '⌥', toasts, desktopVars: { homeOpen: true, cur: 0, ws: [{ wins: [] }], W: {} }, focused: () => ({ id: 'w1', app: 'chats', thread: 's1' }),
    mainChats: () => true, panelHas: () => false, panelWins: () => [], toast: (i, t) => toasts.push(t), winEl: () => ({ querySelector: () => null }), CHATS: { threadAct: (...x) => acted.push(x) }, globalThis: {} });
  vm.runInContext(cut('web/desktop/desktop-pickany.js', '    function chatAct(act, keyName) {', '\n    }\n') + '\nthis.chatAct = chatAct;', d);
  d.chatAct('done', 'E');
  assert.deepEqual(toasts, ['Open a chat first, then ⌥E = Archive']);
  d.desktopVars.homeOpen = false; d.chatAct('done', 'E');
  assert.equal(toasts[1], 'Archive appears once the reply is in');
  d.winEl = () => ({ querySelector: () => ({}) }); d.chatAct('done', 'E');
  assert.deepEqual(acted, [['w1', 's1', 'done']]);
  // AI apps (layouts/ai-apps/desktop-keys.js): ⌥E presses the open chat's Archive button and its keycap says E.
  const clicked = [], caps = [];
  const k = vm.createContext({ aadVars: { docked: true }, typing: () => false, sh: false, e: { repeat: false }, chatBtn: a => ({ click: () => clicked.push(a), a }),
    putIn: (b, key) => caps.push([b.a, key]), frontNote: () => false, routeBtn: () => null });
  vm.runInContext(`this.key = code => { ${cut('web/layouts/ai-apps/desktop-keys.js', '    const act = !sh && aadVars.docked', 'return true; }')} return false; };\nthis.caps = () => { ${cut('web/layouts/ai-apps/desktop-keys.js', '    if (aadVars.docked) {\n      for (const [a, k] of', 'putIn(chatBtn(a), k);')} } };`, k);
  assert.equal(k.key('KeyE'), true); assert.equal(k.key('KeyZ'), true); assert.equal(k.key('KeyQ'), false);
  assert.deepEqual(clicked, ['done', 'snooze']);
  k.caps(); assert.deepEqual(caps.find(([a]) => a === 'done'), ['done', 'E']);
});
