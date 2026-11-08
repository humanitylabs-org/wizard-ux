// Translate screen paints picture text over the picture (the original Lens-style renderer), never a text panel.
// Executes the shipped Screen page in a DOM double with a model-free native bridge. Geometry here is synthetic:
// it proves validation, scaling and state handling, not where a real model puts real Thai.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const page = fs.readFileSync(process.env.SCREEN_PAGE_SOURCE || new URL('../android/app/src/main/assets/assist/screen.html', import.meta.url), 'utf8');
const scriptStart = page.indexOf('<script>') + '<script>'.length;
const scriptEnd = page.indexOf('</script>', scriptStart);
assert.ok(scriptStart >= '<script>'.length && scriptEnd > scriptStart, 'expected the shipped inline script');
const source = page.slice(scriptStart, scriptEnd);
const HOOK = "  N.log('screen page ready');";
assert.ok(source.includes(HOOK));
const THAI = ['ข้าจะไปออกรบ', 'โอเค แล้วที่นั่น', 'มีสาวๆ ไหม?'];
const EN = ["I'm heading to battle", 'Okay, and over there', 'Are there any girls?'];
// Unit boxes [l, t, r, b] of the screenshot; screen is 360x780 css at dpr 2 (720x1560 px).
const BOX = [[0.1, 0.30, 0.7, 0.34], [0.1, 0.36, 0.6, 0.40], [0.2, 0.42, 0.8, 0.46]];
const DPR = 2;

function element() {
  const classes = new Set(), listeners = {}, style = {};
  const n = v => parseFloat(v) || 0;
  return { style: Object.assign(style, { setProperty() {} }), dataset: {}, children: [], hidden: false, textContent: '', disabled: false,
    classList: { add(x) { classes.add(x); }, remove(x) { classes.delete(x); }, contains: x => classes.has(x), toggle(x, on) { if (on === undefined) on = !classes.has(x); on ? classes.add(x) : classes.delete(x); return on; } },
    addEventListener(t, fn) { listeners[t] = fn; }, fire(t, e = {}) { listeners[t]?.(e); },
    getContext() { return { measureText: t => ({ width: t.length * 8 }) }; },
    set innerHTML(v) { this.html = v; this.children = []; }, get innerHTML() { return this.html || ''; },
    appendChild(e) { this.children.push(e); }, querySelectorAll() { return []; }, setPointerCapture() {},
    getBoundingClientRect() { const l = n(style.left), t = n(style.top), w = n(style.width), h = n(style.height); return { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h }; },
    clientWidth: 30, clientHeight: 20, scrollWidth: 30, scrollHeight: 20 };
}
/** A native block in page px with exact word boxes, the way ScreenPolicy reports it (screen px). */
function blk(t, x, y, w, h, extra = {}) {
  const parts = t.split(' '), ww = w / parts.length;
  return { t, x: x * DPR, y: y * DPR, w: w * DPR, h: h * DPR, l: false, ex: true,
    wd: parts.map((s, i) => [s, i < parts.length - 1 ? ' ' : '', Math.round((x + i * ww) * DPR), Math.round(y * DPR), Math.round(ww * 0.9 * DPR), Math.round(h * DPR)]), ...extra };
}
const CHROME = [blk('Saved Messages', 90, 40, 160, 20), blk('today at 17:57', 250, 700, 90, 14)];

/**
 * A DOM element with a crude text layout (NOT a browser): about 0.55 em per character, greedy word wrap, line-height
 * 1.12, the .pt 2 px side padding; height 'auto' grows to the content. Enough to see whether text fits its box.
 */
function laidOut() {
  const e = element(), st = e.style, f = () => parseFloat(st.fontSize) || 16, n = v => parseFloat(v) || 0;
  const words = () => String(e.textContent).split(' '), wpx = w => w.length * 0.55 * f() + 4;
  const lines = () => {
    if (st.whiteSpace === 'nowrap') return 1;
    let k = 1, cur = 0; const room = n(st.width) - 4;
    for (const w of words()) { const ww = w.length * 0.55 * f(), add = cur ? 0.55 * f() + ww : ww; if (cur && cur + add > room) { k++; cur = ww; } else cur += add; }
    return k;
  };
  Object.defineProperties(e, {
    clientWidth: { get: () => n(st.width) },
    scrollWidth: { get: () => st.whiteSpace === 'nowrap' ? wpx(e.textContent) : Math.max(n(st.width), ...words().map(wpx)) },
    scrollHeight: { get: () => lines() * 1.12 * f() },
    clientHeight: { get: () => st.height === 'auto' ? Math.max(n(st.minHeight), lines() * 1.12 * f()) : n(st.height) },
  });
  e.getBoundingClientRect = () => ({ left: n(st.left), top: n(st.top), right: n(st.left) + e.clientWidth, bottom: n(st.top) + e.clientHeight, width: e.clientWidth, height: e.clientHeight });
  return e;
}

async function harness({ blocks = CHROME, shot = true, few = false, mode = 'translate', make = element } = {}) {
  const nodes = new Map(), calls = [];
  const node = s => { if (!nodes.has(s)) nodes.set(s, element()); return nodes.get(s); };
  const context = { document: { querySelector: node, querySelectorAll: () => [], createElement: make, body: element(), documentElement: element(), addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {} }, setTimeout: () => 1, clearTimeout() {}, innerWidth: 360, innerHeight: 780, devicePixelRatio: DPR,
    getSelection: () => '', performance: { now: () => 0 }, Image: function () {},
    ScreenNative: { translate: (id, items, to) => calls.push({ kind: 'translate', id, items: JSON.parse(items), to }), picture: id => calls.push({ kind: 'picture', id }),
      copy: text => calls.push({ kind: 'copy', text }), ask: text => calls.push({ kind: 'ask', text }), log() {}, shot: () => '' } };
  context.window = context;
  vm.runInNewContext(source.replace(HOOK, '  window.__test = { st, setPx: v => { px = v; }, pictureBox };'), context);
  const { st } = context.__test;
  await context.S.open({ mode, shot, few, dpr: DPR, ox: 0, oy: 0, sw: 360 * DPR, sh: 780 * DPR, top: 24, bot: 24, blocks });
  const all = kind => calls.filter(c => c.kind === kind);
  const next = kind => all(kind).at(-1);
  const translated = (r, c = next('translate')) => context.S.translated(c.id, r);
  /** The model leaves text that is already in the target language as it was. */
  const identity = (c = next('translate')) => translated({ items: c.items, from: 'English' }, c);
  const pictured = (r, c = next('picture')) => context.S.pictured(c.id, r);
  const thaiPicture = (lines = THAI, boxes = BOX) => pictured({ lines, boxes });
  const thaiEnglish = (c = next('translate')) => translated({ items: c.items.map(t => EN[THAI.indexOf(t)] ?? t), from: 'Thai' }, c);
  const painted = () => node('#paint').children.map(e => ({ b: +e.dataset.b, t: e.textContent, left: parseFloat(e.style.left), top: parseFloat(e.style.top), width: parseFloat(e.style.width), height: parseFloat(e.style.height) }));
  const tap = (x, y) => { const l = node('#layer'); l.fire('pointerdown', { clientX: x, clientY: y, pointerId: 1 }); l.fire('pointerup', { clientX: x, clientY: y, pointerId: 1 }); };
  return { st, context, calls, node, all, next, translated, identity, pictured, thaiPicture, thaiEnglish, painted, tap,
    pill: () => node('#pill').innerHTML, sheet: () => node('#sheet').classList.contains('show'), tbar: () => node('#tbar').classList.contains('show') };
}
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

test('English chrome + Thai picture: Thai painted over its own place, Thai → English, no panel', async () => {
  const h = await harness();
  assert.ok(h.next('picture'), 'pixels are read at once, even though the app reports English chrome');
  assert.match(h.pill(), /Detecting language/);
  h.identity(); // the chrome comes back unchanged with from: English
  assert.match(h.pill(), /Reading picture/);
  h.thaiPicture();
  assert.deepEqual(h.next('translate').items, THAI);
  assert.match(h.pill(), /Translating picture/);
  h.thaiEnglish();
  const ps = h.painted();
  assert.deepEqual(ps.map(p => p.t), EN, 'each English line is drawn by the original renderer');
  // BOX[0] = [.1,.30,.7,.34] of 720x1560 px at dpr 2 → x 36, y 234, w 216, h 31.2 (textArea pads 2/1 px)
  assert.ok(near(ps[0].left, 34) && near(ps[0].top, 233) && near(ps[0].width, 220) && near(ps[0].height, 33.2), JSON.stringify(ps[0]));
  assert.ok(near(ps[2].left, 70) && near(ps[2].top, 326.6), JSON.stringify(ps[2]));
  assert.equal(h.sheet(), false, 'no automatic text panel');
  assert.equal(h.st.panel, 'sel');
  assert.equal(h.tbar(), true, 'the translation bar: Copy translation · Select text · Ask Wizard');
  assert.equal(h.node('#orig').hidden, false, 'Original is offered');
  assert.match(h.pill(), /^Thai → <b>English<\/b> ▾$/);
  assert.doesNotMatch(h.pill(), /English →/);
  h.node('#tCopy').fire('click'); assert.equal(h.next('copy').text, EN.join('\n'));
  h.node('#tAsk').fire('click'); assert.equal(h.next('ask').text, THAI.join('\n') + '\n\nEnglish:\n' + EN.join('\n'));
});

test('geometry is scaled through dpr and window offset, and kept to believable line boxes', async () => {
  const h = await harness();
  h.st.o.ox = 0; h.st.o.oy = 40; // a window placed 40 px below the screen top
  const b = h.context.__test.pictureBox([0.25, 0.5, 0.75, 0.525]);
  assert.ok(near(b.x, 90) && near(b.y, 370) && near(b.w, 180) && near(b.h, 19.5), JSON.stringify(b));
  for (const bad of [[0, 0, 1, 1], [0, 0.1, 1, 0.5], [0.1, 0.1, 0.1004, 0.2], [0.1, 0.1, 0.5, 0.1001], [-0.5, 0.1, 0.1, 0.12]])
    assert.equal(h.context.__test.pictureBox(bad), null, 'rejected ' + bad);
});

test('older Search (lines only) and malformed boxes never get a guessed place, yet stay in Copy/Ask', async () => {
  for (const [name, reply] of [
    ['lines only', { lines: THAI }],
    ['boxes not line for line', { lines: THAI, boxes: BOX.slice(0, 2) }],
    ['boxes not a list', { lines: THAI, boxes: 'x' }],
    ['every box bad', { lines: THAI, boxes: [[0.5, 0.3, 0.1, 0.34], [NaN, 0.1, 0.2, 0.2], [0.1, 0.2, 1.4, 0.3]] }],
  ]) {
    const h = await harness(); h.identity(); h.pictured(reply); h.thaiEnglish();
    assert.equal(h.painted().length, 0, name + ': nothing painted');
    assert.equal(h.sheet(), false, name + ': still no panel');
    assert.match(h.pill(), /Thai → <b>English<\/b> · 3 not placed/, name);
    assert.match(h.node('#toast').textContent, /3 lines couldn’t be placed/, name);
    h.node('#tCopy').fire('click'); assert.equal(h.next('copy').text, EN.join('\n'), name);
    assert.equal(h.node('#orig').hidden, true, name + ': nothing to toggle');
  }
  const h = await harness(); h.identity(); h.pictured({ lines: THAI, boxes: [BOX[0], null, [0.2, 0.42, 0.8]] }); h.thaiEnglish();
  assert.deepEqual(h.painted().map(p => p.t), [EN[0]], 'only the line with a usable box is placed');
  h.node('#tCopy').fire('click'); assert.equal(h.next('copy').text, EN.join('\n'), 'placed and unplaced, in reading order, once each');
});

test('picture text the app already reports is not translated or painted twice', async () => {
  const caption = blk('ส่งฟรีเมื่อสั่งครบ', 20, 500, 200, 24);
  const h = await harness({ blocks: [...CHROME, caption] });
  h.translated({ items: ['Saved Messages', 'today at 17:57', 'Free delivery'], from: 'English, Thai' });
  assert.equal(h.painted().length, 1);
  // vision reads the caption with a slightly different spelling at the same place, plus the same text exactly
  const capBox = [20 / 360, 500 / 780, 220 / 360, 524 / 780];
  h.pictured({ lines: ['ส่งฟรีเมื่อสั่งครบ', 'ส่งฟรีเมื่อสั่งคลบ', 'Saved Messages', ...THAI], boxes: [capBox, capBox, null, ...BOX] });
  assert.deepEqual(h.next('translate').items, THAI, 'only the picture-only lines are sent');
  h.thaiEnglish();
  assert.deepEqual(h.painted().map(p => p.t), ['Free delivery', ...EN]);
  h.node('#tCopy').fire('click'); assert.equal(h.next('copy').text, ['Free delivery', ...EN].join('\n'));
  assert.equal(h.pill(), 'Thai → <b>English</b> ▾', 'the target is never listed as a source');
});

test('repeated words: two places stay two, one place read twice stays one, a contested place is not shared', async () => {
  const h = await harness(); h.identity();
  h.pictured({ lines: [THAI[0], THAI[0], THAI[0], THAI[1]], boxes: [BOX[0], BOX[2], BOX[0], [0.12, 0.305, 0.68, 0.335]] });
  assert.deepEqual(h.next('translate').items, [THAI[0], THAI[1]]);
  h.thaiEnglish();
  assert.deepEqual(h.painted().map(p => p.t), [EN[0], EN[0]], 'same sign in two places; the contested spot keeps its first reading');
  assert.equal(JSON.stringify(h.st.picRows.map(q => [q.tr, q.bi >= 0])), JSON.stringify([[EN[0], true], [EN[0], true], [EN[1], false]]));
  assert.match(h.pill(), /1 not placed/);
});

test('#1101: repeated picture text keeps every occurrence unless two valid boxes overlap', async () => {
  const run = async (lines, boxes) => {
    const h = await harness(); h.identity(); h.pictured({ lines, boxes });
    const sent = h.next('translate').items; h.thaiEnglish();
    h.node('#tCopy').fire('click');
    h.node('#tAsk').fire('click');
    return { h, sent, rows: Array.from(h.st.picRows, q => [q.tr, q.bi >= 0]), copy: h.next('copy').text, ask: h.next('ask').text };
  };
  // two boxless identical lines: two rows, two lines in Copy/Ask, one translate item
  let r = await run([THAI[0], THAI[0]], [null, null]);
  assert.deepEqual(r.sent, [THAI[0]], 'the translate request may deduplicate');
  assert.equal(JSON.stringify(r.rows), JSON.stringify([[EN[0], false], [EN[0], false]]));
  assert.equal(r.copy, [EN[0], EN[0]].join('\n'));
  assert.equal(r.ask, [THAI[0], THAI[0]].join('\n') + '\n\nEnglish:\n' + [EN[0], EN[0]].join('\n'));
  // older Search (no boxes at all) behaves the same
  r = await run([THAI[0], THAI[1], THAI[0]], undefined);
  assert.equal(JSON.stringify(r.rows), JSON.stringify([[EN[0], false], [EN[1], false], [EN[0], false]]));
  // boxless then placed, and placed then boxless: two rows, the placed one keeps its overlay
  for (const boxes of [[null, BOX[0]], [BOX[0], null]]) {
    r = await run([THAI[0], THAI[0]], boxes);
    assert.equal(JSON.stringify(r.rows), JSON.stringify(boxes.map(b => [EN[0], !!b])), JSON.stringify(boxes));
    assert.deepEqual(r.h.painted().map(p => p.t), [EN[0]], 'the placed occurrence is painted once');
    assert.equal(r.copy, [EN[0], EN[0]].join('\n'));
  }
  // two valid overlapping boxes: one row; two separate valid places: two rows
  r = await run([THAI[0], THAI[0]], [BOX[0], [0.11, 0.301, 0.69, 0.339]]);
  assert.equal(JSON.stringify(r.rows), JSON.stringify([[EN[0], true]]));
  assert.equal(r.copy, EN[0]);
  r = await run([THAI[0], THAI[0]], [BOX[0], BOX[2]]);
  assert.equal(JSON.stringify(r.rows), JSON.stringify([[EN[0], true], [EN[0], true]]));
  assert.equal(r.h.painted().length, 2);
  // a different reading claims the spot first, then the same words twice in that spot: the repeat is still one
  // reading (its original place overlaps), so Copy/Ask hold it once, not twice
  r = await run([THAI[1], THAI[0], THAI[0]], [BOX[0], BOX[0], [0.11, 0.301, 0.69, 0.339]]);
  assert.equal(JSON.stringify(r.rows), JSON.stringify([[EN[1], true], [EN[0], false]]));
  assert.equal(r.copy, [EN[1], EN[0]].join('\n'));
});

test('James: three distinct captions close together all get placed, not just the first (synthetic text, not a real screenshot)', async () => {
  const lines = ['สวัสดีครับ', 'วันนี้อากาศดี', 'ไปเดินเล่นกันไหม'], en = ['Hello', 'The weather is nice today', 'Shall we go for a walk?'];
  // three boxes with moderate, imprecise overlap against the first (50 % and 75 %), as a loose model box or tight
  // line spacing would give; none is the same claimed spot (that case stays covered by the test above).
  const h = await harness();
  h.identity();
  h.pictured({ lines, boxes: [[0.10, 0.30, 0.70, 0.34], [0.10, 0.32, 0.70, 0.36], [0.10, 0.31, 0.70, 0.35]] });
  h.translated({ items: en, from: 'Thai' });
  assert.deepEqual(Array.from(h.st.picRows, q => q.bi >= 0), [true, true, true], 'no line is dropped just for sitting close to another');
  assert.equal(h.painted().length, 3, 'all three are painted, none left to "not placed"');
  assert.doesNotMatch(h.pill(), /not placed/);
  const rects = h.painted().sort((a, b) => a.top - b.top).map(p => ({ top: p.top, bottom: p.top + p.height }));
  for (let i = 1; i < rects.length; i++) assert.ok(rects[i - 1].bottom <= rects[i].top + 0.01, 'placed lines never cover each other: ' + JSON.stringify(rects));
});

test('PR #1114 review: two captions side by side on the same baseline, overlapping horizontally (not stacked), never paint one over the other', async () => {
  const lines = ['เราไปกินข้าวกันไหม', 'ฉันอยากไปเดินเล่น'], en = ['Shall we go eat?', 'I want to go for a walk'];
  // same t/b fraction as BOX[0] (0.30..0.34) on both, so each box alone would paint at top ~233, height ~33.2
  // (see the first test's comment). They sit side by side, not one above the other: A spans x .10-.52, B .30-.72,
  // a 52 % horizontal overlap of A's width — a loose/imprecise model box, same shape of overlap the first test
  // already keeps for vertically offset boxes. Neither box is offset in y at all.
  const A = [0.10, 0.30, 0.52, 0.34], B = [0.30, 0.30, 0.72, 0.34];
  const h = await harness();
  h.identity();
  h.pictured({ lines, boxes: [A, B] });
  h.translated({ items: en, from: 'Thai' });
  assert.deepEqual(Array.from(h.st.picRows, q => q.bi >= 0), [true, true], 'neither is dropped');
  const ps = h.painted();
  assert.equal(ps.length, 2, 'both painted');
  for (const p of ps) assert.ok(near(p.top, 233) && near(p.height, 33.2), 'side-by-side boxes keep their own full height, not halved as if stacked: ' + JSON.stringify(ps));
  // same row, so a plain top/bottom check can't see the defect: the two full-height boxes must not also overlap in x,
  // or their opaque translation panels paint on top of each other over the shared region.
  const [p0, p1] = ps.sort((a, b) => a.left - b.left);
  assert.ok(p0.left + p0.width <= p1.left + 0.01, 'placed lines never cover each other, even side by side: ' + JSON.stringify(ps));
});

test('PR #1114 review: the reverse x order (second box further left) is split the same way', async () => {
  const lines = ['เราไปกินข้าวกันไหม', 'ฉันอยากไปเดินเล่น'], en = ['Shall we go eat?', 'I want to go for a walk'];
  const A = [0.30, 0.30, 0.72, 0.34], B = [0.10, 0.30, 0.52, 0.34]; // same pair, boxes given in the other order
  const h = await harness();
  h.identity();
  h.pictured({ lines, boxes: [A, B] });
  h.translated({ items: en, from: 'Thai' });
  const ps = h.painted();
  assert.equal(ps.length, 2, 'both painted');
  const [p0, p1] = ps.sort((a, b) => a.left - b.left);
  assert.ok(p0.left + p0.width <= p1.left + 0.01, 'placed lines never cover each other regardless of input order: ' + JSON.stringify(ps));
});

test('diagonal overlap (neither a column stack nor a shared row) still never paints one caption over the other', async () => {
  const lines = ['เราไปกินข้าวกันไหม', 'ฉันอยากไปเดินเล่น'], en = ['Shall we go eat?', 'I want to go for a walk'];
  // same x positions as the side-by-side case above, but offset in y too: too little vertical overlap to be a
  // column stack, too little horizontal overlap (52 %) to be a shared row, so unstack() must still keep them apart.
  const A = [0.10, 0.30, 0.52, 0.34], B = [0.30, 0.315, 0.72, 0.355];
  const h = await harness();
  h.identity();
  h.pictured({ lines, boxes: [A, B] });
  h.translated({ items: en, from: 'Thai' });
  const ps = h.painted();
  assert.equal(ps.length, 2, 'both painted');
  const [p0, p1] = ps.sort((a, b) => a.top - b.top);
  const xOverlap = Math.min(p0.left + p0.width, p1.left + p1.width) - Math.max(p0.left, p1.left);
  const yOverlap = Math.min(p0.top + p0.height, p1.top + p1.height) - Math.max(p0.top, p1.top);
  assert.ok(xOverlap <= 0 || yOverlap <= 0.01, 'diagonal boxes must not paint over each other: ' + JSON.stringify(ps));
});

test('James: three distinct captions close together still split vertically (same-column stack unaffected by the side-by-side fix)', async () => {
  const lines = ['สวัสดีครับ', 'วันนี้อากาศดี', 'ไปเดินเล่นกันไหม'], en = ['Hello', 'The weather is nice today', 'Shall we go for a walk?'];
  const h = await harness();
  h.identity();
  h.pictured({ lines, boxes: [[0.10, 0.30, 0.70, 0.34], [0.10, 0.32, 0.70, 0.36], [0.10, 0.31, 0.70, 0.35]] });
  h.translated({ items: en, from: 'Thai' });
  assert.equal(h.painted().length, 3, 'all three are painted, none left to "not placed"');
  const rects = h.painted().sort((a, b) => a.top - b.top).map(p => ({ top: p.top, bottom: p.top + p.height }));
  for (let i = 1; i < rects.length; i++) assert.ok(rects[i - 1].bottom <= rects[i].top + 0.01, 'placed lines never cover each other: ' + JSON.stringify(rects));
});

test('either reply may land first: native English chrome later cannot corrupt Thai → English', async () => {
  const h = await harness();
  const nativeCall = h.next('translate');
  h.thaiPicture(); h.thaiEnglish();
  assert.match(h.pill(), /Detecting language/, 'still waiting on the app text');
  assert.deepEqual(h.painted().map(p => p.t), EN, 'picture lines are painted as soon as they are ready');
  h.identity(nativeCall);
  assert.deepEqual(h.painted().map(p => p.t), EN, 'a later native reply keeps the picture overlay');
  assert.equal(h.pill(), 'Thai → <b>English</b> ▾');
  assert.equal(h.st.trFrom, 'Thai');
});

test('French app text + Thai picture: both painted, both named', async () => {
  const h = await harness({ blocks: [blk('Bonjour', 20, 600, 80, 20)] });
  const nativeCall = h.next('translate');
  h.thaiPicture(); h.thaiEnglish();
  h.translated({ items: ['Hello'], from: 'French' }, nativeCall);
  assert.deepEqual(h.painted().map(p => p.t).sort(), ['Hello', ...EN].sort());
  assert.equal(h.pill(), 'French, Thai → <b>English</b> ▾', 'app text first, then picture, whichever replied first');
  h.node('#tCopy').fire('click'); assert.equal(h.next('copy').text, ['Hello', ...EN].join('\n'));
});

test('Original reveals the untouched picture; Translated brings the overlay back', async () => {
  const h = await harness(); h.identity(); h.thaiPicture(); h.thaiEnglish();
  const body = h.context.document.body;
  assert.equal(body.classList.contains('orig'), false);
  h.node('#orig').fire('click');
  assert.equal(body.classList.contains('orig'), true, 'body.orig hides #paint, showing the screenshot itself');
  assert.equal(h.node('#orig').textContent, 'Translated');
  h.node('#orig').fire('click');
  assert.equal(body.classList.contains('orig'), false);
  assert.equal(h.painted().length, 3, 'overlay untouched by the toggle');
  assert.match(page, /body\.orig #paint \{ display: none; \}/);
});

test('tap a painted picture line: its original + translation; outside tap and Back step off; Copy intact', async () => {
  const h = await harness(); h.identity(); h.thaiPicture(); h.thaiEnglish();
  const p = h.painted()[1];
  h.tap(p.left + 10, p.top + 5);
  assert.equal(h.sheet(), true);
  assert.equal(h.node('#sel').innerHTML, THAI[1] + '<span class="lab" style="margin-top:10px">English · from Thai</span>' + EN[1]);
  h.tap(300, 120); // nothing painted there
  assert.equal(h.sheet(), false, 'outside tap dismisses');
  assert.equal(h.painted().length, 3);
  h.tap(p.left + 10, p.top + 5); assert.equal(h.sheet(), true);
  assert.equal(h.context.S.back(), true); assert.equal(h.sheet(), false, 'Back steps off the pick first');
  assert.equal(h.painted().length, 3);
  assert.equal(h.context.S.back(), false, 'then Back closes Screen mode');
  h.node('#tCopy').fire('click'); assert.equal(h.next('copy').text, EN.join('\n'));
});

test('Select text: picture lines open whole, from the one read; Back returns to the painted translation', async () => {
  const h = await harness({ blocks: [], few: true });
  h.thaiPicture(); h.thaiEnglish();
  assert.equal(h.painted().length, 3);
  h.node('#tSel').fire('click');
  assert.equal(h.st.mode, 'select');
  assert.equal(h.st.panel, 'pic');
  assert.deepEqual([...h.st.pic], THAI, 'every recovered line, original text, none missing');
  assert.equal(h.all('picture').length, 1, 'no second upload of the pixels');
  assert.equal(h.sheet(), true);
  h.node('#all').fire('click'); assert.equal(h.st.picSel.size, 3);
  assert.equal(h.context.S.back(), true); assert.equal(h.st.picSel.size, 0);
  assert.equal(h.context.S.back(), true);
  assert.equal(h.st.mode, 'translate', 'Back returns to Translate');
  assert.equal(h.painted().length, 3);
});

test('a new target during the read reuses that one read; stale replies are ignored', async () => {
  const h = await harness(); const oldNative = h.next('translate');
  h.st.to = 'French'; h.context.__test.st.trPick = -1;
  h.node('#langs').fire('click', { target: { closest: () => ({ dataset: { lang: 'Japanese' } }) } });
  assert.equal(h.st.to, 'Japanese');
  assert.equal(h.all('picture').length, 1, 'the pixels are not sent again');
  h.identity(oldNative);
  assert.match(h.pill(), /Detecting language/, 'an old-language reply is ignored');
  h.thaiPicture();
  const pic = h.next('translate'); assert.equal(pic.to, 'Japanese'); assert.deepEqual(pic.items, THAI);
  h.translated({ items: ['JA1', 'JA2', 'JA3'], from: 'Thai' }, pic);
  h.identity(h.all('translate').filter(c => c.to === 'Japanese')[0]);
  assert.deepEqual(h.painted().map(p => p.t), ['JA1', 'JA2', 'JA3']);
  assert.equal(h.pill(), 'Thai → <b>Japanese</b> ▾');
});

test('language change after success re-places from the cached read without duplicate blocks', async () => {
  const h = await harness(); h.identity(); h.thaiPicture(); h.thaiEnglish();
  const blocks = h.st.blocks.length;
  h.node('#langs').fire('click', { target: { closest: () => ({ dataset: { lang: 'French' } }) } });
  assert.equal(h.painted().length, 0, 'old language cleared at once');
  assert.equal(h.all('picture').length, 1);
  const pic = h.next('translate'); assert.deepEqual(pic.items, THAI);
  h.translated({ items: ['FR1', 'FR2', 'FR3'], from: 'Thai' }, pic);
  h.identity(h.all('translate').at(-2));
  assert.equal(h.st.blocks.length, blocks, 'picture blocks replaced, not appended again');
  assert.deepEqual(h.painted().map(p => p.t), ['FR1', 'FR2', 'FR3']);
});

test('read and translation failures are explicit and retry honestly', async () => {
  let h = await harness(); h.identity(); h.pictured({ error: 'Vision unavailable' });
  assert.match(h.pill(), /Picture text failed · tap to retry/);
  h.node('#pill').fire('click');
  assert.equal(h.all('picture').length, 2, 'a failed read is read again');
  for (const reply of [{}, { lines: 'bad' }, { lines: [42] }]) { h = await harness(); h.identity(); h.pictured(reply); assert.match(h.pill(), /Picture text failed/); }
  for (const reply of [{ error: 'Provider unavailable' }, { items: [] }, { items: [''] }, { items: EN, foreign: [] }, { items: THAI }]) {
    h = await harness(); h.identity(); h.thaiPicture(); h.translated(reply);
    assert.match(h.pill(), /Picture text failed · tap to retry/, JSON.stringify(reply));
    assert.equal(h.painted().length, 0);
  }
  h = await harness(); h.translated({ error: 'timeout' }); h.thaiPicture(); h.thaiEnglish();
  assert.equal(h.painted().length, 3, 'the picture still paints when the app text failed');
  assert.match(h.pill(), /Translation failed · tap to retry/);
  h.node('#pill').fire('click');
  assert.equal(h.all('picture').length, 1, 'retry reuses the successful read');
  assert.equal(h.painted().length, 0);
  const stale = h.all('translate')[1];
  h.translated({ items: ['WRONG', 'WRONG', 'WRONG'], from: 'Thai' }, stale);
  assert.equal(h.painted().length, 0, 'a reply from the failed run cannot paint');
  h.identity(h.all('translate')[2]); h.thaiEnglish();
  assert.deepEqual(h.painted().map(p => p.t), EN);
});

test('all-English picture: no second translation of known lines, honest verdict', async () => {
  const h = await harness(); h.identity(); h.pictured({ lines: ['Saved Messages', 'today at 17:57'], boxes: [null, null] });
  assert.equal(h.all('translate').length, 1);
  assert.match(h.pill(), /No other language found/);
  const h2 = await harness(); h2.identity(); h2.pictured({ lines: ['Hello world'], boxes: [BOX[0]] }); h2.identity();
  assert.equal(h2.painted().length, 0, 'unchanged English picture text is left as it is');
  assert.match(h2.pill(), /No other language found/);
});

test('no screenshot: no pixels sent, qualified readable-text verdict', async () => {
  const h = await harness({ shot: false }); h.identity();
  assert.equal(h.next('picture'), undefined);
  assert.match(h.pill(), /Readable text is in English/);
});

test('image-only and numeric-only app text still read and paint the picture', async () => {
  for (const blocks of [[], [blk('17:57', 300, 700, 40, 14)]]) {
    const h = await harness({ blocks });
    assert.ok(h.next('picture'));
    h.thaiPicture(); h.thaiEnglish();
    assert.deepEqual(h.painted().map(p => p.t), EN);
  }
});

test('with the pixels at hand, a box is tightened to real strokes; a box over no letters is not painted', async () => {
  const h = await harness();
  // synthetic 720x1560 screenshot: white, one row of 2 px strokes every 6 px at x 100..400, y 600..640 (screen px)
  const W = 720, H = 1560, ink = (x, y) => y >= 600 && y < 640 && x >= 100 && x < 400 && (x - 100) % 6 < 2;
  h.context.__test.setPx({ w: W, h: H, k: 1, x: { getImageData(x0, y0, w, hh) {
    const data = new Uint8ClampedArray(w * hh * 4);
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { const v = ink(x0 + i, y0 + j) ? 0 : 255, q = (j * w + i) * 4; data[q] = data[q + 1] = data[q + 2] = v; data[q + 3] = 255; }
    return { data };
  } } });
  const b = h.context.__test.pictureBox([90 / W, 590 / H, 420 / W, 650 / H]); // a loose model box
  // strokes span css y 300..320; like a placed word the line is padded by 22 % of its height above and below
  assert.ok(b && near(b.x, 50, 2) && near(b.y, 295.6, 2) && near(b.x + b.w, 200, 2) && near(b.y + b.h, 324.4, 2), JSON.stringify(b));
  assert.equal(h.context.__test.pictureBox([100 / W, 900 / H, 400 / W, 940 / H]), null, 'blank pixels: no place');
});

test('sparse combining marks above and below a picture line (like ้ and ู) stay under the painted translation', async () => {
  const h = await harness();
  // synthetic 720x1560 screenshot: a stroke band y 600..640 px, one isolated mark above it (y 590..598) and one below
  // (y 642..650). A lone mark is too sparse to count as a row of text, as Thai tone marks and below-vowels are.
  const W = 720, H = 1560;
  const band = (x, y) => y >= 600 && y < 640 && x >= 100 && x < 400 && (x - 100) % 6 < 2;
  const marks = [[250, 590, 256, 598], [160, 642, 166, 650]];
  const mark = (x, y) => marks.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
  const ink = (x, y) => band(x, y) || mark(x, y);
  h.context.__test.setPx({ w: W, h: H, k: 1, x: { getImageData(x0, y0, w, hh) {
    const data = new Uint8ClampedArray(w * hh * 4);
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { const v = ink(x0 + i, y0 + j) ? 0 : 255, q = (j * w + i) * 4; data[q] = data[q + 1] = data[q + 2] = v; data[q + 3] = 255; }
    return { data };
  } } });
  h.identity();
  h.pictured({ lines: [THAI[0]], boxes: [[90 / W, 585 / H, 420 / W, 655 / H]] });
  h.thaiEnglish();
  const [p] = h.painted();
  assert.ok(p && p.t === EN[0], 'the line is painted');
  // every ink pixel of the line, marks included, must be under the painted rect (css px = screen px / dpr 2)
  const uncovered = [];
  for (let y = 585; y < 655; y++) for (let x = 90; x < 420; x++) {
    if (!ink(x, y)) continue;
    const cx = (x + 0.5) / DPR, cy = (y + 0.5) / DPR;
    if (cx < p.left || cx > p.left + p.width || cy < p.top || cy > p.top + p.height) uncovered.push([x, y]);
  }
  assert.equal(uncovered.length, 0, 'uncovered ink px (first): ' + JSON.stringify(uncovered.slice(0, 4)) + ' painted ' + JSON.stringify(p));
});

test('two tight caption lines: each wrapped translation stays inside its own box, neither covers the other', async () => {
  // Two picture lines a few px apart (the second even overlapping the first), on the right of a 360 px screen, so a
  // longer English line can only take the room to the screen edge and must wrap.
  const h = await harness({ make: laidOut });
  h.identity();
  const lines = ['โอเค แล้วที่นั่น', 'มีสาวๆ ไหม?'], en = ['Okay, and over there?', 'Are there any girls?'];
  h.pictured({ lines, boxes: [[0.55, 0.47, 0.9, 0.506], [0.55, 0.503, 0.9, 0.54]] });
  h.translated({ items: en, from: 'Thai' });
  const els = h.node('#paint').children;
  assert.deepEqual(els.map(e => e.textContent), en);
  for (const e of els) {
    assert.ok(e.scrollHeight <= e.clientHeight + 1, 'text fits its own box: ' + JSON.stringify({ t: e.textContent, sh: e.scrollHeight, ch: e.clientHeight, f: e.style.fontSize, height: e.style.height }));
    assert.notEqual(e.style.height, 'auto', 'the box does not grow over the next line');
  }
  const [a, b] = els.map(e => e.getBoundingClientRect());
  assert.ok(a.bottom <= b.top + 0.01, 'painted lines do not overlap: ' + JSON.stringify([a, b]));
});

test('Appearance v1 roles with dark standalone fallbacks; text overlays are opaque', () => {
  const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
  for (const role of ['--wz-accent, #b99bff', '--wz-text, #f4f1ff', '--wz-text-secondary, #a79fc4', '--wz-panel, #120e24', '--wz-border,'])
    assert.ok(css.includes('var(' + role), role);
  assert.doesNotMatch(css, /--wz-ink|--wz-line\b/, 'not real Appearance v1 roles');
  assert.match(css, /#hint \{[^}]*background: var\(--card\)/);
  assert.doesNotMatch(css, /\.sheet \{[^}]*background: rgba/);
  assert.match(source, /background: c\.bg, color: c\.fg/, 'painted text takes the sampled opaque colours');
});
