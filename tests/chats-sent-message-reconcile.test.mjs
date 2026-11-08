import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const ctx = { window: { WizConfig: { agent: () => 'Archimedes' } }, document: {}, PW: { workHtml: () => '' }, replyCard: () => '', userMedia: () => '<i>Voice note</i>', md: s => s, timeTag: () => '', summaryOf: () => null, mediaBlock: () => '', regenOn: () => false, esc: s => s, COPY_SVG: '', SHARE_SVG: '', CHECK_SVG: '' };
vm.runInNewContext(readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8'), ctx);
vm.runInNewContext(src.slice(src.indexOf('function echoed(turns, p)'), src.indexOf('function retireLanded')), ctx);
vm.runInNewContext(src.slice(src.indexOf('function runContextHtml('), src.indexOf('const turnAt =')), ctx);
const { parseRows } = ctx.window.WosChat;
const at = 1793856846181, text = 'No dialogue. I double clicked it. It changed the focus and absolutely nothing happened.';
const file = { id: 'drop_voice_fixture', filename: 'voice.webm', mime: 'audio/webm' };
const p = { id: 'wos-fixture', state: 'sent', text, files: [file], sentAt: at + 22000, createdAt: at - 1000, userMessageId: 91, attempts: 1, runId: 'run-fixture' };
const user = { id: 91, role: 'user', timestamp: at / 1000, content: `${text}\n\n[WIZARD_FILE_CHIPS_V1]\n${JSON.stringify([file])}\n[/WIZARD_FILE_CHIPS_V1]` };
const reply = { id: 92, role: 'assistant', timestamp: (at + 310000) / 1000, content: 'That exposed no visible error.', finish_reason: 'stop' };
function paint(turns, pending) {
  const visible = ctx.reconcileSent(turns, pending);
  const remaining = pending.filter(p => !ctx.localSent(visible, p) && !ctx.echoed(visible, p));
  return { visible, html: visible.map((t, i) => ctx.turnHtml({ texts: [], media: [] }, t, i === visible.length - 1, false)).join('') + remaining.map(() => 'Sent Dismiss').join('') };
}
test('stored voice user turn is above its reply with no Sent/Dismiss or unavailable card', () => {
  const turns = parseRows([user, reply]);
  assert.equal(ctx.echoed(turns, p), true);
  const { html, visible } = paint(turns, [p]);
  assert.ok(html.indexOf(text) < html.indexOf(reply.content), JSON.stringify({ html, visible }));
  assert.ok(!/Sent|Dismiss|Started without|isn’t available/.test(html));
  assert.equal(turns[0].u.id, 91);
});
test('missing coalesced row retains accepted local words in the run timeline until history recovers', () => {
  const turns = parseRows([{ role: 'assistant', timestamp: at / 1000, tool_calls: [{ function: { name: 'read_file' } }], content: '' }, reply]);
  const before = JSON.stringify(turns);
  const { html, visible } = paint(turns, [p]);
  assert.ok(html.indexOf(text) < html.indexOf(reply.content), JSON.stringify({ html, visible }));
  assert.ok(!/Sent|Dismiss|Started without|isn’t available/.test(html));
  assert.equal(visible[0].u.localId, p.id);
  assert.equal(ctx.echoed(visible, { ...p, steered: false }), false, 'display copy cannot retire its durable original');
  assert.equal(JSON.stringify(turns), before, 'cached history is not mutated');
  assert.equal(paint(parseRows([user, reply]), [p]).visible.filter(t => t.u).length, 1);
});
test('accepted mid-run voice steering renders between the original request and answer', () => {
  const turns = parseRows([{ ...user, id: 90, timestamp: (at - 60000) / 1000, content: 'Original request' }, reply]);
  const { html, visible } = paint(turns, [{ ...p, steered: true }]);
  assert.ok(html.indexOf('Original request') < html.indexOf(text));
  assert.ok(html.indexOf(text) < html.indexOf(reply.content));
  assert.ok(!/Sent|Dismiss/.test(html));
  assert.equal(visible[0].steers[0].localId, p.id);
});
test('known local voice replaces the missing-start card after an earlier final answer', () => {
  const turns = parseRows([{ ...user, id: 90, timestamp: (at - 60000) / 1000, content: 'Earlier request' }, { ...reply, timestamp: (at - 30000) / 1000 }, { role: 'assistant', timestamp: at / 1000, content: '', tool_calls: [{ function: { name: 'read_file' } }] }, reply]);
  assert.ok(turns[1].later);
  const { html, visible } = paint(turns, [p]);
  assert.ok(!/Sent|Dismiss|Started without|isn’t available/.test(html), JSON.stringify({html,visible}));
  assert.ok(html.indexOf(text) < html.lastIndexOf(reply.content));
});
test('stable client identity survives text changes; server message identity wins over clock differences', () => {
  const turns = parseRows([{ ...user, content: 'Transcription normalized by server', client_message_id: p.id }]);
  assert.equal(ctx.echoed(turns, { ...p, userMessageId: null }), true);
  assert.equal(ctx.echoed(parseRows([{ ...user, timestamp: at / 1000 - 500 }]), p), true);
});
test('fallback normalizes transcript whitespace and requires all attachments inside the time window', () => {
  const legacy = { ...p, userMessageId: null };
  assert.equal(ctx.echoed(parseRows([{ ...user, id: 100, content: user.content.replace('No dialogue.', 'No  dialogue.\n') }]), legacy), true);
  assert.equal(ctx.echoed(parseRows([{ ...user, id: 100, timestamp: at / 1000 - 1000 }]), legacy), false);
  assert.equal(ctx.echoed(parseRows([{ ...user, id: 100 }]), { ...legacy, files: [file, { id: 'second' }] }), false);
  assert.equal(ctx.echoed(parseRows([{ ...user, id: 100, content: user.content.replace('absolutely nothing happened.', 'something else happened.') }]), legacy), false);
});
test('matching searches full history rather than only the final six turns', () => {
  const rows = [user, reply, ...Array.from({ length: 8 }, (_, i) => [{ role: 'user', timestamp: at / 1000 + 500 + i, content: 'Other request ' + i }, { ...reply, timestamp: at / 1000 + 501 + i }]).flat()];
  assert.equal(ctx.echoed(parseRows(rows), p), true);
});
test('unsent, failed, queued steers and reconnect-held sends keep recovery controls', () => {
  const turns = parseRows([reply]);
  for (const state of ['queued', 'failed', 'held', 'sending']) assert.equal(ctx.reconcileSent(turns, [{ ...p, state }]).some(t => t.u?.localId), false);
  assert.equal(ctx.reconcileSent(turns, [{ ...p, steerQueued: true }]).some(t => t.u?.localId), false);
  assert.equal(ctx.reconcileSent(turns, [p], { reconnect: { runId: p.runId } }).some(t => t.u?.localId), false);
});
