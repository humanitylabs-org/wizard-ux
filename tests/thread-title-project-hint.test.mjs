import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The shared rename sheet is used by both phone and desktop. It must not teach the retired task/feature naming
// rule, and the owner's lock promise stays intact. Runs the real core/chats-sheets.js part.
function renameSheet(agent) {
  const ctx = { window: { WizConfig: { agent: () => agent } } };
  vm.runInNewContext(readFileSync(new URL('../web/core/chats-sheets.js', import.meta.url), 'utf8'), ctx);
  let html = '';
  const input = { focused: false, focus() { this.focused = true; }, select() {} };
  const el = { insertAdjacentHTML: (where, h) => { html += h; }, querySelector: q => (q === '.ch-rename input' ? input : null) };
  const chatVars = {}, esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const api = ctx.window.WizCore.chatsParts.sheets({ CH: {}, chatVars, closeRowSheet() {}, esc, H: {}, LIVE: { session: id => ({ id, title: 'Old <title>' }) }, renderThreadNow() {}, toast() {},
    track: { querySelector: () => el }, W: {} });
  api.openRenameSheet('w1', 's1');
  return { html, input, chatVars };
}

test('rename sheet recommends a project home and preserves owner lock copy', () => {
  const r = renameSheet('Archimedes');
  assert.match(r.html, /<p class="ch-sheet-n">Use a short project name, such as Messenger\. Your name sticks; Archimedes won’t rename it\.<\/p>/);
  assert.doesNotMatch(r.html, /project\s*·\s*feature/i, 'no retired task/feature rule');
  assert.match(r.html, /value="Old &lt;title&gt;"/, 'starts from the current name, escaped');
  assert.equal(r.input.focused, true);
  assert.deepEqual({ ...r.chatVars.rowSheet }, { wid: 'w1', sid: 's1', rename: true });
  assert.match(renameSheet('<b>').html, /Your name sticks; &lt;b&gt; won’t rename it/, 'the agent name is escaped');
});
