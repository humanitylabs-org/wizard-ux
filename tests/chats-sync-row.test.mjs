import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The Chats "Not up to date" notice is one quiet row (James, 7 Nov 2026: "a single row instead of a big pill button
// that knocks the whole UX down a few centimeters"): dot + one line + a compact "Troubleshoot" text action at the
// right end that opens the Troubleshooter exactly like every other data-chtroubleshoot control. Runs the production
// statements of web/core/chats.js (renderChats' sync bar) and the shipped core/chats.css rules.
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const chats = read('web/core/chats.js'), css = read('web/core/chats.css');
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
  const rule = sel => { const i = css.indexOf(sel + ' {'); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf('}', i)); };
  assert.doesNotMatch(css, /\.ch-sync\.off\s*\{\s*flex-wrap:\s*wrap/, 'the notice never wraps onto a second row');
  assert.doesNotMatch(css, /\.ch-sync \[data-chtroubleshoot\]/, 'the old pill rule is gone');
  const span = rule('.ch-sync > span');
  for (const d of ['white-space: nowrap', 'text-overflow: ellipsis', 'overflow: hidden', 'min-width: 0']) assert.ok(span.includes(d), d);
  const row = rule('.ch-sync:has(.ch-sync-act)');
  assert.match(row, /min-height: 32px/); assert.doesNotMatch(row, /flex-wrap/);
  const act = rule('.ch-sync .ch-sync-act');
  assert.match(act, /position: relative; z-index: 1;/, 'the 44px action paints above the .ch-scroll list it overhangs, so edge taps reach it');
  for (const d of ['height: 44px', 'margin: -6px 0 -6px auto', 'background: none', 'border: 0', 'border-radius: 0', 'white-space: nowrap']) assert.ok(act.includes(d), d);
  assert.match(act, /color: var\(--violet-2, var\(--wz-accent/);
  assert.match(rule('.ch-sync-dot'), /var\(--wz-warning/);
});

test('the action opens the Troubleshooter exactly as before', () => {
  assert.match(chats, /if \(e\.target\.closest\('\[data-chtroubleshoot\]'\)\) \{ window\.WizReach\?\.open\(\); return true; \}/);
  // The send pill and the thread read error keep their own Open Troubleshooter button (only this notice changed).
  assert.match(chats, /const troubleshoot = '<button type="button" class="pbtn" data-chtroubleshoot>Open Troubleshooter<\/button>';/);
});
