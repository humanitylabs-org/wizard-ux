// Screen page QA (no device): screen.html with a fake ScreenNative bridge, a fake screenshot holding Thai + English
// text, real touch drags. usage: node tools/qa-screen-page.cjs [screen.html] [outdir]
const { chromium } = require('./qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const { outsideTarget, sheetSettled, hitTarget } = require('./qa-screen-hit.cjs');
const PAGE = path.resolve(process.argv[2] || path.join(__dirname, '../android/app/src/main/assets/assist/screen.html'));
const OUT = process.argv[3] || '/tmp/qa-screen-page';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 300) : '')); };

// The "app" screen we pretend is underneath: drawn by a canvas so the screenshot holds real pixels, and its text
// reported as accessibility blocks (dpr 2.625 like a Pixel), one block with exact word boxes, one without.
const DPR = 2.625, W = 411, H = 914;
const LINES = [
  { t: 'ผัดกะเพราหมูสับไข่ดาว', x: 20, y: 140, f: 22, bg: '#ffffff', fg: '#111111' },
  { t: 'ส่งฟรีเมื่อสั่งครบ 200 บาท', x: 20, y: 190, f: 18, bg: '#ffffff', fg: '#c62828' },
  { t: 'Order number 4471 ready at counter', x: 20, y: 240, f: 18, bg: '#ffffff', fg: '#111111' },
  { t: 'Fermé le lundi', x: 20, y: 300, f: 26, bg: '#1e3a8a', fg: '#ffffff' },
];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
  // 1. draw the fake app screen and measure where its words are
  const app = await ctx.newPage();
  await app.setContent(`<body style="margin:0;background:#fff"><canvas id=c width=${W * DPR} height=${H * DPR} style="width:${W}px;height:${H}px"></canvas></body>`);
  const scr = await app.evaluate(({ LINES, DPR, W, H }) => {
    const c = document.getElementById('c').getContext('2d'); c.scale(DPR, DPR);
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#eee'; c.fillRect(0, 0, W, 60); c.fillStyle = '#333'; c.font = '16px sans-serif'; c.fillText('Menu', 16, 36);
    const blocks = [], truth = {}, boxes = [];
    LINES.forEach((L, li) => {
      c.font = L.f + 'px sans-serif';
      const tw = c.measureText(L.t).width;
      c.fillStyle = L.bg; c.fillRect(L.x - 6, L.y - L.f - 4, tw + 12, L.f * 1.5 + 4);
      c.fillStyle = L.fg; c.fillText(L.t, L.x, L.y);
      const top = L.y - L.f * 0.95, h = L.f * 1.25;
      boxes.push([L.x / W, top / H, (L.x + tw) / W, (top + h) / H]); // what read-image?geometry=1 answers
      // line 1 is reported like a web paragraph: the whole column, not the words (the page must find the ink)
      const blk = li === 1 ? { t: L.t, x: 8 * DPR, y: (top - 6) * DPR, w: (W - 16) * DPR, h: (h + 12) * DPR, l: false }
        : { t: L.t, x: (L.x - 2) * DPR, y: top * DPR, w: (tw + 4) * DPR, h: h * DPR, l: false };
      // words (split on spaces; Thai as one word) with exact boxes for lines 0, 2, 3; line 1 has none (layout path)
      const parts = L.t.split(/( )/), wd = []; let x = L.x;
      for (let i = 0; i < parts.length; i += 2) {
        const w = c.measureText(parts[i]).width, sp = parts[i + 1] ? ' ' : '';
        wd.push(li === 1 ? [parts[i], sp] : [parts[i], sp, Math.round(x * DPR), Math.round(top * DPR), Math.round(w * DPR), Math.round(h * DPR)]);
        if (li === 1) truth[parts[i]] = { l: x, r: x + w, y: L.y - L.f / 2 };
        x += w + (sp ? c.measureText(' ').width : 0);
      }
      blk.wd = wd; blk.ex = li !== 1;
      blocks.push(blk);
    });
    blocks.push({ t: 'Menu', x: 10 * DPR, y: 10 * DPR, w: 60 * DPR, h: 40 * DPR, l: true }); // icon label
    return { blocks, truth, boxes, jpeg: document.getElementById('c').toDataURL('image/jpeg', .9).split(',')[1] };
  }, { LINES, DPR, W, H });
  await app.close();

  async function openScreen(mode, blocks = scr.blocks) {
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text()); });
    p.on('pageerror', e => console.log('  pageerror:', e.message));
    await p.addInitScript(({ jpeg, read }) => {
      window.__calls = [];
      const rec = (k, ...a) => window.__calls.push([k, ...a]);
      window.ScreenNative = {
        close: () => rec('close'), copy: t => rec('copy', t), search: (q, f) => rec('search', q), sheet: f => rec('sheet', f),
        closeSearch: () => rec('closeSearch'), ask: t => rec('ask', t), shot: () => jpeg, log: s => rec('log', s),
        picture: id => { rec('picture', id); setTimeout(() => window.S.pictured(id, read), 25); },
        translate: (id, items, to) => {
          rec('translate', JSON.parse(items), to);
          const its = JSON.parse(items);
          const tr = { 'ผัดกะเพราหมูสับไข่ดาว': 'Stir-fried basil pork with fried egg', 'ส่งฟรีเมื่อสั่งครบ 200 บาท': 'Free delivery on orders over 200 baht', 'ส่งฟรีเมื่อสั่งครบ 200': 'Free delivery on orders over 200', 'Fermé le lundi': 'Closed on Monday' };
          const lang = t => /[\u0E00-\u0E7F]/.test(t) ? 'Thai' : t === 'Fermé le lundi' ? 'French' : 'English';
          setTimeout(() => window.S.translated(id, { to, from: 'Thai, French', items: its.map(t => to === 'English' ? (tr[t] || t) : '[' + to + '] ' + t),
            langs: its.map(lang), foreign: its.map(t => to === 'English' ? lang(t) !== 'English' : true) }), 150);
        },
      };
    }, { jpeg: scr.jpeg, read: { lines: LINES.map(L => L.t), boxes: scr.boxes } });
    await p.goto('file://' + PAGE);
    await p.evaluate(({ blocks, mode, DPR }) => window.S.open({ mode, dpr: DPR, ox: 0, oy: 0, sw: 411 * DPR, sh: 914 * DPR, top: 24, bot: 48, shot: true, few: false, blocks }), { blocks, mode, DPR });
    await p.waitForTimeout(500);
    return p;
  }
  const peek = p => p.evaluate(() => window.S.peek());
  const css = (p, v) => v / DPR;
  async function touchDrag(p, from, to, steps = 12, hold = 0) {
    const cdp = await p.context().newCDPSession(p);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from[0], from[1]) });
    if (hold) await p.waitForTimeout(hold);
    for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(250);
  }
  const tap = async (p, x, y) => { await p.touchscreen.tap(x, y); await p.waitForTimeout(250); };

  /* ---------------- Select text: free selection ---------------- */
  let p = await openScreen('select');
  let k = await peek(p);
  check('no boxes drawn around text (Google style: the screen stays as it was)', k.boxes === 0 && k.hl === 0, k.boxes);
  check('every visible word is selectable, icon labels are not', k.words.length >= 12 && !k.words.some(w => w.t === 'Menu'), k.words.map(w => w.t));
  check('the hint says drag or tap', (await p.textContent('#hint')).includes('Drag'));
  await p.screenshot({ path: OUT + '/01-select-open.png' });
  const W_ = t => k.words.find(w => w.t === t);
  {
    const w200 = W_('200'), t200 = scr.truth['200'], wB = W_('บาท'), tB = scr.truth['บาท'];
    const off = (w, t) => [Math.round(css(p, w.l) - t.l), Math.round(css(p, w.r) - t.r), Math.round(css(p, w.y) - t.y)];
    check('words the app did not place still land on their real ink (fitted from the screenshot)',
      w200 && wB && off(w200, t200).every(v => Math.abs(v) <= 8) && off(wB, tB).every(v => Math.abs(v) <= 8), [off(w200, t200), off(wB, tB)]);
  }
  const w1 = W_('number'), w2 = W_('ready');
  await touchDrag(p, [css(p, w1.l) + 2, css(p, w1.y)], [css(p, w2.r) - 2, css(p, w2.y)]);
  k = await peek(p);
  check('a drag inside a line selects exactly the words it crossed', k.selText === 'number 4471 ready', k.selText);
  check('the selection is highlighted, with two handles', k.hl >= 1 && k.handles[0] && k.handles[1], k.handles);
  check('the action sheet opens with the selection', k.sheet && k.sheetText.includes('number 4471 ready'), k.sheetText);
  await p.screenshot({ path: OUT + '/02-drag-part-line.png' });
  // drag the end handle down to the French line
  const fr = W_('lundi');
  await touchDrag(p, [css(p, k.handles[1][0]), css(p, k.handles[1][1])], [css(p, fr.x), css(p, fr.y) + 26]);
  k = await peek(p);
  check('dragging the end handle extends the selection across lines', k.selText === 'number 4471 ready at counter\nFermé le lundi', k.selText);
  // start handle back to "Order"
  const ord = W_('Order');
  await touchDrag(p, [css(p, k.handles[0][0]), css(p, k.handles[0][1])], [css(p, ord.x), css(p, ord.y) + 26]);
  k = await peek(p);
  check('dragging the start handle moves the start', k.selText.startsWith('Order number'), k.selText);
  await p.screenshot({ path: OUT + '/03-handles.png' });
  await tap(p, css(p, k.btn.aCopy[0]), css(p, k.btn.aCopy[1]));
  let calls = await p.evaluate(() => window.__calls);
  check('Copy copies exactly the selected text', calls.some(c => c[0] === 'copy' && c[1] === 'Order number 4471 ready at counter\nFermé le lundi'), calls.filter(c => c[0] === 'copy'));
  // drag across two lines from the middle of the Thai one (layout-path line 1 included)
  const th = W_('ผัดกะเพราหมูสับไข่ดาว'), baht = W_('200');
  await touchDrag(p, [css(p, th.x), css(p, th.y)], [css(p, baht.r) - 1, css(p, baht.y)]);
  k = await peek(p);
  check('a drag over lines without word positions still selects word by word', k.selText === 'ผัดกะเพราหมูสับไข่ดาว\nส่งฟรีเมื่อสั่งครบ 200', k.selText);
  await tap(p, css(p, k.btn.aTrans[0]), css(p, k.btn.aTrans[1])); await p.waitForTimeout(300);
  k = await peek(p);
  check('Translate in the sheet shows English under the selection', k.sheetText.includes('Stir-fried basil pork') && k.sheetText.includes('Free delivery on orders over 200') && /english/i.test(k.sheetText), k.sheetText);
  await p.screenshot({ path: OUT + '/04-sheet-translate.png' });
  // tap a word → its whole line; tap empty space → clear
  await tap(p, css(p, W_('counter').x), css(p, W_('counter').y));
  k = await peek(p);
  check('a tap on text selects that piece of text', k.selText === 'Order number 4471 ready at counter', k.selText);
  await tap(p, 200, 700);
  k = await peek(p);
  check('a tap on empty space clears the selection', !k.sel && !k.sheet, k.sel);
  await tap(p, css(p, k.btn.all[0]), css(p, k.btn.all[1]));
  k = await peek(p);
  check('Select all selects every word', k.sel && k.sel[0] === 0 && k.sel[1] === k.words.length - 1, k.sel);
  check('Back clears the selection first', await p.evaluate(() => window.S.back()) && !(await peek(p)).sel);
  check('… then Back closes Screen mode', !(await p.evaluate(() => window.S.back())));
  await p.close();

  /* ---------------- Translate screen: Lens style ---------------- */
  p = await openScreen('translate');
  await p.waitForTimeout(700);
  k = await peek(p);
  calls = await p.evaluate(() => window.__calls);
  const sent = (calls.find(c => c[0] === 'translate') || [])[1] || [];
  check('it reads the screen and translates on its own (no tapping)', sent.length >= 3 && k.tr && Object.keys(k.tr).length === 3, sent);
  check('only the foreign text is painted over (English lines stay untouched)', k.painted.length === 3 && !k.painted.some(e => /Order number/.test(e.t)), k.painted.map(e => e.t));
  check('picture lines the app already reports (same words, same place) are not painted twice', k.pictureState === 'done' && !k.painted.some(e => e.pic)
    && calls.filter(c => c[0] === 'picture').length === 1 && calls.filter(c => c[0] === 'translate').length === 1, [k.pictureState, k.painted.map(e => e.pic)]);
  check('the pill names the detected languages and the target', /Thai/.test(k.pill) && /English/.test(k.pill), k.pill);
  const frP = k.painted.find(e => e.t === 'Closed on Monday'), thP = k.painted.find(e => /basil/.test(e.t));
  const rgb = s => (s.match(/\d+/g) || []).map(Number);
  check('each translation takes the colours of what it covers (dark blue sign stays dark, white menu stays white)',
    frP && rgb(frP.bg)[2] > rgb(frP.bg)[0] + 40 && rgb(frP.fg)[0] > 200 && thP && rgb(thP.bg)[0] > 220, [frP && frP.bg, frP && frP.fg, thP && thP.bg]);
  check('no selection boxes or hint in translate view', k.boxes === 0 && k.hl === 0 && !k.sheet && k.tbar, [k.boxes, k.sheet, k.tbar]);
  await p.screenshot({ path: OUT + '/05-translate-screen.png' });
  {
    const hiddenOff = s => !s.visible || s.top >= k.vh;
    check('closed sheets are fully off screen, never peeking behind the nav bar', hiddenOff(k.sheets.langs) && hiddenOff(k.sheets.sheet), k.sheets);
    check('the translation bar starts docked at the bottom', k.dock === 'bottom' && k.sheets.tbar.visible && k.sheets.tbar.bottom > k.vh * .8, k.sheets.tbar);
    const tb = k.btn.tSel, cp = (await p.evaluate(() => window.__calls)).filter(c => c[0] === 'copy').length;
    await touchDrag(p, [css(p, tb[0]), css(p, tb[1])], [css(p, tb[0]), css(p, tb[1]) - 140], 4);
    await p.waitForTimeout(300);
    k = await peek(p);
    check('a quick flick up docks the bar at the top', k.dock === 'top' && k.sheets.tbar.visible && k.sheets.tbar.top < k.vh * .25, [k.dock, k.sheets.tbar]);
    check('the flick did not press the button under the finger', k.mode === 'translate' && (await p.evaluate(() => window.__calls)).filter(c => c[0] === 'copy').length === cp, k.mode);
    await p.screenshot({ path: OUT + '/05b-docked-top.png' });
    const tb2 = k.btn.tAsk;
    await touchDrag(p, [css(p, tb2[0]), css(p, tb2[1])], [css(p, tb2[0]), css(p, tb2[1]) + 140], 4);
    await p.waitForTimeout(300);
    k = await peek(p);
    check('a flick down docks it back at the bottom', k.dock === 'bottom' && k.sheets.tbar.bottom > k.vh * .8 && !(await p.evaluate(() => window.__calls)).some(c => c[0] === 'ask'), [k.dock, k.sheets.tbar]);
    // dock top again: the tapped-translation sheet and the language list follow it
    await touchDrag(p, [css(p, k.btn.tSel[0]), css(p, k.btn.tSel[1])], [css(p, k.btn.tSel[0]), css(p, k.btn.tSel[1]) - 140], 4);
    await p.waitForTimeout(300);
    k = await peek(p);
    const frT = k.painted.find(e => e.t === 'Closed on Monday');
    await tap(p, css(p, frT.c[0]), css(p, frT.c[1]));
    k = await peek(p);
    check('when docked top, the picked translation sheet opens at the top too', k.sheet && k.sheets.sheet.top < k.vh * .25, k.sheets.sheet);
    await p.evaluate(() => window.S.back());
  }
  await tap(p, css(p, frP.c[0]), css(p, frP.c[1]));
  k = await peek(p);
  check('tapping a translation shows it with its original in the sheet', k.sheet && k.sheetText.includes('Fermé le lundi') && k.sheetText.includes('Closed on Monday'), k.sheetText);
  await p.screenshot({ path: OUT + '/06-translate-tap.png' });
  check('Back steps off the picked translation, staying on the translated screen', await p.evaluate(() => window.S.back()) && (await peek(p)).painted.length === 3 && !(await peek(p)).sheet);
  k = await peek(p);
  await tap(p, css(p, k.btn.orig[0]), css(p, k.btn.orig[1]));
  check('Original hides the translations', (await peek(p)).showOrig && await p.evaluate(() => getComputedStyle(document.getElementById('paint')).display === 'none'));
  await tap(p, css(p, k.btn.orig[0]), css(p, k.btn.orig[1]));
  await tap(p, css(p, k.btn.pill[0]), css(p, k.btn.pill[1]));
  k = await peek(p);
  check('the pill opens a language list', k.langsOpen && k.langBtn.Thai, Object.keys(k.langBtn));
  await p.screenshot({ path: OUT + '/07-languages.png' });
  await tap(p, css(p, k.langBtn.Japanese[0]), css(p, k.langBtn.Japanese[1])); await p.waitForTimeout(500);
  k = await peek(p);
  calls = await p.evaluate(() => window.__calls);
  check('picking Japanese translates the screen again into Japanese', k.to === 'Japanese' && calls.filter(c => c[0] === 'translate').pop()[2] === 'Japanese' && k.painted.length === 4, [k.to, k.painted.length]);
  await tap(p, css(p, k.btn.tCopy[0]), css(p, k.btn.tCopy[1]));
  calls = await p.evaluate(() => window.__calls);
  check('Copy translation copies the whole translated screen', calls.some(c => c[0] === 'copy' && c[1].split('\n').length === 4), calls.filter(c => c[0] === 'copy'));
  await p.close();
  p = await openScreen('translate'); await p.waitForTimeout(700);
  check('the chosen language is remembered next time', (await peek(p)).to === 'Japanese');
  check('the dock position is remembered next time', (await peek(p)).dock === 'top', (await peek(p)).dock);
  await p.evaluate(() => localStorage.removeItem('wizScreenDock'));
  await p.evaluate(() => localStorage.removeItem('wizScreenTo'));
  await p.close();

  /* ---------------- Translate screen: text only in the picture (the app doesn't report the Thai dish) ---------------- */
  p = await openScreen('translate', scr.blocks.filter((_, i) => i !== 0));
  // fail closed: a run that never settles is a failed check with its error, not a silent pass
  const settledErr = await p.waitForFunction(() => window.S.peek().pictureState === 'done' && window.S.peek().nativeState === 'done', null, { timeout: 5000 }).then(() => null, e => String(e).slice(0, 200));
  check('the app text and the picture both finish', !settledErr, settledErr);
  k = await peek(p);
  const dish = k.painted.find(e => e.pic);
  const truth = scr.boxes[0].map((v, i) => v * (i % 2 ? 914 : 411) * DPR);
  // the drawn line's full height (Thai marks above and below included) must be covered, within 3 css px
  check('picture-only Thai is painted by the same renderer over its own letters, marks included',
    dish && dish.t === 'Stir-fried basil pork with fried egg' && Math.abs(dish.r[0] - truth[0]) <= 6 * DPR && dish.r[1] <= truth[1] + 3 * DPR && dish.r[3] >= truth[3] - 3 * DPR, [dish, truth]);
  check('it takes the colours of the picture under it (white menu)', dish && rgb(dish.bg)[0] > 220 && rgb(dish.fg)[0] < 80, dish && [dish.bg, dish.fg]);
  check('the app text and the picture text are painted together, no panel', k.painted.length === 3 && !k.sheet && k.tbar && k.panel === 'sel', [k.painted.length, k.sheet, k.panel]);
  check('the pill names Thai → English, never English → English', /Thai/.test(k.pill) && /English/.test(k.pill) && !/English\s*→/.test(k.pill) && !/not placed/.test(k.pill), k.pill);
  await p.screenshot({ path: OUT + '/08-picture-overlay.png' });
  await tap(p, css(p, k.btn.orig[0]), css(p, k.btn.orig[1]));
  check('Original shows the picture itself again', await p.evaluate(() => getComputedStyle(document.getElementById('paint')).display === 'none'));
  await p.screenshot({ path: OUT + '/08b-picture-original.png' });
  await tap(p, css(p, k.btn.orig[0]), css(p, k.btn.orig[1]));
  await tap(p, css(p, dish.c[0]), css(p, dish.c[1]));
  {
    // Settle every moving part before choosing real touch targets; diagnostics are kept for review either way.
    const settle = (id, want) => p.waitForFunction(sheetSettled, [id, want], { polling: 'raf', timeout: 5000 }).then(() => null, e => String(e).slice(0, 200));
    const diag = { dock: (await peek(p)).dock };
    diag.pickedSettle = await settle('sheet', true);
    k = await peek(p);
    check('tapping the painted picture line shows its Thai and its English', !diag.pickedSettle && k.sheet && k.sheetText.includes('ผัดกะเพราหมูสับไข่ดาว') && k.sheetText.includes('Stir-fried basil pork'), [diag.pickedSettle, k.sheetText]);
    await p.screenshot({ path: OUT + '/08c-picture-picked.png' });
    // r1 evidence: where the old blind outside tap (200,760) lands in this settled picked state (read-only)
    diag.blind = await p.evaluate(([x, y]) => {
      const at = document.elementFromPoint(x, y), r = document.getElementById('sheet').getBoundingClientRect();
      return { point: [x, y], hit: at ? at.id || at.className || at.tagName : null, inSheet: !!(at && at.closest('#sheet')),
        sheet: [r.left, r.top, r.right, r.bottom], dock: document.body.classList.contains('dtop') ? 'top' : 'bottom', viewport: [innerWidth, innerHeight] };
    }, [200, 760]);
    // outside: hit-tested on the touch layer, clear of the picked sheet (wherever it is docked), chrome and paint
    diag.outside = await p.evaluate(outsideTarget);
    diag.before = { sheets: k.sheets, painted: k.painted.map(e => e.r) };
    const pt = diag.outside.point;
    if (pt) await tap(p, pt.x, pt.y);
    diag.dismissSettle = pt ? await settle('sheet', false) : 'no clear outside point';
    diag.tbarSettle = pt ? await settle('tbar', true) : 'no clear outside point';
    k = await peek(p);
    diag.after = { sheets: k.sheets, sheet: k.sheet, tbar: k.tbar, painted: k.painted.map(e => e.r) };
    await p.screenshot({ path: OUT + '/08d-picture-dismissed.png' });
    check('a real tap outside (on the touch layer, clear of sheets/chrome/paint) dismisses it; the overlay stays',
      pt && diag.outside.hit === 'layer' && !diag.dismissSettle && !diag.tbarSettle && !k.sheet && k.tbar && k.painted.length === 3,
      [pt, diag.outside.hit, diag.dismissSettle, diag.tbarSettle, k.sheet, k.painted.length]);
    // Copy translation: the real button, hit-tested where the tap will land
    diag.copyTarget = await p.evaluate(hitTarget, 'tCopy');
    if (diag.copyTarget.ok) await tap(p, diag.copyTarget.x, diag.copyTarget.y);
    calls = await p.evaluate(() => window.__calls);
    const copied = (calls.filter(c => c[0] === 'copy').pop() || [])[1] || '';
    diag.copied = copied;
    fs.writeFileSync(OUT + '/08-picture-touch-diagnostics.json', JSON.stringify(diag, null, 2));
    check('Copy translation (hit-tested) has every line once, the picture line included',
      diag.copyTarget.ok && copied.split('\n').length === 3 && copied.split('\n').filter(l => /basil/.test(l)).length === 1, [diag.copyTarget, copied]);
  }
  await p.close();
  await b.close();
  console.log(`${pass}/${pass + fail} passed · ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
