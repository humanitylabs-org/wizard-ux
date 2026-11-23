import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { client } from './fixtures/outbox-client.mjs';

// Regression: tapping Dismiss on a failed voice note in the Errors section showed
// "Could not save dismissal · original kept". The generic Chats click handler grabbed every
// [data-obdismiss] first and called OUTBOX.dismissBubble, which (correctly) refuses 'failed'
// items, so the Errors row's own confirm → delete flow in chat-power.js never ran.
// Each test runs the real code (sliced out of its module where the module needs a whole shell), never its text
// (wizard-ux issue 1674).
const read = f => readFileSync(new URL('../web/' + f, import.meta.url), 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i); assert.ok(j > i, b); return src.slice(i, j); };
const power = read('core/chat-power.js'), bind = read('core/chats-bind.js');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The Errors section's extras and its click branch from chat-power.js, against a fake outbox.
function errors(items) {
  const removed = [], toasts = [], ctx = { OUTBOX: { unsent: () => items, canRetry: () => false, remove: async id => (removed.push(id), true) },
    E: { ready: true, items: [], busy: new Map(), onChange() {} }, LIVE: { session: () => null }, A: { MIC_SVG: '', CH: {} }, H: { win: () => null },
    esc, clip: (s, n) => String(s).slice(0, n), Date, setTimeout: () => 0, toast: (...a) => toasts.push(a), rerenders: 0 };
  vm.createContext(ctx);
  const extra = between(power, '  const voiceFailed = ', '  if (E) E.onChange(');
  const click = between(power, "    const od = t.closest('[data-obdismiss]'); if (od) {", '    return false;\n  }');
  vm.runInContext(`${extra}\nfunction rerenderLists() { rerenders++; }\nfunction click(t) {\n${click}    return false;\n}\nthis.errorsExtra = errorsExtra; this.click = click;`, ctx);
  const button = id => ({ dataset: { obdismiss: id }, disabled: false, textContent: '' });
  const tap = b => ctx.click({ closest: s => (s === '[data-obdismiss]' ? b : null) });
  return { ctx, removed, toasts, button, tap };
}

test('Errors voice rows are rendered inside [data-errob] with their own Dismiss', () => {
  const e = errors([{ id: 'v1', state: 'failed', audio: {}, text: 'call mum', error: 'offline' }, { id: 'v2', state: 'failed' }, { id: 'v3', state: 'held', audio: {} }]);
  const { n, html } = e.ctx.errorsExtra();
  assert.equal(n, 1, 'only a failed note that still has its audio');
  assert.match(html, /<div class="ch-err ch-err-vn" data-errob="v1">.*Voice note · call mum.*Not sent · offline.*data-obdismiss="v1">Dismiss<\/button>/);
  // Its Dismiss asks first, then deletes the recording (confirm → delete).
  const b = e.button('v1');
  assert.equal(e.tap(b), true);
  assert.deepEqual(e.removed, []);
  assert.match(e.ctx.errorsExtra().html, /data-obdismiss="v1">Delete recording\?<\/button>/);
  assert.equal(e.tap(b), true);
  assert.deepEqual(e.removed, ['v1']);
  assert.equal(b.textContent, 'Deleting…');
});

// The generic bubble Dismiss in chats-bind.js, run with a fake outbox.
function generic() {
  const asked = [], ctx = { OUTBOX: { get: () => ({ state: 'held' }), dismissBubble: async id => (asked.push(id), true) }, H: { toast() {} }, Promise };
  vm.createContext(ctx);
  const block = between(bind, "    const dismiss = !e.target.closest('[data-errob]')", "    const discard = ");
  vm.runInContext(`function click(e) {\n${block}  return false;\n}\nthis.click = click;`, ctx);
  const event = inErrors => ({ target: { closest: s => (s === '[data-obdismiss]' ? { dataset: { obdismiss: 'v1' } } : s === '[data-errob]' && inErrors ? {} : null) } });
  return { ctx, asked, event };
}

test('generic bubble Dismiss skips Errors voice rows so chat-power handles them', () => {
  const g = generic();
  assert.equal(g.ctx.click(g.event(true)), false, 'an Errors row is left to its own handler');
  assert.deepEqual(g.asked, []);
  assert.equal(g.ctx.click(g.event(false)), true, 'a bubble in a thread still dismisses');
  assert.deepEqual(g.asked, ['v1']);
});

test('dismissBubble still refuses failed items (custody rule unchanged)', async t => {
  const p = client(); t.after(p.close); await new Promise(r => setTimeout(r, 25));
  const failed = { id: 'f', kind: 'reply', state: 'failed', sessionId: 's', text: 'x', createdAt: Date.now() };
  const held = { id: 'h', kind: 'reply', state: 'held', sessionId: 's', text: 'y', createdAt: Date.now() };
  p.api._items.set('f', failed); p.api._items.set('h', held);
  assert.equal(await p.api.dismissBubble('f'), false);
  assert.equal(failed.threadHidden, undefined); assert.equal(failed.state, 'failed');
  assert.equal(await p.api.dismissBubble('h'), true);
  assert.equal(held.threadHidden, true);
  assert.equal(p.calls.length, 0);
});
