// Discard on a kept recording (desktop) must work where the browser's confirm() never shows: Wizard for Mac's
// WKWebView has no confirm panel, so confirm() returns false (Miguel, 4 Nov 2026: a no-speech take stuck on screen).
// Runs the real recovery block from desktop.js against a small fake DOM and a fake outbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');

function recoveryBlock() {
  const start = desktop.indexOf('  // Recovery is a view of the existing outbox');
  const end = desktop.indexOf('  let dictationFinishing = false;', start);
  assert.ok(start > 0 && end > start, 'recording recovery block found');
  return desktop.slice(start, end);
}

function harness(item) {
  const items = new Map([[item.id, item]]);
  const removed = [], toasts = [], listeners = [];
  let section = null;
  const outbox = {
    recordings: () => [...items.values()],
    get: id => items.get(id) || null,
    canRetry: () => true,
    remove: async id => { removed.push(id); items.delete(id); listeners.forEach(f => f()); return true; },
    removeError: () => '',
    onChange: fn => listeners.push(fn),
    load: () => ({ then: fn => fn() }),
  };
  let focusRestored = 0;
  const document = {
    activeElement: null,
    createElement: () => (section = { hidden: false, innerHTML: '', handlers: {}, setAttribute() {}, addEventListener(t, f) { this.handlers[t] = f; }, querySelectorAll() { return [{ dataset: { recordDiscard: item.id }, focus() { focusRestored++; document.activeElement = this; } }]; } }),
    body: { appendChild() {} },
  };
  const env = { document, window: { WosOutbox: outbox }, OUTBOX: outbox, LIVE: { session: () => null }, toast: (...a) => toasts.push(a),
    esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    confirm: () => false, setTimeout: () => 0 };
  new Function(...Object.keys(env), recoveryBlock())(...Object.values(env));
  // a button the delegate sees: dataset from the rendered markup
  const button = sel => {
    const m = new RegExp(`<button([^>]*)data-${sel}="([^"]+)"([^>]*)>([^<]*)<`).exec(section.innerHTML);
    if (!m) return null;
    const key = sel.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    return { text: m[4], attrs: m[1] + m[3], b: { dataset: { [key]: m[2] }, disabled: false, textContent: m[4] } };
  };
  const click = async sel => { const { b } = button(sel); document.activeElement = b; await section.handlers.click({ target: { closest: () => b } }); };
  return { section: () => section, button, click, removed, toasts, focused: () => focusRestored };
}

const take = { id: 'r1', kind: 'new', state: 'empty', error: 'No speech in that recording · original recording kept', durable: true, audio: { size: 17 * 1024 }, createdAt: 1 };

test('Discard removes a kept recording without the browser confirm() (it returns false in Wizard for Mac)', async () => {
  const h = harness({ ...take });
  assert.equal(h.section().hidden, false, 'the card shows');
  await h.click('record-discard');
  assert.deepEqual(h.removed, [], 'one click only asks again, in the card');
  assert.match(h.button('record-discard').text, /Confirm discard/);
  assert.equal(h.focused(), 1, 'keyboard focus follows the armed button after repaint');
  await h.click('record-discard');
  assert.deepEqual(h.removed, ['r1'], 'the second click discards');
  assert.equal(h.section().hidden, true, 'the card goes');
  assert.ok(h.toasts.some(t => /Recording discarded/.test(t[1])), 'says it is gone');
  assert.doesNotMatch(recoveryBlock(), /[^.\w]confirm\(/, 'no native confirm() in the card');
});

test('a take with no speech offers Discard first; one with words offers Retry first', () => {
  const empty = harness({ ...take }).section().innerHTML;
  assert.ok(empty.indexOf('data-record-discard') < empty.indexOf('data-record-retry'), 'Discard leads');
  assert.match(empty, /class="wz-button destructive" data-record-discard/);
  const words = harness({ ...take, state: 'failed', text: 'hello', error: 'Couldn’t reach Wizard' }).section().innerHTML;
  assert.ok(words.indexOf('data-record-retry') < words.indexOf('data-record-discard'), 'Retry leads');
  assert.match(words, /class="wz-button quiet" data-record-discard/);
});

test('the card paints with skin tokens and the shell kit (no literal colours: light skins stay readable)', () => {
  const rules = css.split('\n').filter(l => l.includes('.recording-recovery') && !l.includes('[hidden]'));
  assert.ok(rules.length >= 4);
  for (const r of rules) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgba?\(/i, r);
  assert.match(recoveryBlock(), /class="wz-card"/);
});
