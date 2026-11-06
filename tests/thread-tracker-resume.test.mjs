import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// Stopped rows (marked running, nothing behind them) carry Resume: an ordinary owner send, spinner on the tap's frame.
const source = readFileSync(new URL('../web/core/thread-tracker.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../web/core/chats-list-model.js', import.meta.url), 'utf8');
const ITEMS = [
  { id: 'disk', title: 'Disk pressure', state: 'running', updated_at: 1, message_id: 'm1' },
  { id: 'logs', title: 'Rotate logs', state: 'running', updated_at: 1, message_id: 'm2' },
  { id: 'ask', title: 'Pick a name', state: 'needs_you', updated_at: 1, message_id: 'm3' },
  { id: 'fin', title: 'Backups', state: 'done', updated_at: 1, message_id: 'm4' },
];
async function fixture(agent, status = 'completed') {
  const row = { status }; let paints = 0;
  const doc = { documentElement: { dataset: { tweaks: 'wizard/thread-tracker' } }, addEventListener() {}, querySelectorAll() { paints++; return []; } };
  const win = { addEventListener() {}, dispatchEvent() {}, WizLive: { session: () => row, sessionFor: () => row, onChange() {} } };
  const ctx = vm.createContext({ window: win, document: doc, setInterval() {}, setTimeout() {}, CustomEvent: class {}, fetch: async () => ({ ok: true, json: async () => ({ items: ITEMS }) }) });
  vm.runInContext(model, ctx); win.WizChatsListModel = ctx.WizChatsListModel;
  vm.runInContext(source, ctx); const T = win.WosThreadTracker;
  await T.load('t', agent);
  // A tap inside the strip: closest() walks a tiny fake tree (button → row → strip).
  const strip = { dataset: { ttStrip: 't', ttAgent: agent } };
  const tap = (attr, rowId) => {
    const rowEl = rowId ? { dataset: { ttRow: rowId } } : null;
    const target = { closest: sel => sel === '[data-tt-strip]' ? strip : sel === '[data-tt-row]' ? rowEl : sel === `[${attr}]` ? {} : null };
    return { target };
  };
  return { T, row, tap, doc, paints: () => paints };
}
const rowOf = (html, id) => html.match(new RegExp(`<div class="tt-row [^"]*" [^>]*data-tt-row="${id}"[^]*?</div>`))?.[0] || '';
for (const agent of ['', 'profile', 'container', 'restricted']) {
  test(`stopped rows show Resume; running, needs-you and done rows never do: ${agent || 'main'}`, async () => {
    const { T, row } = await fixture(agent);
    const html = T.stripHtml('t', agent);
    assert.match(rowOf(html, 'disk'), /data-tt-resume\b/); assert.match(rowOf(html, 'logs'), /data-tt-resume\b/);
    assert.doesNotMatch(rowOf(html, 'ask'), /data-tt-resume/); assert.doesNotMatch(rowOf(html, 'fin'), /data-tt-resume/);
    assert.equal((html.match(/data-tt-resume-all/g) || []).length, 1, 'one header Resume');
    assert.doesNotMatch(html.match(/<button type="button" class="tt-h"[^]*?<\/button>/)[0], /data-tt-resume/, 'never nested in the header toggle');
    row.status = 'running';
    const run = T.stripHtml('t', agent);
    assert.doesNotMatch(run, /data-tt-resume/, 'a thread that is really working has no Resume');
    assert.match(rowOf(run, 'disk'), /tt-dot run/);
  });
  test(`row Resume sends one owner message and spins on the same frame: ${agent || 'main'}`, async () => {
    const { T, tap } = await fixture(agent); const sent = [];
    const resume = text => { sent.push(text); assert.match(rowOf(T.stripHtml('t', agent), 'disk'), /tt-dot run/, 'painted before the send runs'); return new Promise(() => {}); };
    assert.equal(T.click(tap('data-tt-resume', 'disk'), { sid: 't', agent, resume }), true);
    assert.deepEqual(sent, ['Continue the stopped items: Disk pressure']);
    const html = T.stripHtml('t', agent);
    assert.match(rowOf(html, 'disk'), /tt-dot run/); assert.doesNotMatch(rowOf(html, 'disk'), /data-tt-resume/);
    assert.match(rowOf(html, 'logs'), /tt-dot stopped/, 'only the tapped row');
  });
  test(`header Resume lists every stopped title; a refused send restores the rows: ${agent || 'main'}`, async () => {
    const { T, tap } = await fixture(agent); const sent = [];
    T.click(tap('data-tt-resume-all'), { sid: 't', agent, resume: text => { sent.push(text); return Promise.resolve(null); } });
    assert.deepEqual(sent, ['Continue the stopped items: Disk pressure; Rotate logs']);
    assert.match(rowOf(T.stripHtml('t', agent), 'disk'), /tt-dot run/); assert.doesNotMatch(T.stripHtml('t', agent), /data-tt-resume-all/);
    await new Promise(r => setImmediate(r));
    const back = T.stripHtml('t', agent);
    assert.match(rowOf(back, 'disk'), /tt-dot stopped/); assert.match(back, /data-tt-resume-all/);
  });
}
test('tweak off: no strip, no Resume, taps not claimed', async () => {
  const { T, tap, doc } = await fixture(''); const sent = [];
  assert.match(T.stripHtml('t', ''), /data-tt-resume/);
  doc.documentElement.dataset.tweaks = '';
  assert.equal(T.stripHtml('t', ''), ''); assert.equal(T.dots('t', ''), '');
  void tap; void sent;
});
test('Chats wires Resume to its own sendChat without taking the draft or leaving the thread', () => {
  const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  const wire = chats.match(/const resume = text => \{[^]*?return it; \};/)?.[0] || '';
  assert.match(wire, /sendChat\(id, text, how, null, \{ sid, away: true, instructions: viewContext\(id, how\) \}\)/);
  assert.match(chats, /WosThreadTracker\.click\(e, \{[^}]*resume \}\)/);
});
test('Resume button uses accent tokens', () => {
  const css = readFileSync(new URL('../web/core/thread-tracker.css', import.meta.url), 'utf8');
  assert.match(css, /\.tt-btn\.resume\s*\{[^}]*var\(--tt-run\)[^}]*var\(--wz-on-accent/);
});
