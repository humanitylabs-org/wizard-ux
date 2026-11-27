// Chats title bar (wizard-ux issue 1836, on for everyone; switch wizard/chats-title-bar removed): the real Chats part
// (core/chats-sent.js titleBarTab / titleBar) run on a stand-in Chats. Which list gets the bar (only the main
// agent's tabbed list, also the AI apps sidebar pane since issue 1966, never a routed agent's), what the bar says per tab, and Sent without
// a second "Sent" back row. Browser proof (phone + Classic desktop, two skins, sort from the filter sheet, search,
// no section row): tests/qa-chats-title-bar.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function part({ tweaks = '', side = false, elsewhere = false } = {}) {
  const CH = { main: {}, 'main::side': {}, 'host-ops': {}, box: {}, locked: {} }, chatVars = { chanView: 'activity' };
  const W = { main: { id: 'main', thread: null }, 'host-ops': { id: 'host-ops', thread: null }, box: { id: 'box', thread: null }, locked: { id: 'locked', thread: null } };
  const agentOf = { 'host-ops': 'host-profile', box: 'container', locked: 'restricted' };
  const state = { ok: true, rows: [], next: null };
  const LIVE = { sentLog: { state: () => state, fresh() {}, read: async () => state, more: async () => state, correct: async () => ({ changed: false }) }, onChange() {} };
  const ctx = { document: { documentElement: { dataset: { tweaks } } }, window: { WizCore: {}, addEventListener() {} }, localStorage: { setItem() {} }, CustomEvent: class {}, console };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../web/core/chats-sent.js', import.meta.url), 'utf8'), ctx);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const p = ctx.window.WizCore.chatsParts.sent({ ago: () => '3m', ch: id => CH[id], CH, CHAN_VIEW_KEY: 'k', chanElsewhere: () => elsewhere, chanSide: () => side, chatVars, clip: (s, n) => String(s).slice(0, n), elOf: () => ({}), esc, H: { win: id => W[id] },
    LIVE, openChat() {}, renderChatList() {}, rerenderList() {}, toast() {}, W, winAgent: w => agentOf[w.id] || '' });
  return { p, W, CH, chatVars };
}

test('no switch: the main list names its tab whatever tweaks are on, and the removed switch id changes nothing', () => {
  for (const tweaks of ['', 'wizard/desktop-chats', 'wizard/chats-title-bar']) assert.equal(part({ tweaks }).p.titleBarTab({ id: 'main', thread: null }), 'inbox', tweaks || '(none)');
});

test('the main list and the AI apps sidebar pane name their tab; a routed agent (host-profile, container, restricted) never gets it (main versus routed)', () => {
  const f = part();
  assert.equal(f.p.titleBarTab(f.W.main), 'inbox');
  f.chatVars.chanView = 'channels';
  assert.equal(f.p.titleBarTab(f.W.main), 'tags');
  f.CH.main.sent = true;
  assert.equal(f.p.titleBarTab(f.W.main), 'sent');
  for (const id of ['host-ops', 'box', 'locked']) assert.equal(f.p.titleBarTab(f.W[id]), '', `${id}: a routed agent's list keeps today's header`);
  assert.equal(part({ side: true }).p.titleBarTab({ id: 'main::side' }), '', 'the AI apps main column\'s feed window draws a feed, no bar');
  // wizard-ux issues 1966 / 1992: the AI apps sidebar pane (its channels open in the main column) is the phone's list,
  // with the same bar its tabs drive
  const pane = part({ side: true, elsewhere: true });
  assert.equal(pane.p.titleBarTab({ id: 'main::side' }), 'inbox', 'the sidebar pane names its tab like the phone');
  pane.chatVars.chanView = 'channels'; assert.equal(pane.p.titleBarTab({ id: 'main::side' }), 'tags');
});

test('the bar: the tab title, the Inbox count pill, search and filter icons; Sent has no search', () => {
  const { p } = part();
  const inbox = p.titleBar('inbox', { n: 16 });
  assert.match(inbox, /<h2 class="ch-tbar-t"><span>Inbox<\/span><small class="ch-tbar-n"[^>]*>16<\/small><\/h2>/);
  assert.match(inbox, /data-chtbsearch/);
  assert.match(inbox, /class="ch-tbar-b ch-fbtn" data-chfbtn/);
  assert.ok(!/All chats/.test(inbox));
  assert.ok(!/ch-tbar-n/.test(p.titleBar('inbox', { n: 0 })), 'an empty Inbox has no pill');
  const tags = p.titleBar('tags', { n: 16 });
  assert.match(tags, /<span>Tags<\/span><\/h2>/, 'the count is Inbox\'s only');
  const sent = p.titleBar('sent', { tools: false });
  assert.match(sent, /<span>Sent<\/span>/);
  assert.ok(!/data-chtbsearch|data-chfbtn/.test(sent), 'Sent\'s log has no search or filter');
  assert.match(p.titleBar('inbox', { searching: true, filtered: true, sheet: true }), /ch-tbar-b on" data-chtbsearch[^>]*aria-pressed="true"[\s\S]*ch-fbtn on" data-chfbtn[^>]*aria-expanded="true"/);
});

test('Sent under the bar: no "Sent" back row and no filter (Sent has none at all since wizard-ux issue 1814)', () => {
  for (const side of [false, true]) {
    const f = part({ side });
    f.CH.main.sent = true;
    assert.equal(f.p.sentHead, undefined, 'no Sent head to draw, with or without the bar');
    assert.ok(!/data-chsentback|data-chsentfilter/.test(f.p.sentBody(f.W.main)), 'no back row and no filter');
  }
});
