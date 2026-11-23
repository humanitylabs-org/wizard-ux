// Topic emojis wired into shared Chats (Novairecito / Sepia). The real chats.js row, draft row, emoji sheet, taps and
// search keys run here with the real topic-emoji module (wizard-ux issue 1674: tests run the code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';

const read = path => withShellParts(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const chats = withParts(read('web/core/chats.js'));
const desktop = read('web/desktop/desktop.js');
const css = read('web/core/chats.css');
const lineOf = (src, k) => { const i = src.indexOf(k); assert.ok(i >= 0, k); return src.slice(src.lastIndexOf('\n', i) + 1, src.indexOf('\n', i)); };

function topicModule(seed = {}) {
  const values = new Map(Object.entries(seed));
  const ctx = { localStorage: { getItem: k => (values.has(k) ? values.get(k) : null), setItem: (k, v) => values.set(k, String(v)) } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('web/core/chat-topic-emojis-data.js'), ctx); vm.runInContext(read('web/core/chat-topic-emojis.js'), ctx);
  return ctx.WosTopicEmoji;
}
// chats.js's own topicOn, on a page wearing `skin`
function topicOn(skin, TOPIC = topicModule()) {
  const doc = createDocument(); if (skin) doc.documentElement.setAttribute('data-skin', skin);
  return vm.runInNewContext(`(() => { ${lineOf(chats, "const TOPIC_SKINS = ['novairecito', 'sepia'];")}\n${lineOf(chats, 'const topicOn = () =>')}\n return topicOn; })()`, { TOPIC, document: doc });
}
const textOf = html => html.split(/<[^>]*>/).join('');

for (const page of ['web/index.html', 'web/desktop.html']) {
  test(`${page} loads topic emoji state before shared Chats`, () => {
    // the page's own script order, as the browser reads it
    const doc = createDocument(); const html = read(page);
    doc.documentElement.innerHTML = html.slice(html.indexOf('<head'), html.lastIndexOf('</html>'));
    const src = doc.querySelectorAll('script[src]').map(s => s.getAttribute('src').replace(/^\.\//, '').replace(/\?.*$/, ''));
    const at = f => src.findIndex(s => s.endsWith(f));
    assert.ok(at('core/chat-topic-emojis-data.js') > -1 && at('core/chat-topic-emojis.js') > -1 && at('core/chats.js') > -1, src.join(' '));
    assert.ok(at('core/chat-topic-emojis-data.js') < at('core/chat-topic-emojis.js'));
    assert.ok(at('core/chat-topic-emojis.js') < at('core/chats.js'));
  });
}

// The real chatRow / draftRow with the real TOPIC; anything else they reach is a recorder.
function row(fnMarker, arg, { skin = 'novairecito', extra = {} } = {}) {
  const TOPIC = topicModule();
  const ctx = runRecording(`${block(chats, fnMarker)}\nthis.run = ${/function (\w+)/.exec(fnMarker)[1]};`, {
    TOPIC, topicOn: topicOn(skin, TOPIC), esc: s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`), clip: (s, n) => String(s || '').slice(0, n), stiKind: () => 'ready', STI_LAB: {}, ATT: {},
    isWorking: () => false, deferredOf: () => false, snoozeLast: () => false, attOf: () => null, window: {}, globalThis: {}, subjectOf: s => s.title, ...extra });
  return ctx.run(...arg);
}

test('thread rows render a stable topic emoji and a separate existing status marker', () => {
  const s = { id: 't1', title: 'Gym plan for the week', preview: 'Leg day', status: 'completed' };
  const a = row("  function chatRow(s, snip, searchStatus = '') {", [s, '']), b = row("  function chatRow(s, snip, searchStatus = '') {", [s, '']);
  const emoji = h => /class="ch-topic-emoji"[^>]*>([^<]*)</.exec(h)?.[1];
  assert.ok(emoji(a), 'a topic emoji'); assert.equal(emoji(a), emoji(b), 'the same one each paint');
  assert.match(a, /class="emo sti ready ch-topic-status"/, 'the status marker stays, beside it');
  assert.match(a, /data-chpick="thread:t1"/, 'the emoji opens the picker');
  const doc = createDocument(); doc.body.innerHTML = `<div class="ch-row">${a}</div>`;
  for (const cls of ['ch-topic-mark', 'ch-topic-status']) { const el = doc.querySelector('.' + cls); assert.ok(el, cls); assert.ok(Object.keys(cascade(el, css)).length, `${cls} is styled`); }
});

test('desktop adapter gives an emoji tap to shared Chats before opening the row', () => {
  // the desktop stage's real click handler, on a Chats window: a tap on a row's topic emoji goes to Chats (the picker)
  const code = block(desktop, "  stage.addEventListener('click', e => {", desktop.indexOf('/* ---------------- window interactions')).replace(/^  stage\.addEventListener\('click', /, 'this.click = ').replace(/\);?$/, '');
  const tap = picked => {
    const c = runRecording(`${code};`, { W: { w1: { id: 'w1', app: 'chats' } }, CHATS: { click: () => (c.calls.push(['CHATS.click']), picked), isHosted: () => false, justPressed: () => false, openChat: (...a) => c.calls.push(['CHATS.openChat', ...a]) } });
    const win = { dataset: { win: 'w1' } }, list = {}, chatsEl = { dataset: { chats: 'w1' } }, pick = {}, rowEl = { dataset: { chopen: 't1' } };
    const map = { '.win': win, '[data-chpick]': pick, '[data-chats]': chatsEl, '[data-chopen]': rowEl, '.pane-list': list };
    const e = { target: { closest: q => map[q] ?? null }, stopPropagation() { this.stopped = true; } };
    c.click(e); return c.calls.map(x => x[0]);
  };
  const picked = tap(true);
  assert.ok(picked.includes('CHATS.click') && !picked.includes('CHATS.openChat'), 'the emoji tap opens the picker, not the row');
  assert.ok(tap(false).includes('CHATS.openChat'), 'when Chats does not take it, the row opens as before');
});

test('draft rows use their durable draft key and can open the same picker', () => {
  const d = { key: 'k-42', text: 'Draft about the budget', files: [], at: 1763700000000 };
  const h = row('  function draftRow(d, cur) {', [d, null]);
  assert.match(h, /data-chpick="draft:k-42"/);
  assert.ok(/class="ch-topic-emoji"/.test(h));
  // the row sheet's emoji button (data-rsemo) opens the same sheet
  assert.match(lineOf(chats, '<button type="button" data-rsemo>'), /data-rsemo/);
});

// The real emoji sheet on the tiny DOM.
function sheet() {
  const TOPIC = topicModule(), doc = createDocument(), track = doc.createElement('div');
  track.innerHTML = '<div data-chats="w1"></div>'; doc.body.appendChild(track);
  const names = ['  function openEmojiSheet(wid, key, label) {', '  function startEmojiCategories(scroll, categories) {', '  function appendEmojiCategory(', '  function renderEmojiSearch('];
  const code = [lineOf(chats, '  const emojiCategoryHtml = category =>'), ...names.map(m => block(chats, m))].join('\n') + `\nconst emojiRenderState = new WeakMap();\nthis.open = openEmojiSheet; this.search = renderEmojiSearch;`;
  const ctx = runRecording(code, { TOPIC, track, document: doc, esc: s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`), WeakMap, Array, closeRowSheet() {}, vib() {} });
  ctx.open('w1', 'thread:t1', 'Gym plan');
  return { doc, ctx, TOPIC, q: s => doc.querySelector(s), all: s => doc.querySelectorAll(s) };
}

test('emoji picker renders categories lazily in a bounded independently scrollable region', () => {
  const s = sheet(), scroll = s.q('.ch-emoji-sheet [data-chemoresults]');
  assert.ok(scroll.classList.contains('ch-emoji-scroll'));
  const total = s.TOPIC.categories.length, first = s.all('.ch-emoji-category').length;
  assert.ok(total > 1 && first >= 1 && first < total, `lazily: ${first} of ${total} categories drawn first`);
  assert.ok(s.q('[data-chemosentinel]'));
  Object.assign(scroll, { scrollTop: 10000, clientHeight: 600, scrollHeight: 900 }); scroll.onscroll();
  assert.ok(s.all('.ch-emoji-category').length > first, 'more on scroll');
  const style = sel => cascade(s.q(sel), css);
  assert.equal(style('.ch-emoji-category')['content-visibility']?.value, 'auto');
  const sh = style('.ch-emoji-sheet'); assert.ok(sh['max-height']); assert.equal(sh.display?.value, 'flex'); assert.equal(sh['flex-direction']?.value, 'column');
  const sc = style('.ch-emoji-scroll'); assert.equal(sc['overflow-y']?.value, 'auto'); assert.equal(sc['overscroll-behavior']?.value, 'contain'); assert.equal(sc['touch-action']?.value, 'pan-y');
});

test('emoji picker has an accessible non-autofocused search, clear action, and empty result', () => {
  const s = sheet(), box = s.q('[data-chemosearch]');
  assert.equal(box.getAttribute('type'), 'search'); assert.equal(box.getAttribute('aria-label'), 'Search emojis');
  assert.equal(box.hasAttribute('autofocus'), false); assert.notEqual(s.doc.activeElement, box, 'not focused on open');
  assert.ok(s.q('[data-chemoclear]'), 'a clear action');
  s.ctx.search(s.q('.ch-emoji-sheet'), 'zzzzqqq-no-such-emoji');
  assert.match(textOf(s.q('[data-chemoresults]').innerHTML), /No emojis found/);
  s.ctx.search(s.q('.ch-emoji-sheet'), 'run');
  assert.ok(s.all('[data-chemoresults] button').length > 0, 'a real search finds emojis');
  assert.ok(Object.keys(cascade(s.q('.ch-emoji-search'), css)).length, 'the search row is styled');
});

test('typing in emoji search is isolated from global chat keyboard shortcuts', () => {
  // Chats' keydown line for the emoji search, run: the key stops there; Escape clears a typed search first
  const line = lineOf(chats, "if (e.target.matches('[data-chemosearch]')) { e.stopPropagation();").trim();
  const searched = [], key = vm.runInNewContext(`e => { ${line} return 'shortcut'; }`, { renderEmojiSearch: (sh, q) => searched.push(q) });
  const ev = (k, value = '') => ({ key: k, target: { value, matches: q => q === '[data-chemosearch]', closest: () => ({}) }, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } });
  const a = ev('n'); assert.equal(key(a), undefined); assert.ok(a.stopped, 'typed letters never reach the chat shortcuts');
  const esc = ev('Escape', 'run'); key(esc); assert.ok(esc.stopped && esc.prevented); assert.equal(esc.target.value, ''); assert.deepEqual(searched, ['']);
  const other = { key: 'n', target: { matches: () => false } }; assert.equal(key(other), 'shortcut', 'other fields keep them');
});

test('topic emojis are a Novairecito skin feature; every other skin keeps stock status icons', () => {
  assert.equal(topicOn('novairecito')(), true); assert.equal(topicOn('sepia')(), true);
  for (const skin of ['', 'obsidian', 'landscapes', 'nebula']) assert.equal(topicOn(skin)(), false, skin || 'stock');
  const s = { id: 't1', title: 'Gym plan for the week', preview: 'Leg day', status: 'completed' };
  const off = row("  function chatRow(s, snip, searchStatus = '') {", [s, ''], { skin: 'obsidian' });
  assert.doesNotMatch(off, /ch-topic-emoji|data-chpick/, 'other skins: the stock status icon only');
  assert.match(off, /class="emo sti ready/);
  const offDraft = row('  function draftRow(d, cur) {', [{ key: 'k', text: 'x', files: [], at: 1763700000000 }, null], { skin: 'obsidian' });
  assert.doesNotMatch(offDraft, /ch-topic-emoji|data-chpick/);
  // a skin change repaints: the real chats-events part watches data-skin and repaints the open lists when topics flip
  const obs = [], painted = [];
  let topic = false;
  const window = { WizCore: {}, addEventListener() {} };
  const docEl = {};
  class MutationObserver { constructor(cb) { this.cb = cb; } observe(el, o) { obs.push({ el, o, cb: this.cb }); } }
  runRecording(read('web/core/chats-events.js'), { window, document: { documentElement: docEl, addEventListener() {} }, MutationObserver });
  const W = { list: { id: 'list', thread: null }, thread: { id: 'thread', thread: 't1' } };
  const part = window.WizCore.chatsParts.events({ topicOn: () => topic, CH: { list: {}, thread: {} }, W, LIVE: {}, H: {}, ch: () => ({}) });
  part.bindLate({ renderChats: w => painted.push(w.id) });
  const skinWatch = obs.find(x => x.el === docEl && JSON.stringify(x.o.attributeFilter) === '["data-skin"]');
  assert.ok(skinWatch, 'watches the page\'s data-skin');
  skinWatch.cb(); assert.deepEqual(painted, [], 'same topic state: nothing repaints');
  topic = true; skinWatch.cb(); assert.deepEqual(painted, ['list'], 'to Novairecito: the open list repaints, not the thread');
});
