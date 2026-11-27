// Sent rows (wizard-ux issue 1814): the real Chats part (core/chats-sent.js) on a stand-in Chats. Since Sent as threads
// (wizard-ux issue 1880, on for everyone) Sent's list is one row per thread (tests/sent-threads.test.mjs); what stays
// from Sent rows is the row actions sheet of a send whose thread isn't loaded yet: plain words, Open chat and the two
// corrections. Browser proof: tests/qa-chats-sent-threads.cjs.
// Run: node --test tests/sent-rows.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = 'wizard/sent-rows';
const clone = v => JSON.parse(JSON.stringify(v));
const sid = c => 'sent_' + c.repeat(24);
const view = (c, extra = {}) => ({ id: sid(c), at: 1000, source: 'orb', text: 'Words ' + c, route: 'agent', decidedBy: 'model', rules: [], state: 'done', thread: 'thread_' + c, record: null, tags: [], urgent: false, wouldRoute: null, corrected: null, error: '', wantsReply: true, answer: '', quiet: false, ...extra });

// The routing corrections teach Smart inbox's triage, so they are there only with it on (wizard-ux issue 1962).
const SMART = 'wizard/smart-inbox';
function part({ tweaks = SMART, rows = [], next = null } = {}) {
  const renders = [], opened = [], corrections = [], toasts = [], sheets = [];
  const CH = { main: { sent: true }, 'host-ops': {}, box: {}, locked: {} }, chatVars = { chanView: 'activity', rowSheet: null, secOpen: {} };
  const W = { main: { id: 'main', thread: null }, 'host-ops': { id: 'host-ops', thread: null }, box: { id: 'box', thread: null }, locked: { id: 'locked', thread: null } };
  const agentOf = { 'host-ops': 'host-profile', box: 'container', locked: 'restricted' };
  const state = { ok: true, gone: false, rows, next };
  const LIVE = { sentLog: { state: () => state, fresh() {}, read: async () => state, more: async () => state, correct: async (id, should) => { corrections.push([id, should]); state.rows = state.rows.map(r => r.id === id ? { ...r, corrected: { shouldReply: should, at: 2 } } : r); return { changed: true, row: null }; } }, onChange() {} };
  const root = { dataset: { tweaks } };
  const listEl = { html: '', insertAdjacentHTML(_, h) { this.html += h; sheets.push(h); }, querySelectorAll: () => [], querySelector: () => null };
  const ctx = { document: { documentElement: root }, window: { WizCore: {} }, localStorage: { setItem() {} }, console, fetch: async () => ({ ok: false }) };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../web/core/chats-inboxrows.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(readFileSync(new URL('../web/core/chats-sent.js', import.meta.url), 'utf8'), ctx);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // The new Inbox's own row renderer (core/chats-inboxrows.js), the one Sent must share (James, 25 Nov 2026).
  const ib = ctx.window.WizCore.chatsParts.inboxrows({ AGS: () => ({ sigil: a => `<span class="ag-sig">${a.id}</span>`, defaultId: () => 'hermes' }), agentName: id => id || 'Wizard', agentRec: id => ({ id }),
    chanFace: n => n === 'family' ? { emoji: '👪', label: 'Family', own: true } : { emoji: '💬', label: n, own: false }, esc, LIVE });
  const closeRowSheet = () => { const had = !!chatVars.rowSheet; chatVars.rowSheet = null; return had; };
  const p = ctx.window.WizCore.chatsParts.sent({ ago: () => '3m', ch: id => CH[id], CH, CHAN_VIEW_KEY: 'k', chanElsewhere: () => false, chanSide: () => false, chatVars, clip: (s, n) => String(s).slice(0, n), closeRowSheet, elOf: () => listEl, esc, H: { win: id => W[id] },
    ibMark: ib.ibMark, ibRow: ib.ibRow, ibTagFace: ib.ibTagFace, LIVE, openChat: (wid, t) => opened.push([wid, t]), renderChatList: w => renders.push(w.id), rerenderList: w => renders.push(w.id), toast: (...a) => toasts.push(a), W, winAgent: w => agentOf[w.id] || '' });
  const click = (w, attrs) => p.sentClick({ target: { closest: sel => { for (const k of Object.keys(attrs)) if (k !== 'dataset' && sel === `[data-${k}]`) return { dataset: { [k]: attrs[k], ...(attrs.dataset || {}) }, disabled: false }; return null; } } }, w.id, w);
  return { p, W, CH, chatVars, root, state, renders, opened, corrections, toasts, sheets, listEl, click };
}
// What a row says: sender, time, his words, the line under them.
const said = row => row.replace(/<span class="ch-ib-av[^"]*"[^>]*>(?:<span[^>]*>[^<]*<\/span>|[^<]*)<\/span>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the row actions sheet: why it went there in plain words, Open chat, both corrections; a reply has none', async () => {
  const f = part({ rows: [view('a', { route: 'dump', decidedBy: 'owner_words', rules: ['no_reply:note to self'], state: 'running', thread: 'worker_a' }), view('b', { decidedBy: 'fallback', rules: ['router_timeout'] }), view('h', { route: 'thread', quiet: true, wantsReply: false, thread: 'thread_h' }), view('m'), view('k', { decidedBy: 'correction', corrected: { shouldReply: false, at: 1 } })] });
  const sheet = id => { f.listEl.html = ''; assert.equal(f.p.sentSheet('main', sid(id)), true); return f.listEl.html; };
  const why = h => /<p class="ch-sheet-n ch-sr-why">([^<]*)<\/p>/.exec(h)[1];
  const a = sheet('a');
  assert.match(a, /^<div class="ch-sheet" role="dialog" aria-label="Sent actions"><div class="ch-sheet-b"><div class="ch-sheet-t">Words a<\/div>/, 'the thread rows\' own sheet markup');
  assert.equal(why(a), 'Ran quietly because you said “note to self”.');
  assert.deepEqual([...a.matchAll(/data-rs(sentopen|sentfix="(\w+)")/g)].map(m => m[2] || m[1]), ['sentopen', 'reply', 'quiet']);
  assert.deepEqual(clone(f.chatVars.rowSheet), { wid: 'main', sent: sid('a'), trigger: null }, 'Escape and a tap outside close it like any row sheet');
  assert.equal(why(sheet('b')), 'Replied in chat because Wizard couldn’t decide (deciding took too long), so it took the safe way.');
  assert.equal(why(sheet('m')), 'Replied in chat because Wizard judged it from your words.');
  const k = sheet('k');
  assert.equal(why(k), 'Replied in chat because you corrected one like it before.');
  assert.match(k, /data-rssentfix="quiet" aria-pressed="true">[\s\S]*?Didn’t need a reply · your correction/, 'the correction he made stays marked');
  const h = sheet('h');
  assert.equal(why(h), 'Noted in its chat: nothing was needed from you, so it stayed out of Inbox.');
  assert.doesNotMatch(h, /data-rssentfix/, 'a reply in a thread has nothing to move');
  // Didn't need a reply from the sheet: the same correction as the card's button (false), then the row says Corrected.
  sheet('a');
  assert.equal(f.click(f.W.main, { rssentfix: 'quiet' }), true);
  await new Promise(r => setImmediate(r));
  assert.equal(f.chatVars.rowSheet, null, 'the sheet closes');
  sheet('b'); f.click(f.W.main, { rssentfix: 'reply' }); await new Promise(r => setImmediate(r));
  assert.deepEqual(clone(f.corrections), [[sid('a'), false], [sid('b'), true]], 'Didn\'t need a reply = false, Should have replied = true');
  assert.match(sheet('a'), /<small>3m · Ran quietly · Working · Corrected<\/small>/, 'its sends say Corrected');
  // Open chat from the sheet, and a tap on the row: the thread it ran in.
  sheet('h'); f.click(f.W.main, { rssentopen: '' }); await new Promise(r => setImmediate(r));
  f.click(f.W.main, { chsent: sid('a') }); await new Promise(r => setImmediate(r));
  assert.deepEqual(clone(f.opened), [['main', 'thread_h'], ['main', 'worker_a']]);
});

test('a sheet button without an open Sent sheet, or an unknown row, does nothing', async () => {
  const f = part({ rows: [view('a')] });
  assert.equal(f.click(f.W.main, { rssentfix: 'quiet' }), false, 'no Sent sheet open: not Sent\'s tap');
  assert.equal(f.p.sentSheet('main', sid('z')), false, 'an unknown row');
  assert.equal(f.p.sentSheet('main', sid('a')), true, 'no switch to read');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(f.corrections, []);
});

test('the switch is gone from the list, and Sent rows join the row actions (main versus routed lists)', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8'));
  assert.ok(!catalog.tweaks.includes(SW) && !(catalog.defaults || []).includes(SW));
  // The tabs (and so Sent rows) are the main agent's list only; a routed agent's list never draws them.
  const f = part({ rows: [view('a')] });
  assert.equal(f.p.sentTabsOn(f.W.main), true);
  for (const id of ['host-ops', 'box', 'locked']) assert.equal(f.p.sentTabsOn(f.W[id]), false, id);
  // The real ROW_MENU / rowMenu from core/chats-rowacts.js: a Sent row opens the Sent sheet, other rows what they did.
  const ctx = { window: { WizCore: { chatsParts: {} } } }; vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../web/core/chats-rowacts.js', import.meta.url), 'utf8'), ctx);
  const calls = [];
  const ra = ctx.window.WizCore.chatsParts.rowacts({ ACT: {}, ch: () => ({}), CH: {}, LIVE: {}, W: {}, H: {}, openChannelSheet: (...a) => calls.push(['chan', ...a]), openRowSheet: (...a) => calls.push(['row', ...a]), sentSheet: (...a) => calls.push(['sent', ...a]) });
  assert.match(ra.ROW_MENU, /\.ch-list \[data-chsent\]/);
  ra.rowMenu('main', { dataset: { chsent: sid('a') } });
  ra.rowMenu('main', { dataset: { chopen: 't1' } });
  ra.rowMenu('main', { dataset: { chchan: 'c1' } });
  assert.deepEqual(clone(calls.map(c => c.slice(0, 3))), [['sent', 'main', sid('a')], ['row', 'main', 't1'], ['chan', 'main', 'c1']]);
});

test('Smart inbox off (wizard-ux issue 1962): the sheet keeps why and Open chat, but no routing corrections, and a quiet reply does not say it stayed out of Inbox', () => {
  const f = part({ tweaks: '', rows: [view('a', { route: 'dump', decidedBy: 'owner_words', rules: ['no_reply:note to self'], thread: 'worker_a' }), view('h', { route: 'thread', quiet: true, wantsReply: false, thread: 'thread_h' })] });
  const sheet = id => { f.listEl.html = ''; assert.equal(f.p.sentSheet('main', sid(id)), true); return f.listEl.html; };
  const a = sheet('a');
  assert.match(a, /data-rssentopen/, 'Open chat');
  assert.doesNotMatch(a, /data-rssentfix|Should have replied|Didn’t need a reply/, 'no corrections');
  assert.match(a, /Ran quietly because you said “note to self”\./);
  assert.doesNotMatch(sheet('h'), /stayed out of Inbox/);
});
