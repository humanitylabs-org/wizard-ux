import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)

// The Chats "Not up to date" notice is one quiet row (James, 7 Nov 2026: "a single row instead of a big pill button
// that knocks the whole UX down a few centimeters"): dot + one line + a compact "Troubleshoot" text action at the
// right end that opens the Troubleshooter exactly like every other data-chtroubleshoot control. Runs the production
// statements of web/core/chats.js (renderChats' sync bar) and the shipped core/chats.css rules.
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const chats = withParts(read('web/core/chats.js')), css = read('web/core/chats.css');
const a = chats.indexOf('    const lastAt = LST.at'), b = chats.indexOf(": '';", chats.indexOf('    const sync = ', a)) + 5;
assert.ok(a > 0 && b > a, 'chat list sync boundary');
const SYNC = chats.slice(a, b) + '\nthis.render = () => sync;';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NOW = Date.now();
function bar({ LST = {}, ptrState = '', label = 'Can’t reach Wizard · retrying' } = {}) {
  const ctx = { LST, c: { ptrState }, esc, STALE_LIST: 60000, agoText: t => (NOW - t < 60000 ? 'just now' : `${Math.round((NOW - t) / 60000)} min ago`),
    reachLabel: () => label, troubleshoot: '<button type="button" class="pbtn" data-chtroubleshoot>Open Troubleshooter</button>', Date };
  vm.runInNewContext(SYNC, ctx);
  return ctx.render();
}
// Visible text of our own fixture markup: drop each tag, then decode the two entities esc() emits here.
const text = html => html.split(/<[^>]*>/).join('').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const STATES = {
  off: { LST: { error: 'offline', at: NOW - 5000 } },
  'off never read': { LST: { error: 'offline' } },
  stale: { LST: { ok: true, at: NOW - 5 * 60000 } },
  'stale updating': { LST: { ok: true, loading: true, at: NOW - 5 * 60000 } },
};

for (const [name, state] of Object.entries(STATES)) test(`${name}: one row, text + Troubleshoot text action, no pill`, () => {
  const html = bar(state);
  assert.equal((html.match(/class="ch-sync[ "]/g) || []).length, 1, html);
  assert.match(html, /^<div class="ch-sync (off|stale)" role="status">/);
  assert.doesNotMatch(html, /pbtn|Open Troubleshooter<\/button>/, 'no big pill button');
  const btns = html.match(/<button[^>]*>[^<]*<\/button>/g) || [];
  assert.equal(btns.length, 1, 'one action');
  assert.match(btns[0], /class="ch-sync-act" data-chtroubleshoot aria-label="Open Troubleshooter">Troubleshoot<\/button>$/);
  assert.ok(html.endsWith('Troubleshoot</button></div>'), 'the action is the last thing in the same row');
  assert.match(html, /<b>Not up to date<\/b>/);
  const span = html.match(/<span title="([^"]*)">(.*?)<\/span>/);
  assert.ok(span, 'one text line with its full title');
  assert.equal(span[1].replace(/&#39;/g, "'"), text(span[2]), 'title carries the whole line');
  assert.ok(/ch-sync-dot|ch-spin/.test(html), 'a status dot (or spinner while updating) leads the row');
});

test('off: the reason comes first, the last-updated time last (it is what an ellipsis may cut)', () => {
  const t = text(bar(STATES.off));
  assert.match(t, /^Not up to date · Can’t reach Wizard · retrying · last updated just now\s*Troubleshoot$/);
});

test('stale: says how old the list is', () => {
  assert.match(text(bar(STATES.stale)), /^Not up to date · last updated 5 min ago/);
  assert.match(text(bar(STATES['stale updating'])), /updating…/);
});

test('the reach wording is escaped, never markup', () => {
  const html = bar({ ...STATES.off, label: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img/);
});

test('quiet states stay single lines with no action', () => {
  for (const s of [{ ptrState: 'busy', LST: { ok: true, at: NOW } }, { LST: { cached: true, cachedAt: NOW - 300000 } }, { ptrState: 'done', LST: { ok: true, at: NOW } }]) {
    const html = bar(s);
    assert.match(html, /^<div class="ch-sync[^"]*" role="status">/); assert.doesNotMatch(html, /<button|pbtn/);
  }
  assert.equal(bar({ LST: { ok: true, at: NOW } }), '', 'no notice when up to date');
});

test('CSS: one line, ellipsis, a text action (no pill) with a 44px touch target inside a ≤32px row', () => {
  // the drawn notice in the real chats.css cascade (tests/fixtures/w5-css.mjs)
  for (const [state, o] of Object.entries(STATES)) {
    const doc = createDocument(); doc.body.innerHTML = `<div class="ch-pane">${bar(o)}</div>`;
    const row = doc.querySelector('.ch-sync'), act = doc.querySelector('.ch-sync-act'), span = doc.querySelector('.ch-sync > span');
    assert.ok(row && act && span, state);
    const on = el => styles(el, css), r = on(row), a = on(act), t = on(span);
    assert.notEqual(r['flex-wrap'], 'wrap', `${state}: the notice never wraps onto a second row`);
    assert.equal(r['min-height'], '32px', state);
    for (const [k, v] of [['white-space', 'nowrap'], ['text-overflow', 'ellipsis'], ['overflow', 'hidden'], ['min-width', '0']]) assert.equal(t[k], v, `${state}: line ${k}`);
    assert.equal(a.position, 'relative', 'the 44px action paints above the .ch-scroll list it overhangs, so edge taps reach it');
    assert.equal(a['z-index'], '1');
    for (const [k, v] of [['height', '44px'], ['margin', '-6px 0 -6px auto'], ['background', 'none'], ['border', '0'], ['border-radius', '0'], ['white-space', 'nowrap']]) assert.equal(a[k], v, `${state}: action ${k}`);
    assert.match(a.color, /^var\(--violet-2, var\(--wz-accent/);
    const dot = doc.querySelector('.ch-sync-dot');
    if (dot) assert.match(on(dot).background || '', row.classList.contains('stale') ? /var\(--wz-text-muted/ : /var\(--wz-warning/, `${state}: dot`);
  }
});

test('the action opens the Troubleshooter exactly as before', () => {
  // the real Chats click handler (core/chats-bind.js) on the drawn notice, and on the send pill's own button
  const pill = runRecording(between(chats, "  const troubleshoot = '<button", '\n') + '\nglobalThis.html = troubleshoot;', {}).html;
  const doc = createDocument(); doc.body.innerHTML = bar(STATES.off) + pill;
  let opened = 0;
  const ctx = runRecording(block(chats, '  function click(e, id) {') + '\nglobalThis.click = click;', { INC: null, W: {}, window: { WizReach: { open: () => opened++ } }, H: { win: () => null } });
  for (const sel of ['.ch-sync-act', '.pbtn']) {
    const before = opened;
    assert.equal(ctx.click({ target: doc.querySelector(sel) }, 'w1'), true, sel);
    assert.equal(opened, before + 1, sel + ' opens the Troubleshooter');
  }
  assert.equal(doc.querySelector('.pbtn').textContent, 'Open Troubleshooter', 'the pill keeps its own button');
});
