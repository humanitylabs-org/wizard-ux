// The Chats row menu (openRowSheet in web/core/chats.js) run in node:vm with small stubs for what it reads, so a
// test sees the real sheet an owner gets on right-click, long-press or swipe (wizard-ux issue 1674).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './chats-parts.mjs';
import { between } from './source-slice.mjs';

const src = withParts(readFileSync(new URL('../../web/core/chats.js', import.meta.url), 'utf8'));
export const chatsSource = src;

// rows: thread rows by id; pinned: ids; spaces: { sid: [{ id, name }] }; channels: SPACE.ch (Channels on).
export function rowSheet({ rows = { t1: { id: 't1', title: 'Plans', status: 'completed' } }, pinned = [], spaces = {}, channels = true,
  pinsOn = true, actions = ['snooze', 'done'] } = {}) {
  let html = '';
  const el = { insertAdjacentHTML: (_, h) => { html += h; }, querySelectorAll: () => [], querySelector: () => ({ focus() {} }) };
  const ctx = {
    rowOf: (wid, sid) => rows[sid] || null, track: { querySelector: () => el }, closeRowSheet: () => { html = ''; },
    esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    rowActions: () => actions, PIN: { on: () => pinsOn, has: id => pinned.includes(id) }, PIN_SVG: '', RENAME_SVG: '', MARK_DONE_SVG: '', INBOX_SVG: '',
    SPACE: { one: 'Space', many: 'Spaces', ch: channels }, spacesOf: sid => spaces[sid] || [], topicOn: () => false, TOPIC: { get: () => '' },
    subjectOf: () => '', ACT: { snooze: { icon: '' }, done: { icon: '' }, restore: { icon: '' } }, NOTE_ACT: {}, actionLabel: (s, a) => ({ snooze: 'Snooze', done: 'Archive', restore: 'Restore' }[a] || a),
    isWorking: () => false, vib() {}, window: { WizConfig: { agent: () => 'Wizard' } }, canMarkDone: () => false, inboxCanSend: () => false,
    noteSiblings: () => [], noteSrcName: () => '', notePlain: s => String(s?.title ?? s ?? ''), rowSheet: null };
  vm.createContext(ctx);
  vm.runInContext(`${between(src, '  function openRowSheet(wid, sid, nid = \'\') {', '  const emojiCategoryHtml')}\nthis.open = openRowSheet;`, ctx);
  const buttons = () => [...html.matchAll(/<button type="button" ([^>]*)>(.*?)<\/button>/g)].map(m => ({ attrs: m[1], label: m[2].split(/<[^>]*>/).join('') }));
  return { ctx, open: (sid, nid) => { html = ''; ctx.open('w1', sid, nid); return html; }, html: () => html, buttons };
}
