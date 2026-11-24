// James: Archive is the owner's completion verb; Done remains the agent's status.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
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
test('row, thread header and swipe use Archive with the archive-box icon, not Done', async () => {
  const { ACT, actionLabel } = actions();
  assert.equal(ACT.done.label, 'Archive'); assert.equal(ACT.done.hint, 'Archive');
  assert.equal(ACT.done.icon, ACT.file.icon);
  assert.equal(actionLabel({}, 'done'), 'Archive');
  assert.equal(actionLabel({ followUp: { active: true } }, 'done'), 'Archive for now');
  for (const a of Object.values(ACT)) assert.doesNotMatch(a.label + ' ' + a.hint, /\bDone\b|Mark done/);
  // The thread header's action buttons (real chats-threadpaint.js) and the swipe tray (real chats-swipe.js), drawn.
  const thread = slice('    const tacts = NV ?', '    clearReading(w.id);');
  const head = runRecording(`${thread}\nthis.html = tacts;`, { NV: null, acts: ['done'], turns: [{}], pend: [], s: { id: 's1', followUp: { active: true } }, ACT, actionLabel, needsAsk: undefined }).html;
  const hd = createDocument(); hd.body.innerHTML = head;
  const hb = hd.querySelector('[data-chact="done"]');
  assert.deepEqual([hb.getAttribute('aria-label'), hb.querySelector('span').textContent], ['Archive', 'Archive for now'], 'the thread header: Archive (for now while watching)');
  const swipe = slice('  function swipeTray(', '  function swipeA11y(');
  const sd = createDocument(), wrap = sd.createElement('div'); sd.body.appendChild(wrap);
  runRecording(`${swipe}\nswipeTray(wrap, 's1');`, { wrap, ACT, swipeActs: () => ({ file: 'done' }), LIVE: { session: () => ({ title: 'Trip' }) }, esc: String });
  const sb = sd.querySelector('[data-chswipe="done"]');
  assert.deepEqual([sb.querySelector('span').textContent, sb.getAttribute('aria-label')], ['Archive', 'Archive: Trip'], 'the swipe: Archive');
  assert.doesNotMatch(head + sd.body.innerHTML, />Done</);
  // What Archive says (real chats-rowacts.js threadAct): Archived, still watching for a follow-up, Couldn’t archive.
  const said = async (s, ok) => {
    const toasts = [];
    const r = runRecording(block(src, '  async function threadAct(') + '\nthis.threadAct = threadAct;', { owner: x => x, rowOf: () => s, ACT, W: { w1: { id: 'w1', thread: null } }, CH: {},
      keepThreadOpen: () => true, actUndo: undefined, followUpActive: x => !!x?.followUp?.active, LIVE: { archive: async () => ok }, toast: (i, t) => toasts.push(t), H: {} });
    await r.threadAct('w1', 's1', 'done'); return toasts;
  };
  assert.deepEqual(await said({ id: 's1' }, true), ['Archived']);
  assert.deepEqual(await said({ id: 's1', followUp: { active: true } }, true), ['Archived · still watching']);
  assert.deepEqual(await said({ id: 's1' }, false), ['Archived', 'Couldn’t archive · thread restored']);
  assert.doesNotMatch(src, /Marked done|Couldn’t mark done|['"]Done for now/);
});
test('agent completion status still says Done', () => {
  for (const name of ['ATT', 'STI_LAB', 'STI_TIP', 'PRI_LABEL']) {
    const statement = src.match(new RegExp('  const ' + name + ' = [^\\n]+'))?.[0];
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
