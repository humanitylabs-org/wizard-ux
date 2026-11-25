// Sent rows (wizard-ux issue 1814, switch wizard/sent-rows, off by default): the real Chats part (core/chats-sent.js)
// on a stand-in Chats. With the switch on, Sent is one list of normal Chats rows under Working and Processed, with no
// back row or filter, plain words only, and the corrections in the row's actions sheet; with it off, today's Sent.
// Browser proof: tests/qa-chats-sent-rows.cjs (QA_SWITCH=off for the unchanged off path).
// Run: node --test tests/sent-rows.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = 'wizard/sent-rows';
const clone = v => JSON.parse(JSON.stringify(v));
const sid = c => 'sent_' + c.repeat(24);
const view = (c, extra = {}) => ({ id: sid(c), at: 1000, source: 'orb', text: 'Words ' + c, route: 'agent', decidedBy: 'model', rules: [], state: 'done', thread: 'thread_' + c, record: null, tags: [], urgent: false, wouldRoute: null, corrected: null, error: '', wantsReply: true, answer: '', quiet: false, ...extra });
const STI = { working: '<i class="spin"></i>', done: '<svg data-k="done"></svg>', needs: '<svg data-k="needs"></svg>', failed: '<svg data-k="failed"></svg>', none: '<i class="dot"></i>' };

function part({ tweaks = SW, rows = [], next = null } = {}) {
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
  vm.runInContext(readFileSync(new URL('../web/core/chats-sent.js', import.meta.url), 'utf8'), ctx);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const closeRowSheet = () => { const had = !!chatVars.rowSheet; chatVars.rowSheet = null; return had; };
  const p = ctx.window.WizCore.chatsParts.sent({ ago: () => '3m', ch: id => CH[id], CH, CHAN_VIEW_KEY: 'k', chanElsewhere: () => false, chanSide: () => false, chatVars, clip: (s, n) => String(s).slice(0, n), closeRowSheet, elOf: () => listEl, esc, H: { win: id => W[id] },
    LIVE, openChat: (wid, t) => opened.push([wid, t]), renderChatList: w => renders.push(w.id), rerenderList: w => renders.push(w.id), STI, STI_TIP: {}, toast: (...a) => toasts.push(a), W, winAgent: w => agentOf[w.id] || '' });
  const click = (w, attrs) => p.sentClick({ target: { closest: sel => { for (const k of Object.keys(attrs)) if (k !== 'dataset' && sel === `[data-${k}]`) return { dataset: { [k]: attrs[k], ...(attrs.dataset || {}) }, disabled: false }; return null; } } }, w.id, w);
  return { p, W, CH, chatVars, root, state, renders, opened, corrections, toasts, sheets, listEl, click };
}
const rowsOf = html => [...html.matchAll(/<div class="ch-row-wrap ch-sr-wrap"[\s\S]*?<\/button><\/div>/g)].map(m => m[0]);
// What a row says, once (the phone shows line 2 as the channel line, the other lists as the preview: same words).
const said = row => row.replace(/<span class="pv">[\s\S]*?<\/span><\/span>/, '</span>').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('switch off: Sent is today\'s cards, back row and All / Working pills, unchanged', () => {
  const f = part({ tweaks: 'wizard/desktop-chats', rows: [view('a', { state: 'running', route: 'dump' }), view('b')] });
  assert.equal(f.p.sentRowsOn(), false);
  assert.match(f.p.sentHead(f.W.main), /data-chsentback[\s\S]*data-chsentfilter="all"[\s\S]*data-chsentfilter="working"/);
  const body = f.p.sentBody(f.W.main);
  assert.match(body, /class="ch-sent-row st-running"[\s\S]*data-chsentfix="reply"/, 'the cards with their two buttons');
  assert.doesNotMatch(body, /ch-sr-row|data-chsent=/, 'none of the new rows');
  assert.equal(f.p.sentSheet('main', sid('a')), false, 'no actions sheet while off');
  assert.deepEqual(f.sheets, []);
});

test('switch on: no back row and no filter; Working then Processed under Inbox\'s section header; an empty section hides', () => {
  const f = part({ rows: [view('a', { state: 'running', route: 'dump' }), view('r', { state: 'routing', route: null }), view('b'), view('c', { state: 'failed' })] });
  assert.equal(f.p.sentRowsOn(), true);
  assert.equal(f.p.sentHead(f.W.main), '', 'the bottom tabs are the navigation: no "‹ Sent", no pills');
  const body = f.p.sentBody(f.W.main);
  const secs = [...body.matchAll(/<section class="ch-sec ch-act ch-sr open" data-sec="(\w+)"><button class="ch-sec-h" data-sectoggle="\1" aria-expanded="true"><span>(\w+)<\/span><small>(\d+)<\/small><i aria-hidden="true"><\/i><\/button>/g)].map(m => [m[1], m[2], +m[3]]);
  assert.deepEqual(secs, [['sentWorking', 'Working', 2], ['sentProcessed', 'Processed', 2]], 'Inbox\'s own foldable header markup');
  assert.doesNotMatch(body, /ch-sent-row|data-chsentfix|data-chsentfilter/, 'no cards, no inline corrections');
  const ids = [...body.matchAll(/data-chsent="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, [sid('a'), sid('r'), sid('b'), sid('c')], 'running first, then the finished ones, newest first in each');
  assert.doesNotMatch(part({ rows: [view('b')] }).p.sentBody(f.W.main), /Working/, 'nothing running: no Working header');
  assert.doesNotMatch(part({ rows: [view('a', { state: 'running' })] }).p.sentBody(f.W.main), /Processed/, 'nothing finished: no Processed header');
  f.chatVars.secOpen = { sentProcessed: false };
  assert.match(f.p.sentBody(f.W.main), /<section class="ch-sec ch-act ch-sr" data-sec="sentProcessed"><button class="ch-sec-h" data-sectoggle="sentProcessed" aria-expanded="false">[^]*?<\/button><\/section>/, 'folds like Inbox\'s sections');
  assert.match(part({ rows: [view('b')], next: sid('b') }).p.sentBody(f.W.main), /data-chsentmore>Show older/, 'older sends still load');
  const empty = part({ rows: [] }).p.sentBody(f.W.main);
  assert.match(empty, /<div class="ch-empty">Nothing sent yet\./, 'the empty state is today\'s .ch-empty text');
});

test('each row is a normal Chats row: status mark, first line + time, one plain line; never internal words', () => {
  const f = part({ rows: [
    view('a', { route: 'dump', decidedBy: 'owner_words', rules: ['no_reply:note to self'], state: 'running', text: 'Note to self: call mom\nsecond line' }),
    view('b', { decidedBy: 'owner_words', rules: ['wants_reply:tell me'] }),
    view('c', { source: 'typed', decidedBy: 'owner_words', rules: ['typed'], wouldRoute: 'dump' }),
    view('d', { route: 'dump', tags: ['family'], state: 'needs_you', text: 'Book <b>a table</b>' }),
    view('e', { decidedBy: 'fallback', rules: ['router_timeout'], state: 'failed' }),
    view('f', { route: 'reminder', urgent: true, corrected: { shouldReply: true, at: 1 } }),
    view('g', { route: 'command' }),
    view('h', { route: 'thread', quiet: true, wantsReply: false }),
    view('i', { route: null, state: 'routing' }), // still being routed: Working, under the running one
  ] });
  const rows = rowsOf(f.p.sentBody(f.W.main));
  assert.equal(rows.length, 9);
  for (const r of rows) {
    assert.match(r, /^<div class="ch-row-wrap ch-sr-wrap" data-morph-key="sent:sent_\w+"><button type="button" class="ch-row ch-sr-row st-\w+" data-chsent="sent_\w+" aria-haspopup="dialog" aria-keyshortcuts="Shift\+F10"/, 'the thread row markup');
    assert.match(r, /<span class="emo sti \w+"[^>]*>[\s\S]*?<\/span><span class="bd"><span class="tp"><b>[^<]*<\/b><time>3m<\/time><\/span><span class="ch-chan-line">[\s\S]*?<\/span><span class="pv">/, 'mark, then title + time, then line 2');
    assert.doesNotMatch(said(r), /\bThread\b|you typed it|would have|router|fallback|owner_words|no_reply|wants_reply|\bmodel\b|Background/, 'plain words only: ' + said(r));
  }
  const marks = rows.map(r => /class="emo sti (\w+)"/.exec(r)[1]);
  assert.deepEqual(marks, ['working', 'working', 'done', 'done', 'needs', 'failed', 'done', 'done', 'done'], 'spinner, check, hand, failure mark');
  assert.match(rows[0], /<span class="emo sti working"[^>]*><i class="spin"><\/i><\/span>/, 'the Activity status icon itself (STI)');
  assert.match(rows[0], /<span class="ch-act-ind"><i class="ch-spin" role="img" aria-label="Working"><\/i><\/span><\/button>/, 'and the phone list\'s marker');
  assert.match(rows[4], /<span class="ch-act-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you">/);
  assert.match(rows[5], /<span class="ch-act-ind"><i class="ch-chan-dot" role="img" aria-label="Failed">/);
  assert.match(rows[2], /<span class="ch-act-ind" aria-hidden="true"><\/span>/, 'an empty slot keeps titles in one column');
  assert.deepEqual(rows.map(said), [
    'Note to self: call mom 3m Ran quietly · Working',
    'Words i 3m Just sent · Working',
    'Words b 3m Replied in chat · Done',
    'Words c 3m Replied in chat · Done',
    'Book &lt;b&gt;a table&lt;/b&gt; 3m #family · Ran quietly · Needs you · in Inbox',
    'Words e 3m Replied in chat · Failed · in Inbox',
    'Words f 3m Set a reminder · Done · Urgent · Corrected',
    'Words g 3m Ran as a command · Done',
    'Words h 3m Noted in its chat · Done',
  ]);
  assert.match(rows[4], /<span class="ch-chan-tag">#family<\/span> · /, 'a tag uses the Inbox channel line\'s chip');
});

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
  assert.match(said(rowsOf(f.p.sentBody(f.W.main))[0]), /Ran quietly · Working · Corrected$/);
  // Open chat from the sheet, and a tap on the row: the thread it ran in.
  sheet('h'); f.click(f.W.main, { rssentopen: '' }); await new Promise(r => setImmediate(r));
  f.click(f.W.main, { chsent: sid('a') }); await new Promise(r => setImmediate(r));
  assert.deepEqual(clone(f.opened), [['main', 'thread_h'], ['main', 'worker_a']]);
});

test('a sheet button without an open Sent sheet, or the switch turned off, does nothing', async () => {
  const f = part({ rows: [view('a')] });
  assert.equal(f.click(f.W.main, { rssentfix: 'quiet' }), false, 'no Sent sheet open: not Sent\'s tap');
  f.root.dataset.tweaks = '';
  assert.equal(f.p.sentSheet('main', sid('a')), false);
  assert.equal(f.p.sentSheet('main', sid('z')), false, 'an unknown row');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(f.corrections, []);
});

test('the switch is listed, off by default, and Sent rows join the row actions (main versus routed lists)', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8'));
  assert.ok(catalog.tweaks.includes(SW) && !catalog.defaults.includes(SW));
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
