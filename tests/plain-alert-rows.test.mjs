// Alerts as chat rows (wizard-ux issue 1941, switch wizard/plain-alert-rows, off by default): a Chats alert (a
// Notifications item routed to Chats) is drawn as the thread row around it, marked only by a small bell before its
// source name; no amber card, yellow tile, pill or time. Runs the real chats-inboxrows.js part (Inbox rows on) and the
// real chats-notes.js part (the classic list). Switch off: exactly today's rows.
// Browser proof: tests/qa-chats-plain-alert-rows.cjs (phone + Classic desktop, two skins, QA_ROWS=off, QA_SWITCH=off).
// Run: node --test tests/plain-alert-rows.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SW = 'wizard/plain-alert-rows', NOW = Date.now();
const M = modelContext({}).WizChatsListModel;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clip = (s, n) => String(s).slice(0, n);
const notePlain = t => String(t || '').replace(/[*`#>]/g, '').replace(/\s+/g, ' ').trim();
const ALERT = { id: 'n1', title: 'System alert', message: 'The nightly **backup** did not finish.', time: NOW / 1000 - 300, priority: 4, read: false };
const FYI = ['a', 'b'].map((k, i) => ({ id: 'f' + k, title: 'FYI ' + k, message: 'Note ' + k, time: NOW / 1000 - 600 - i, priority: 3, read: false }));
const GROUP = { ...FYI[0], group: 'notifications', items: FYI };
const SNOOZED = { id: 's1', title: 'Update ready', message: 'Tonight', time: NOW / 1000 - 7200, priority: 4, read: true };
const APP = { id: 'p1', title: 'New event', message: 'Lunch at 1', time: NOW / 1000 - 60, priority: 3, read: false, app: 'wizard-calendar', appName: 'Calendar' };

function ctxWith(tweaks) {
  const ctx = vm.createContext({ console, Date, Promise, String, Number, Set, Map, Array, Object, JSON, setTimeout });
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.document = { documentElement: { dataset: { tweaks } } };
  ctx.WizChatsListModel = M; ctx.WizCore = { chatsParts: {} };
  ctx.WosBell = { icon: '<svg class="bell"></svg>' };
  ctx.WizSigil = { html: meta => `<span class="sgi">${meta.id}</span>` };
  return ctx;
}
/* The real chats-notes.js part (noteRow, noteSrcName, ...), as chats.js gets it. */
function notes(tweaks) {
  const ctx = ctxWith(tweaks);
  vm.runInContext(read('web/core/chats-notes.js'), ctx);
  const n = ctx.WizCore.chatsParts.notes({ ago: () => '5m', clip, esc, LIVE: {}, stiKind: () => '', withNotes: () => '' });
  n.bindLate({ snoozeLast: () => false });
  return { n, ctx };
}
/* The real chats-inboxrows.js part with the real notes part's helpers. */
function inbox(tweaks) {
  const { n, ctx } = notes(tweaks);
  vm.runInContext(read('web/core/chats-inboxrows.js'), ctx);
  const acts = [];
  const LIVE = { quietReply: () => false, cardAt: () => new Date(NOW).toISOString(), workGroups: rows => ({ working: [], ready: rows, deferred: [], archive: [] }), agentInbox: { needs: () => [] } };
  const api = ctx.WizCore.chatsParts.inboxrows({
    actMark: () => '', actNeeds: () => false, actUnread: () => false,
    AGS: () => ({ sigil: a => `<span class="ag-sig">${a.id}</span>`, defaultId: () => 'hermes' }), agentName: id => id || 'Wizard', agentRec: id => ({ id }),
    ago: () => '5m', attOf: () => null, chanAt: () => NOW, chanFace: nm => ({ emoji: '💬', label: nm, own: false }), chanStore: () => ({ channels: [] }),
    chatVars: { readyOrder: 'newest', secOpen: { snoozed: true } }, ch: () => ({}), clip, elOf: () => null, esc, isWorking: () => false, LIVE,
    noteAt: n.noteAt, noteIcon: n.noteIcon, notePlain: n.notePlain, noteRow: n.noteRow, noteRowAct: (...a) => acts.push(a), noteSrcName: n.noteSrcName,
    renderChatList: () => {}, rowAgent: () => 'hermes', spacesOf: () => [], threadAct: () => {}, toast: () => {}, W: {}, winAgent: () => '',
  });
  return { api, n, acts, ctx };
}
const body = (api, awake, later = []) => api.inboxRowsBody({ id: 'w' }, [{ id: 't1', title: 'Weather', status: 'completed', preview: 'Sunny' }], { awake, later });
const wrapOf = (html, id) => (new RegExp(`<div class="([^"]*)" data-morph-key="[^"]*"><button[^>]*data-chnotif="${id}"[\\s\\S]*?</button>(?:<button[^>]*class="ch-ib-arch"[^>]*>[\\s\\S]*?</button>)?</div>`).exec(html) || [])[0] || '';

test('Inbox rows, switch on: an alert is the thread row (avatar, bell + source, title, preview, time, dot, Archive)', () => {
  const { api } = inbox(`wizard/desktop-chats ${SW}`);
  const html = body(api, [ALERT, GROUP, APP], [SNOOZED]);
  const a = wrapOf(html, 'n1');
  assert.match(a, /^<div class="ch-row-wrap ch-ib-wrap ch-al-wrap"/, 'the thread row wrap, not the amber card');
  assert.doesNotMatch(html, /ch-notif-wrap|ch-notif-from|ch-notif-ic/, 'no amber card, pill or tile anywhere');
  assert.match(a, /<button type="button" data-part="thread-row" class="ch-row ch-ib-row ch-notif-row needs" data-chnotif="n1"/, 'same row button, still an alert row (open, Alert actions)');
  assert.match(a, /aria-haspopup="dialog" aria-keyshortcuts="Shift\+F10"/);
  assert.match(a, /<span class="ch-ib-av ch-ib-ag"[^>]*><span class="ag-sig">hermes<\/span>/, 'avatar: the agent\'s mark');
  assert.match(a, /<span class="ch-ib-from"><span class="ch-al-mk"[^>]*><svg[^]*?<\/svg><\/span>Wizard<\/span><time>5m<\/time>/, 'label line: the bell, then the source, then the time');
  assert.match(a, /<b class="ch-ib-t">System alert<\/b><span class="ch-ib-mk"><i class="ch-chan-dot"/, 'bold title + the needs-you dot');
  assert.match(a, /<span class="ch-ib-pv">The nightly backup did not finish\.<\/span>/, 'one preview line of the message');
  assert.match(a, /class="ch-ib-arch" data-chibnote="n1"/, 'Archive button');
  const g = wrapOf(html, 'fa');
  assert.match(g, /data-chnotif-group="notifications"/);
  assert.match(g, /<span class="ch-al-n"[^>]*>2<\/span><span class="ch-ib-mk"><i class="ch-chan-dot new"/, 'folded: its count, then the unread dot');
  assert.match(g, /data-chibnote="fa fb"/, 'the folded row archives every alert in it');
  assert.match(wrapOf(html, 'p1'), /<span class="ch-ib-av ch-al-av"[^>]*><span class="sgi">wizard-calendar<\/span>/, 'an app\'s alert: the app\'s mark as the avatar');
  const s = wrapOf(html, 's1');
  assert.match(s, /ch-al-wrap later/, 'snoozed');
  assert.match(s, /class="ch-row ch-ib-row ch-notif-row" data-chnotif="s1"/, 'snoozed: a read row (no unread, no needs)');
  assert.match(s, /class="ch-al-mk"/, 'snoozed keeps the bell');
  assert.doesNotMatch(s, /ch-chan-dot/, 'snoozed: no dot');
});

test('Inbox rows, switch on: the row\'s Archive archives the alert, or all of a folded row', () => {
  const { api, acts } = inbox(SW);
  const tap = v => ({ target: { closest: sel => sel === '[data-chibnote]' ? { dataset: { chibnote: v } } : null } });
  assert.equal(api.inboxRowsClick(tap('n1'), { id: 'w' }), true);
  assert.equal(api.inboxRowsClick(tap('fa fb'), { id: 'w' }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(acts)), [['n1', 'done', ['n1']], ['fa', 'done', ['fa', 'fb']]]);
});

test('Inbox rows, switch off: the alert is today\'s row, byte for byte', () => {
  const { api, n } = inbox('wizard/desktop-chats');
  const html = body(api, [ALERT, GROUP], [SNOOZED]);
  for (const it of [ALERT, GROUP, SNOOZED]) assert.ok(html.includes(n.noteRow(it)), 'today\'s noteRow for ' + it.id);
  assert.match(n.noteRow(ALERT), /^<div class="ch-row-wrap ch-notif-wrap"/);
  assert.doesNotMatch(html, /ch-al-|data-chibnote/);
});

test('classic list, switch on: a chat row with the bell + source in its line; switch off unchanged', () => {
  const on = notes(SW).n, off = notes('').n;
  const a = on.noteRow(ALERT);
  assert.match(a, /^<div class="ch-row-wrap ch-al-wrap" data-morph-key="notif:n1"><button type="button" class="ch-row ch-notif-row ch-al-row unread" data-chnotif="n1"/);
  assert.doesNotMatch(a, /ch-notif-wrap|ch-notif-from|ch-notif-ic/);
  assert.match(a, /<span class="emo sti ch-al-ic" aria-hidden="true"><svg class="bell"><\/svg><\/span>/, 'the bell in the status tile every chat row has');
  assert.match(a, /<span class="tp"><b>System alert<\/b><time>5m<\/time><\/span><span class="ch-chan-line ch-al-from"><span class="ch-al-mk"[^]*?<\/span>Wizard<\/span><span class="pv"><span class="ch-chan-tag ch-al-from"><span class="ch-al-mk"[^]*?<\/span>Wizard<\/span> · The nightly backup did not finish\.<\/span>/, 'the source where a thread names its channel (phone line, desktop preview)');
  assert.match(on.noteRow(GROUP), /<span class="ch-al-n">2<\/span>/, 'folded count kept');
  assert.match(a, /<span class="ch-act-ind"><i class="ch-chan-dot" role="img" aria-label="Needs you"><\/i><\/span><\/button><\/div>$/, 'needs-you dot where a thread has its dot');
  assert.match(on.noteRow(GROUP), /<i class="ch-chan-dot new" role="img" aria-label="Unread">/, 'unread dot');
  assert.match(on.noteRow(SNOOZED), /<span class="ch-act-ind" aria-hidden="true"><\/span><\/button>/, 'snoozed: the empty dot slot, like a read thread');
  assert.match(on.noteRow(SNOOZED), /ch-al-wrap later[^]*ch-al-row deferred/, 'snoozed reads as a read (deferred) row');
  // Off: the amber row exactly as before (the same function, nothing else changes).
  assert.match(off.noteRow(ALERT), /^<div class="ch-row-wrap ch-notif-wrap" data-morph-key="notif:n1"><button type="button" class="ch-row ch-notif-row unread" data-chnotif="n1"/);
  assert.match(off.noteRow(ALERT), /<span class="ch-notif-from">Wizard<\/span>/);
});

