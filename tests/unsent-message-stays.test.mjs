import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// 9 Nov 2026 (James): "The message I sent is disappearing and being lost." A message Hermes never took in (three
// resends that never started, a gateway restart, a thread another app owns) is served by the Agent Service as a user
// row marked wizard_queue.status = failed. It must show as his message, marked Not sent, with Retry; and once Retry
// lands it, the thread shows it once, never twice (this phone's retry copy plus Wizard's copy).
const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const ctx = { window: { WizConfig: { agent: () => 'Archimedes' } }, document: {}, PW: { workHtml: () => '' }, replyCard: () => '', userMedia: (c, files) => (files || []).map(f => `<i data-file="${f.id}">${f.filename}</i>`).join(''), md: s => s, timeTag: () => '', summaryOf: () => null, mediaBlock: () => '', regenOn: () => false, esc: s => s, quoteBtn: () => '', msgIds: () => '', COPY_SVG: '', SHARE_SVG: '', CHECK_SVG: '' };
vm.runInNewContext(readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8'), ctx);
vm.runInNewContext(src.slice(src.indexOf('function echoed(turns, p)'), src.indexOf('function retireLanded')), ctx);
vm.runInNewContext(src.slice(src.indexOf('function runContextHtml('), src.indexOf('const turnAt =')), ctx);
const { parseRows } = ctx.window.WosChat;
const SID = 'wizard_1794122381681_0056d47f6f0e', RUN = 'wizardq_99bbcd4c7d7f4816982a709f412fe7f1';
const words = 'What has this thread been doing for 10 hours? Are you stuck?';
const file = { id: 'drop_12dd4b21a78044589b08a67ed97cca27', filename: 'Screenshot.jpg', mime: 'image/jpeg' };
const sentAt = 1794202857;
const earlier = [{ id: 1, role: 'user', content: 'Earlier question', timestamp: 100 }, { id: 2, role: 'assistant', content: 'Earlier answer', timestamp: 101, finish_reason: 'stop' }];
const unsent = (status = 'failed', run = RUN) => ({ id: `queue-${run}`, session_id: SID, role: 'user', timestamp: sentAt,
  content: `${words}\n\n[WIZARD_FILE_CHIPS_V1]\n${JSON.stringify([file])}\n[/WIZARD_FILE_CHIPS_V1]`,
  wizard_queue: { status, reason: status === 'failed' ? 'not_sent' : '', public_run_id: run } });
const paint = (rows, pending = [], c = {}) => {
  const visible = ctx.reconcileSent(parseRows(rows), pending);
  const remaining = pending.filter(p => !ctx.localSent(visible, p) && !ctx.echoed(visible, p) && !ctx.retryShown(visible, p));
  const card = { texts: [], media: [], ...c };
  return { visible, html: visible.map((t, i) => ctx.turnHtml(card, t, i === visible.length - 1, false)).join('') + remaining.map(p => `<pending ${p.id}>`).join('') };
};

test('a message Hermes never took in stays in the thread as his own, marked Not sent, with its attachment', () => {
  const { html, visible } = paint([...earlier, unsent()], [], { retryRunId: RUN });
  assert.equal(visible.filter(t => t.u).length, 2);
  assert.deepEqual({ ...visible[1].u.queue }, { status: 'failed', runId: RUN });
  assert.match(html, /class="msg u unsent"/);
  assert.match(html, /Not sent · message saved/);
  assert.ok(html.includes(words) && html.includes(`data-file="${file.id}"`), html);
  // Retry here is the failed panel's own Retry (data-chretry → retryThread: the saved words and files, once).
  assert.match(html, /<button type="button" class="pbtn" data-chretry>Retry<\/button>/);
});

test('Retry shows only on the saved request it would send, and says Retrying while it runs', () => {
  assert.doesNotMatch(paint([unsent()], [], { retryRunId: 'wizardq_other' }).html, /data-chretry/);
  assert.doesNotMatch(paint([unsent()], [], { retryRunId: '' }).html, /data-chretry/);
  assert.match(paint([unsent()], [], { retryRunId: RUN, retrying: SID }).html, /data-chretry disabled>Retrying…/);
});

test('a queued or running copy is a plain bubble (not marked Not sent)', () => {
  for (const status of ['queued', 'running']) assert.doesNotMatch(paint([unsent(status)]).html, /Not sent|unsent/);
});

test('after Retry, the message shows once: never this phone’s retry copy beside Wizard’s copy', () => {
  // The phone's Retry (retryThread → outbox, how: retry) is sent; Wizard now shows the same message as running.
  const retry = { id: 'wos-retry', state: 'sent', how: 'retry', retryRunId: RUN, runId: 'wizardq_retry', text: `${words}\n\n[WIZARD_FILES_V1] […]`, files: [], createdAt: Date.now(), sentAt: Date.now() };
  let r = paint([...earlier, unsent('running', 'wizardq_retry')], [retry]);
  assert.equal(r.visible.filter(t => t.u?.text?.startsWith(words)).length, 1, r.html);
  assert.doesNotMatch(r.html, /<pending/);
  // Hermes writes the owner's row: still once.
  const later = { ...retry, text: words, createdAt: sentAt * 1000 + 8000, sentAt: sentAt * 1000 + 8500 }; // the retry's own words and time, as the phone wrote them
  r = paint([...earlier, { id: 3, role: 'user', content: words, timestamp: sentAt + 9 }, { id: 4, role: 'assistant', content: 'Here is what happened.', timestamp: sentAt + 19, finish_reason: 'stop' }], [later]);
  assert.equal(r.visible.filter(t => t.u?.text?.startsWith(words)).length, 1, r.html);
});

test('this phone’s just-sent copy is matched to Wizard’s copy of the same run, not drawn twice', () => {
  const p = { id: 'wos-native-rec-1', state: 'sent', runId: RUN, text: 'Different words the server normalised', files: [], createdAt: 1, sentAt: 2 };
  const r = paint([unsent('running')], [p]);
  assert.equal(r.visible.filter(t => t.u).length, 1);
  assert.doesNotMatch(r.html, /<pending/);
});

test('Not sent styling uses the skin’s warning token and keeps the bubble fully opaque', () => {
  assert.match(css, /\.msg\.u\.unsent \.pst\.fail \{[^}]*var\(--wz-warning/);
  assert.doesNotMatch(css.match(/\.msg\.u\.unsent \.bub \{[^}]*\}/)[0], /opacity/);
});

test('a sent Retry is not retired from the outbox until a transcript row really carries it', () => {
  const retry = { id: 'wos-retry', state: 'sent', how: 'retry', retryRunId: RUN, runId: 'wizardq_retry', text: words, files: [], createdAt: 1, sentAt: 2 };
  // Wizard's failed copy of the saved request is on screen, but nothing carries the retry's own run yet: the outbox keeps it.
  const shown = ctx.reconcileSent(parseRows([...earlier, unsent('failed')]), [retry]);
  assert.equal(ctx.echoed(shown, retry), false);
  assert.equal(ctx.retryShown(shown, retry), true); // still never drawn twice
  // Once the retry's own run is a row, it has landed.
  assert.equal(ctx.echoed(ctx.reconcileSent(parseRows([...earlier, unsent('running', 'wizardq_retry')]), [retry]), retry), true);
});
