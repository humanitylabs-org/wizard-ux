import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)

// One reply card (wizard-ux issue 2064, switch wizard/reply-card, off): a long reply opens with one card, its state (the
// Needs you dot when this reply needs you, else Done / FYI), the full summary (the reply's own ask, never the chat
// list's 140-character clip), the one Mark done, and Show more / Show less for the full reply below it. The thread's
// bottom row drops its second Mark done. Off, and for replies without a summary, the thread renders as before.
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const kitCtx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
kitCtx.window = kitCtx; modelContext(kitCtx); vm.runInContext(read('web/core/chat-kit.js'), kitCtx);
const KIT = kitCtx.WosChat;
const chats = withParts(read('web/core/chats.js'));
const line = start => { const a = chats.indexOf(start); assert.ok(a >= 0, start); return chats.slice(a, chats.indexOf('\n', a) + 1); };
const slice = (start, end) => { const a = chats.indexOf(start), b = chats.indexOf(end, a); assert.ok(a >= 0 && b > a, `${start} .. ${end}`); return chats.slice(a, b); };
const MD = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const NEEDS = `<div class="ch-needs-line" data-needs-line role="status"><span class="ch-post-st needs"><i class="ch-chan-dot" aria-hidden="true"></i>Needs you</span><span class="ch-needs-ask">clipped…</span><button type="button" class="ch-needs-done" data-chmarkdone>${MD}Mark done</button></div>`;

// The real turnHtml (and the card it draws) with the real summary rules; `tweaks` is the root's data-tweaks.
function render(rows, { tweaks = '', summary = false, needsCard = null, start = 'collapsed', chosen = null } = {}) {
  const ctx = { getComputedStyle: () => ({ getPropertyValue: name => name === '--wos-reply-summary' && summary ? ' on' : '' }),
    document: { documentElement: { dataset: { tweaks } } }, window: { WizConfig: { agent: () => 'Fixture' }, WosSkinHost: { replySummary: { get: () => ({ start }) } } }, KIT: { time: { full: String, stamp: String } }, esc: KIT.esc, md: KIT.md, PW: null,
    replyCard: () => '', msgIds: () => '', quoteBtn: () => '', userMedia: () => '', mediaBlock: () => '', clip: s => s, CHECK_SVG: '', COPY_SVG: '', SHARE_SVG: '', noteHtml: () => '', runContextHtml: () => '' };
  modelContext(ctx);
  vm.runInContext(`${['  const regenOn = ', '  const summaryOn = ', '  const SUMMARY_WORDS = ', '  const summaryOf = ', '  const summaryStartsOpen = ', '  const leadText = ', '  const COG_SVG = ', '  const CHEV_SVG = ', '  const timeTag = '].map(line).join('')}${slice('  function turnHtml(', '  const turnAt = ')}this.turnHtml = turnHtml;`, ctx);
  const c = { texts: [], ...(chosen ? { rsum: new Map(chosen) } : {}), ...(needsCard ? { needsCard } : {}) };
  const html = KIT.parseRows(rows).map((tn, i, all) => ctx.turnHtml(c, tn, i === all.length - 1, false, null, null, true, i === all.length - 1 && needsCard ? NEEDS : '')).join('');
  return { html, c };
}
const long = Array.from({ length: 160 }, (_, i) => `word${i}`).join(' ');
const ASK = ('The launch plan is ready and the venue holds the 14th for us until Friday noon. Reply book to confirm the venue, '
  + 'or pick another date below, and I will send the invitations to the forty people on the guest list the same afternoon.');
const GROUP = `[WIZARD_BUTTONS_V1]${JSON.stringify({ group: 'Venue', buttons: [{ id: 'book', label: 'Book the 14th' }] })}[/WIZARD_BUTTONS_V1]`;
const rows = (state = 'needs_you', content = long + '\n\n' + GROUP) => [{ role: 'user', timestamp: 1, content: 'Where are we?' }, { id: 7, role: 'assistant', timestamp: 2, content, wizard_ask: ASK, wizard_state: state }];
const ON = 'wizard/desktop-chats wizard/reply-card';
const count = (s, part) => s.split(part).length - 1;

test('chat-kit keeps the reply\'s status next to its ask', () => {
  const tn = KIT.parseRows(rows('done'));
  assert.equal(tn[0].a.state, 'done'); assert.equal(tn[0].a.ask, ASK);
  assert.equal(KIT.parseRows([{ role: 'assistant', timestamp: 2, content: 'x', wizard_ask: 'a', wizard_state: 'nonsense' }])[0].a.state, undefined);
});

test('on: a needs-you reply opens with one card: Needs you, the full summary once, one Mark done, Show more; the full reply waits folded', () => {
  const { html, c } = render(rows(), { tweaks: ON, needsCard: { state: 'needs_you', done: `<button type="button" class="ch-needs-done" data-chmarkdone>${MD}Mark done</button>` } });
  assert.match(html, /<div class="msg a has-rsum"/);
  assert.ok(html.includes('<div class="ch-rcard needs" data-needs-line role="status"><span class="ch-post-st ch-rcard-st needs"><i class="ch-chan-dot" aria-hidden="true"></i>Needs you</span>'), 'the card is the Needs you line');
  assert.equal(count(html, ASK), 1, 'the summary shows once, in full');
  assert.doesNotMatch(html, /clipped…|ch-needs-line|class="rsum"/, 'no separate strip and no second summary');
  assert.equal(count(html, 'data-chmarkdone'), 1, 'one Mark done');
  assert.equal(c.cardDone, true, 'the bottom row is told to drop its Mark done');
  assert.ok(html.includes('<button type="button" class="ch-rcard-more" data-reply-summary="2000" aria-expanded="false"><span class="ch-rcard-ml">Show more</span>'));
  assert.ok(html.includes('<div class="rdet" data-reply-details="2000" hidden>'), 'the full reply is folded below the card');
  assert.ok(html.indexOf('ch-rcard') < html.indexOf('data-reply-details') && html.indexOf('data-reply-details') < html.indexOf('word159'), 'card first, then the full reply');
  assert.ok(html.indexOf('data-reply-details') < html.indexOf('data-rb="book"') || !html.includes('data-rb='), 'reply buttons sit in the full reply');
  assert.match(html, /data-mcopy="0"/, 'Copy still copies the full reply');
});

test('on: Show less when the owner opened it or replies start expanded; Your call, Done and FYI states; no Mark done without Needs you', () => {
  assert.ok(render(rows(), { tweaks: ON, chosen: [['2000', true]] }).html.includes('aria-expanded="true"><span class="ch-rcard-ml">Show less</span>'));
  assert.ok(render(rows(), { tweaks: ON, start: 'expanded' }).html.includes('<div class="rdet" data-reply-details="2000">'));
  assert.match(render(rows('check'), { tweaks: ON, needsCard: { state: 'check', done: '' } }).html, /ch-rcard-st needs"><i[^>]*><\/i>Your call</);
  const done = render(rows('done'), { tweaks: ON }).html;
  assert.match(done, /<div class="ch-rcard done"><span class="ch-post-st ch-rcard-st done"><i[^>]*><\/i>Done</); assert.doesNotMatch(done, /data-chmarkdone|data-needs-line/);
  assert.match(render(rows('fyi'), { tweaks: ON }).html, /ch-rcard-st fyi"><i[^>]*><\/i>FYI</);
  // An older reply that once needed you (not the one carrying the line) shows no stale Needs you.
  const old = render(rows('needs_you'), { tweaks: ON }).html;
  assert.match(old, /<div class="ch-rcard"><p class="ch-rcard-sum">/); assert.doesNotMatch(old, /Needs you|data-chmarkdone/);
});

test('on: the card is the summary even without Short answer first; a short reply keeps today\'s Needs you line', () => {
  assert.match(render(rows(), { tweaks: ON }).html, /ch-rcard/);
  const short = render(rows('needs_you', 'Red or blue?'), { tweaks: ON, needsCard: { state: 'needs_you', done: 'x' } });
  assert.ok(short.html.startsWith('<div class="msg u') && short.html.includes(NEEDS), 'the line stays');
  assert.doesNotMatch(short.html, /ch-rcard|rdet/); assert.notEqual(short.c.cardDone, true);
});

test('off: byte-identical to today, with and without Short answer first', () => {
  for (const summary of [false, true]) {
    const before = render(rows(), { tweaks: 'wizard/desktop-chats', summary, needsCard: { state: 'needs_you', done: 'x' } }).html;
    assert.doesNotMatch(before, /ch-rcard/);
    assert.ok(before.includes(NEEDS), 'the strip stays');
    assert.equal(summary, before.includes('class="rsum"'));
  }
});

test('the bottom row keeps its Mark done unless the card drew it; the jump pill counts the card once, as Needs you', () => {
  const paint = read('web/core/chats-threadpaint.js');
  assert.ok(paint.includes("canMarkDone(s) && c.cardDone !== true ?"), 'the tacts Mark done waits on the card');
  assert.ok(paint.includes('c.cardDone = false;'), 'reset on every paint');
  const done = read('web/core/chats-done.js');
  assert.ok(done.includes("!n.querySelector('.ch-rcard[data-needs-line]')) add(n, 'new', key);"), 'a reply holding the amber card is not counted again as new');
  assert.ok(done.includes('c.needsCard = k >= 0 ?'), 'needsMark hands the card its state and Mark done');
});

test('the Show more / Show less button flips its own words and aria-expanded', () => {
  const src = read('web/core/chats-tracker.js'), a = src.indexOf('  const setSummaryOpen = '), b = src.indexOf('  };\n', a) + 5;
  const ctx = {}; vm.runInNewContext(`${src.slice(a, b)}this.setSummaryOpen = setSummaryOpen;`, ctx);
  const label = { textContent: 'Show more' }, attrs = {}, det = { hidden: true };
  const more = { setAttribute: (k, v) => { attrs[k] = v; }, querySelector: () => label };
  const cls = new Set(), msg = { classList: { toggle: (k, on) => (on ? cls.add(k) : cls.delete(k)) }, querySelector: q => q === '.bub > .rdet' ? det : q.includes('ch-rcard') ? more : null };
  ctx.setSummaryOpen(msg, true); assert.deepEqual([label.textContent, attrs['aria-expanded'], det.hidden, cls.has('rsum-open')], ['Show less', 'true', false, true]);
  ctx.setSummaryOpen(msg, false); assert.deepEqual([label.textContent, attrs['aria-expanded'], det.hidden], ['Show more', 'false', true]);
});

test('the switch is a catalogued, linked, no-op package', () => {
  const m = JSON.parse(read('web/tweaks/wizard/reply-card/manifest.json')), cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.equal(m.id, 'wizard/reply-card'); assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#2064']);
  assert.ok(cat.tweaks.includes('wizard/reply-card')); assert.ok(!cat.defaults.includes('wizard/reply-card'));
});
