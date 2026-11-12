import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ux#1319: the agent writes its whole answer in a message that also carries a tool call (a notes patch), then ends
// the turn with a short postscript. The answer must stay the visible reply, never fold into the work log.
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ctx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
ctx.window = ctx; modelContext(ctx); vm.runInContext(read('web/core/chat-kit.js'), ctx);
const KIT = ctx.WosChat;
const answer = `Here is the full answer.\n\n${Array.from({ length: 400 }, (_, i) => `point${i}`).join(' ')}`;
const ps = 'The reply above stands as written; I saved it to your notes.';
const call = [{ id: 'c1', function: { name: 'patch', arguments: '{}' } }];
const turn = rows => KIT.parseRows([{ role: 'user', timestamp: 1, content: 'Tell me' }, ...rows]).at(-1);

test('a long answer sent with a tool call stays the reply when a short postscript ends the turn', () => {
  const t = turn([{ role: 'assistant', timestamp: 2, content: answer, tool_calls: call },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, id: 9, content: ps }]);
  assert.equal(t.a.text, `${answer}\n\n${ps}`);
  assert.equal(t.a.plainText, `${answer}\n\n${ps}`);
  assert.equal(t.a.final, true);
  assert.equal(t.a.id, 9);
  assert.equal(t.a.at, 4000);
  assert.ok(!t.notes.includes(answer), 'the answer is no longer only in the work log');
  assert.equal(t.said, undefined);
});

test('short interim lines still go to the work log; a long final reply is unchanged', () => {
  const t = turn([{ role: 'assistant', timestamp: 2, content: 'Let me check your notes.', tool_calls: call },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, content: ps }]);
  assert.equal(t.a.text, ps);
  assert.deepEqual([...t.notes], ['Let me check your notes.']);
  const t2 = turn([{ role: 'assistant', timestamp: 2, content: answer, tool_calls: call },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, content: `${answer} (revised)` }]);
  assert.equal(t2.a.text, `${answer} (revised)`);
  assert.deepEqual([...t2.notes], [answer]);
});

test('mid-run (last message still has a tool call) nothing is lifted', () => {
  const t = turn([{ role: 'assistant', timestamp: 2, content: answer, tool_calls: call },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, content: 'One more step.', tool_calls: [{ id: 'c2', function: { name: 'patch' } }] }]);
  assert.equal(t.a.text, 'One more step.');
  assert.deepEqual([...t.notes], [answer]);
});

test('commentary is never lifted into the reply', () => {
  const t = turn([{ role: 'assistant', timestamp: 2, display_kind: 'commentary', content: answer },
    { role: 'assistant', timestamp: 4, content: ps }]);
  assert.equal(t.a.text, ps);
});

test('inline images of both messages stay placed when their markers collide', () => {
  const env = (id) => `<helm_attachments>${JSON.stringify({ inline: true, items: [{ id, name: 'shot.png', mime: 'image/png' }] })}</helm_attachments>`;
  const idA = 'a'.repeat(32), idB = 'b'.repeat(32);
  const t = turn([{ role: 'assistant', timestamp: 2, content: `${answer}\n\n${env(idA)}`, tool_calls: call },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, content: `${ps}\n\n${env(idB)}` }]);
  const media = { ...t.a.inlineMedia };
  assert.equal(Object.keys(media).length, 2);
  assert.deepEqual(new Set(Object.values(media)), new Set([`/wizard/attachments/${idA}`, `/wizard/attachments/${idB}`]));
  const placed = [];
  KIT.md(t.a.text, (url, marker) => { if (t.a.inlineMedia[marker] === url) placed.push(url); return ''; });
  assert.equal(placed.length, 2, 'both images placed inline');
});

// Agent chat parity (AGENTS.md; wizard-agent-service qa/agent-parity/features.json "chat-answer-postscript"): the same
// history in a main thread and in host-profile, container and restricted routed threads shows the same answer.
const ROUTES = { main: ['wizard_1793157258294_34b4a71ae61a', ''], 'host-profile': ['20261028_101500_ab12cd', 'qa-host-profile'],
  container: ['agent-research:20261028_101501_ef34', 'agent-research'], restricted: ['restricted.vault_20261028-101502', 'restricted.vault'] };
const chats = read('web/core/chats.js');
const line = start => { const a = chats.indexOf(start); assert.ok(a >= 0, start); return chats.slice(a, chats.indexOf('\n', a) + 1); };
const slice = (start, end) => { const a = chats.indexOf(start), b = chats.indexOf(end, a); assert.ok(a >= 0 && b > a, `${start} .. ${end}`); return chats.slice(a, b); };
function turnHtml(tn) {
  const c = { getComputedStyle: () => ({ getPropertyValue: () => '' }), document: { documentElement: {} }, window: { WizConfig: { agent: () => 'Fixture' } },
    KIT: { time: { full: String, stamp: String } }, esc: KIT.esc, md: KIT.md, PW: null, replyCard: () => '', msgIds: () => '', quoteBtn: () => '',
    userMedia: () => '', mediaBlock: () => '', clip: s => s, CHECK_SVG: '', COPY_SVG: '', SHARE_SVG: '', noteHtml: () => '', runContextHtml: () => '' };
  modelContext(c);
  vm.runInContext(`${['  const regenOn = ', '  const summaryOn = ', '  const SUMMARY_WORDS = ', '  const summaryOf = ', '  const summaryStartsOpen = ', '  const leadText = ', '  const COG_SVG = ', '  const CHEV_SVG = ', '  const timeTag = '].map(line).join('')}${slice('  function turnHtml(', '  const turnAt = ')}this.turnHtml = turnHtml;`, c);
  return c.turnHtml({ texts: [] }, tn, true, false, null, null);
}
test('parity: main and routed threads (host-profile, container, restricted) show the answer, not only the postscript', () => {
  const seen = new Map();
  for (const [kind, [sid, agent]] of Object.entries(ROUTES)) {
    const history = [{ role: 'user', timestamp: 1, content: 'Tell me' }, { role: 'assistant', timestamp: 2, content: answer, tool_calls: call },
      { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' }, { role: 'assistant', timestamp: 4, content: ps }]
      .map(r => ({ ...r, session_id: sid, ...(agent ? { agent } : {}) }));
    const tn = KIT.parseRows(history).at(-1);
    const html = turnHtml(tn);
    const log = (html.match(/<details class="steps[\s\S]*?<\/details>/) || [''])[0];
    assert.ok(html.includes('point399'), `${kind}: answer rendered`);
    assert.ok(!log.includes('point399'), `${kind}: answer not in the work log`);
    assert.ok(html.indexOf('point399') < html.indexOf('stands as written'), `${kind}: postscript under the answer`);
    seen.set(kind, html);
  }
  assert.equal(new Set(seen.values()).size, 1, 'byte-identical turn for every runtime kind');
});
