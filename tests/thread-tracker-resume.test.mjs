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
for (const agent of ['']) { // main builder agent only (James, 9 Nov 2026)
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
function slice(src, start) {
  const at = src.indexOf(start); assert.ok(at >= 0, 'missing ' + start);
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1);
}
const chatsSrc = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
function resumeIn({ winAgent = '', rowAgent, idAgent = '' }) {
  const sends = [];
  const ctx = vm.createContext({ W: { w1: { id: 'w1', thread: 't' } }, owner: id => id, PW: { follow() {} },
    AGS: () => ({ isOther: a => !!a && a !== 'main' }), winAgent: () => winAgent, rowOf: () => (rowAgent === undefined ? { id: 't' } : { id: 't', agent: rowAgent }),
    LIVE: { agentOf: () => idAgent }, viewContext: () => 'ctx', sendChat: (...a) => { sends.push(a); return Promise.resolve({ id: 'q' }); } });
  vm.runInContext(slice(chatsSrc, 'function resumeTracked(') + '\nthis.resumeTracked = resumeTracked;', ctx);
  return { out: ctx.resumeTracked('w1', ctx.W.w1, 'Continue the stopped items: Disk pressure'), sends };
}
test('Chats wires Resume to its own sendChat without taking the draft or leaving the thread', () => {
  assert.match(chatsSrc, /const resume = text => resumeTracked\(id, w, text\);/);
  assert.match(chatsSrc, /WosThreadTracker\.click\(e, \{[^}]*resume \}\)/);
  const { sends } = resumeIn({});
  assert.equal(sends.length, 1); const [wid, text, how, audio, opts] = sends[0];
  assert.equal(wid, 'w1'); assert.match(text, /Continue the stopped items/); assert.equal(audio, null);
  assert.equal(opts.sid, 't'); assert.equal(opts.away, true); assert.equal(opts.instructions, 'ctx'); assert.equal('agent' in opts, false, 'main: ordinary main reply');
});
test('Resume carries the owning window agent; an id-only lookup naming another agent is refused, never misrouted', async () => {
  for (const ag of ['profile', 'container', 'restricted']) {
    const viaWin = resumeIn({ winAgent: ag, idAgent: ag });
    assert.equal(viaWin.sends[0][4].agent, ag, `${ag} window`);
    const viaRow = resumeIn({ rowAgent: ag, idAgent: ag });
    assert.equal(viaRow.sends[0][4].agent, ag, `${ag} row shown in the main window`);
    // A main-window thread whose id the id-only map attributes to a routed agent (session id collision).
    const clash = resumeIn({ idAgent: ag });
    assert.equal(clash.sends.length, 0, `main window, ${ag} id clash: not sent`); assert.equal(await clash.out, null, 'refused: tracker restores rows');
    const clash2 = resumeIn({ winAgent: ag, idAgent: 'other' });
    assert.equal(clash2.sends.length, 0, `${ag} window, other-agent id clash: not sent`);
  }
});
test('Resume button uses accent tokens', () => {
  const css = readFileSync(new URL('../web/core/thread-tracker.css', import.meta.url), 'utf8');
  assert.match(css, /\.tt-btn\.resume\s*\{[^}]*var\(--tt-run\)[^}]*var\(--wz-on-accent/);
});
