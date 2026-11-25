// Chats title bar (wizard-ux issue 1836, switch wizard/chats-title-bar, off by default): the real Chats part
// (core/chats-sent.js titleBarTab / titleBar / sentHead) run on a stand-in Chats. Which list gets the bar (only the main
// agent's tabbed list, never a routed agent's or the AI apps sidebar pane), what the bar says per tab, and Sent without
// a second "Sent" back row. Browser proof (phone + Classic desktop, two skins, sort from the filter sheet, search,
// byte-identical list with the switch off): tests/qa-chats-title-bar.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = 'wizard/chats-title-bar';
function part({ tweaks = '', side = false } = {}) {
  const CH = { main: {}, 'host-ops': {}, box: {}, locked: {} }, chatVars = { chanView: 'activity' };
  const W = { main: { id: 'main', thread: null }, 'host-ops': { id: 'host-ops', thread: null }, box: { id: 'box', thread: null }, locked: { id: 'locked', thread: null } };
  const agentOf = { 'host-ops': 'host-profile', box: 'container', locked: 'restricted' };
  const state = { ok: true, rows: [], next: null };
  const LIVE = { sentLog: { state: () => state, fresh() {}, read: async () => state, more: async () => state, correct: async () => ({ changed: false }) }, onChange() {} };
  const ctx = { document: { documentElement: { dataset: { tweaks } } }, window: { WizCore: {}, addEventListener() {} }, localStorage: { setItem() {} }, CustomEvent: class {}, console };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../web/core/chats-sent.js', import.meta.url), 'utf8'), ctx);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const p = ctx.window.WizCore.chatsParts.sent({ ago: () => '3m', ch: id => CH[id], CH, CHAN_VIEW_KEY: 'k', chanElsewhere: () => false, chanSide: () => side, chatVars, clip: (s, n) => String(s).slice(0, n), elOf: () => ({}), esc, H: { win: id => W[id] },
    LIVE, openChat() {}, renderChatList() {}, rerenderList() {}, toast() {}, W, winAgent: w => agentOf[w.id] || '' });
  return { p, W, CH, chatVars };
}

test('switch off: no list gets the title bar', () => {
  const f = part({ tweaks: 'wizard/desktop-chats wizard/inbox-rows' });
  for (const id of Object.keys(f.W)) assert.equal(f.p.titleBarTab(f.W[id]), '', id);
});

test('switch on: the main list names its tab; a routed agent (host-profile, container, restricted) and the AI apps sidebar pane never get it (main versus routed)', () => {
  const f = part({ tweaks: 'wizard/desktop-chats ' + SW });
  assert.equal(f.p.titleBarTab(f.W.main), 'inbox');
  f.chatVars.chanView = 'channels';
  assert.equal(f.p.titleBarTab(f.W.main), 'tags');
  f.CH.main.sent = true;
  assert.equal(f.p.titleBarTab(f.W.main), 'sent');
  for (const id of ['host-ops', 'box', 'locked']) assert.equal(f.p.titleBarTab(f.W[id]), '', `${id}: a routed agent's list keeps today's header`);
  assert.equal(part({ tweaks: SW, side: true }).p.titleBarTab({ id: 'main::side' }), '', 'the AI apps sidebar pane draws its own header');
});

test('the bar: the tab title, the Inbox count pill, search and filter icons; Sent has no search', () => {
  const { p } = part({ tweaks: SW });
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

test('Sent under the bar: no second "Sent" back row; without the bar the back row stays', () => {
  const f = part({ tweaks: SW });
  f.CH.main.sent = true;
  const titled = f.p.sentHead(f.W.main, true), plain = f.p.sentHead(f.W.main);
  assert.ok(!/data-chsentback/.test(titled), 'no back row under the title bar');
  assert.match(titled, /data-chsentfilter="working"/, 'the All / Working filter stays');
  assert.match(plain, /data-chsentback[\s\S]*<b>Sent<\/b>/, 'switch off: today\'s back row');
  assert.equal(plain, f.p.sentHead(f.W.main, false));
});
