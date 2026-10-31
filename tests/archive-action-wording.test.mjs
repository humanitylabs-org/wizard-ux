// James: Archive is the owner's completion verb; Done remains the agent's status.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('web/core/chats.js');
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
test('agent status and Morning completion badges still say Done', () => {
  for (const name of ['ATT', 'STI_LAB', 'STI_TIP', 'PRI_LABEL']) {
    const statement = src.match(new RegExp('  const ' + name + ' = [^\\n]+'))?.[0]; assert.ok(statement, name);
    const ctx = vm.createContext({}); vm.runInContext(statement + '; this.value = ' + name, ctx);
    assert.equal(name === 'ATT' ? ctx.value.done.label : name === 'PRI_LABEL' ? ctx.value[4] : ctx.value.done, 'Done', name);
  }
  assert.match(src, /all \? 'Done' : 'Pinned'/);
});
test('keyboard guide, hints and shortcut fallback name the Archive action', () => {
  const desktop = read('web/desktop/desktop.js');
  assert.match(desktop, /\['\[data-chact="done"\]', '→', 'Archive'\]/);
  assert.match(desktop, /act === 'done' \? 'Archive'/);
  assert.match(desktop, /'Archive \/ Snooze'/);
  assert.doesNotMatch(desktop, /\['\[data-chact="done"\]', '→', 'Done'\]|act === 'done' \? 'Done'/);
});
