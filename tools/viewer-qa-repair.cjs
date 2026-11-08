'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { decodePNG, compare, interiorROI, containedMetrics } = require('./viewer-qa-oracles.cjs');
const hash = b => require('node:crypto').createHash('sha256').update(b).digest('hex');
const write = (out, name, data) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(data, null, 2) + '\n');
// Serialize this exact function into the page. Let Chromium parse modern CSS
// colours (including color(srgb ...)); a spelling regex is not an alpha oracle.
function panelPaint(e) {
  const background = getComputedStyle(e).backgroundColor, canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = 'transparent'; ctx.fillStyle = background; ctx.fillRect(0, 0, 1, 1);
  const rgba = [...ctx.getImageData(0, 0, 1, 1).data];
  let effectiveOpacity = 1;
  for (let n = e; n; n = n.parentElement) effectiveOpacity *= Number(getComputedStyle(n).opacity);
  return { background, rgba, effectiveOpacity };
}
async function paintCalibration({ p, out }) {
  const receipts = [];
  await p.evaluate(() => { const host = document.createElement('div'); host.id = 'viewer-paint-calibration'; host.style.cssText = 'position:fixed;left:-100px;top:-100px'; host.appendChild(document.createElement('div')); document.body.appendChild(host); });
  try {
    const panel = p.locator('#viewer-paint-calibration > div');
    for (const [color, alpha, opacity] of [['color(srgb 0.112941 0.104314 0.142353)', 255, 1], ['color(srgb 0.2 0.3 0.4 / 0.5)', 128, 1], ['rgba(12, 23, 34, 0)', 0, 1], ['rgb(12, 23, 34)', 255, 0.5]]) {
      await panel.evaluate((e, x) => { e.style.backgroundColor = x.color; e.parentElement.style.opacity = String(x.opacity); }, { color, opacity });
      const paint = await panel.evaluate(panelPaint); receipts.push({ color, alpha, opacity, paint }); write(out, 'css-alpha-calibration', receipts);
      assert.equal(paint.rgba[3], alpha, 'real Chromium parsed alpha'); assert.equal(paint.effectiveOpacity, opacity, 'real ancestor opacity');
    }
  } finally { await p.locator('#viewer-paint-calibration').evaluate(e => e.remove()); }
}
async function zoom({ p, out, settle, state, open, fits }) {
  await open();
  await p.evaluate(() => {
    window.__viewerInput = [];
    for (const type of ['pointerdown', 'pointerup', 'gotpointercapture', 'lostpointercapture', 'click', 'dblclick']) document.addEventListener(type, e => {
      if (__viewerInput.length < 100) __viewerInput.push({ type, trusted: e.isTrusted, pointerType: e.pointerType, detail: e.detail, x: e.clientX, y: e.clientY, target: e.target.className, state: WosChat.viewer.state });
    }, true);
  });
  const journal = [];
  const snapshot = async label => {
    journal.push(await p.evaluate(label => { const v = document.querySelector('.mviewer'), img = v?.querySelector('img'), s = v?.querySelector('.mv-stage'); return { label, state: WosChat.viewer.state, active: document.activeElement?.className, image: img?.getBoundingClientRect().toJSON(), stage: s?.getBoundingClientRect().toJSON(), events: [...__viewerInput] }; }, label));
    write(out, 'desktop-zoom-input', journal);
  };
  const ink = await p.evaluate(() => {
    const i = document.querySelector('.mv-stage img'), r = i.getBoundingClientRect(), b = i.parentElement.getBoundingClientRect(), long = WosChat.viewer.state.long;
    const k = Math.min(r.width / i.naturalWidth, r.height / i.naturalHeight), w = long ? r.width : i.naturalWidth * k, h = long ? r.height : i.naturalHeight * k;
    const left = Math.max(b.left, r.left + (r.width - w) / 2), right = Math.min(b.right, r.right - (r.width - w) / 2), top = Math.max(b.top, r.top + (r.height - h) / 2), bottom = Math.min(b.bottom, r.bottom - (r.height - h) / 2);
    const x = (left + right) / 2, y = (top + bottom) / 2;
    return { x, y, left, right, top, bottom, hit: document.elementFromPoint(x, y) === i };
  });
  journal.push({ ink }); write(out, 'desktop-zoom-input', journal);
  assert(ink.hit && ink.right > ink.left && ink.bottom > ink.top, 'trusted click must hit actual media ink');
  // Production owns a pointerup double-tap recognizer, not a dblclick listener.
  // Never dispatch DOM PointerEvents or bypass stage capture to manufacture a pass.
  await p.mouse.move(ink.x, ink.y);
  await p.mouse.click(ink.x, ink.y, { delay: 20 }); await snapshot('first trusted click');
  assert((await state()).open, 'ordinary media-ink click must not dismiss viewer; inspect captured pointer/click targets');
  assert(await p.evaluate(() => __viewerInput.some(e => e.type === 'click' && e.trusted && e.target === 'mv-stage')), 'native captured click actually retargets to stage');
  await p.waitForTimeout(100);
  await p.mouse.click(ink.x, ink.y, { delay: 20 }); await settle(p); await snapshot('second trusted click');
  assert((await state()).open && (await state()).scale > 2, 'trusted double click zooms without dismissal');
  await p.mouse.move(ink.x, ink.y); await p.mouse.down(); await p.mouse.move(ink.x + 45, ink.y - 80, { steps: 10 }); await p.mouse.up();
  await settle(p); await snapshot('zoomed mouse pan');
  assert((await state()).open && Math.abs((await state()).x) > 1 && Math.abs((await state()).y) > 1, 'mouse pan survives stable-stage capture');
  await p.waitForTimeout(400);
  await p.mouse.click(ink.x, ink.y, { delay: 20 }); await p.waitForTimeout(100); await p.mouse.click(ink.x, ink.y, { delay: 20 });
  await settle(p); await snapshot('reset'); assert((await state()).open); assert.equal((await state()).scale, 1);
  if (fits) await fits('reset');
  await p.waitForTimeout(400);
  // A handled drag finishes in the original letterbox after paint recentres it.
  // The immediately following genuine outside press must NOT inherit suppression.
  const start = { x: ink.left + 12, y: ink.y }, end = { x: ink.left - 24, y: ink.y };
  await p.mouse.move(start.x, start.y); await p.mouse.down(); await p.mouse.move(end.x, end.y, { steps: 10 }); await p.mouse.up(); await settle(p);
  await snapshot('drag ends over letterbox'); assert((await state()).open, 'drag click over letterbox does not dismiss');
  await p.mouse.click(end.x, end.y); await snapshot('fresh letterbox click'); assert(!(await state()).open, 'fresh outside click closes, no stale suppression');
}
async function phoneGestures({ p, ctx, out, drag, open, state, capture, settle }) {
  await p.evaluate(() => {
    window.__viewerTouchInput = []; window.__viewerTouchActive = new Set();
    for (const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','click']) document.addEventListener(type, e => {
      if (type === 'pointerdown') __viewerTouchActive.add(e.pointerId);
      if (type === 'pointerup' || type === 'pointercancel') __viewerTouchActive.delete(e.pointerId);
      __viewerTouchInput.push({ type, trusted: e.isTrusted, id: e.pointerId, pointerType: e.pointerType, target: e.target.className || e.target.tagName, inViewer: !!e.target.closest?.('.mviewer'), x: e.clientX, y: e.clientY, t: e.timeStamp, active: __viewerTouchActive.size, state: WosChat.viewer.state });
    }, true);
  });
  const ledger = [], record = async label => { const s = await state(), input = await p.evaluate(() => ({ active: __viewerTouchActive.size, events: __viewerTouchInput })); ledger.push({ label, state: s, input }); write(out, 'phone-gesture-input', ledger); assert(s.open && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.scale), 'gesture remains open and finite: ' + label); return s; };
  await open(2);
  const cdp = await ctx.newCDPSession(p), b = await p.locator('.mv-stage').boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  try {
    await p.touchscreen.tap(x, y); await record('ordinary ink tap');
    const left = { id: 1, x: x - 40, y }, right = { id: 2, x: x + 40, y };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, right] });
    for (let n = 1; n <= 10; n++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...left, x: x - 40 - n * 6 }, { ...right, x: x + 40 + n * 6 }] }); await p.waitForTimeout(20); }
    assert((await record('pinch expanded')).scale > 1.8);
    const remaining = { id: 1, x: x - 100, y }, released = { id: 2, x: x + 100, y };
    // Chromium 156 has two implementations. Default CreateWebTouchEvents accepts
    // touchEnd with the RELEASED ID (not the survivor); omitted MOVE IDs persist.
    // SyntheticPointerActions instead rejects nonempty End and diffs MOVE IDs.
    // See docs/evidence/media-viewer-cdp-input.md. Never fake a DOM pointerup.
    let releasePath = 'CreateWebTouchEvents: touchEnd released ID';
    try { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [released] }); }
    catch (e) {
      if (!String(e.message).includes('TouchEnd and TouchCancel must not have any touch points.')) throw e;
      releasePath = 'SyntheticPointerActions: touchMove surviving ID';
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [remaining] });
    }
    // Command ACK and renderer pointer delivery are separate observations.
    try { await p.waitForFunction(() => __viewerTouchActive.size === 1 && __viewerTouchInput.some(e => e.type === 'pointerup' && e.trusted && e.active === 1), null, { timeout: 3000 }); }
    finally { await record('partial lift via ' + releasePath); }
    const beforePan = await state();
    for (let n = 1; n <= 10; n++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...remaining, x: remaining.x + n * 4.5, y: y - n * 8 }] }); await p.waitForTimeout(20); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForFunction(() => __viewerTouchActive.size === 0, null, { timeout: 3000 });
    const pan = await record('remaining finger pan and lift'); assert(Math.abs(pan.x - beforePan.x) > 1 || Math.abs(pan.y - beforePan.y) > 1, 'partial-lift continuation really pans');
    await p.waitForTimeout(400); await p.touchscreen.tap(x, y); await p.waitForTimeout(100); await p.touchscreen.tap(x, y); await settle(p);
    assert.equal((await record('trusted double tap reset')).scale, 1);
    await open(2); await drag(cdp, [{ x: x + 110, y }], [{ x: x - 110, y }]);
    assert.equal((await record('gallery swipe')).i, 3);
    await p.touchscreen.tap(x, y); const next = await record('fresh tap on next image'); assert.equal(next.i, 3); assert.equal(next.scale, 1, 'tap history never crosses gallery item');
    await capture('phone-gallery');
    // Native cancellation is not a swipe; a later tap belongs to a new sequence.
    await open(2); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 4, x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 4, x: x - 100, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); assert.equal((await record('cancelled swipe')).i, 2);
    await p.touchscreen.tap(x, y); assert.equal((await record('fresh tap after cancel')).scale, 1);
    await p.waitForTimeout(400);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 5, x, y }] }); await p.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); assert((await record('long press lift')).menu, 'held lift keeps menu open');
    const menuOutside = await p.locator('.mv-menu').evaluate(e => { const r = e.getBoundingClientRect(), x = r.left + 4, y = r.top + 4; return { x, y, hit: document.elementFromPoint(x, y) === e }; });
    assert(menuOutside.hit, 'fresh menu outside point hits the real menu scrim');
    await p.touchscreen.tap(menuOutside.x, menuOutside.y); assert(!(await record('fresh menu outside tap')).menu, 'outside closes menu only');
    await open(0); await drag(cdp, [{ x, y: b.y + b.height * .25 }], [{ x, y: b.y + b.height * .65 }]);
    assert(!(await state()).open, 'downward swipe still dismisses');
    await open(2);
    const outside = await p.locator('.mv-stage img').evaluate(i => {
      const r = i.getBoundingClientRect(), s = i.parentElement.getBoundingClientRect(), k = Math.min(r.width / i.naturalWidth, r.height / i.naturalHeight), inkTop = r.top + (r.height - i.naturalHeight * k) / 2;
      const x = s.left + s.width / 2, y = s.top + (inkTop - s.top) / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, gap: inkTop - s.top, hit: !!hit?.closest('.mv-stage'), actualHit: { tag: hit?.tagName, className: hit?.className }, image: r.toJSON(), stage: s.toJSON(), inkTop };
    });
    const finalTap = { label: 'fresh final letterbox tap after reopen', outside, before: await state(), start: await p.evaluate(() => __viewerTouchInput.length) };
    try {
      assert(outside.gap > 8 && outside.hit, 'outside tap is in a measured real letterbox, never image ink');
      await p.touchscreen.tap(outside.x, outside.y);
      // Input ACK is not renderer delivery. Match this fresh trusted down/up
      // at the measured outside point, then require visible dismissal. A
      // compatibility click is diagnostic only: R5 delivered no such click.
      await p.waitForFunction(({ start, x, y }) => {
        const events = __viewerTouchInput.slice(start);
        const downIndex = events.findIndex(e => e.type === 'pointerdown' && e.trusted && e.pointerType === 'touch' && e.inViewer && Math.abs(e.x - x) < 2 && Math.abs(e.y - y) < 2);
        if (downIndex < 0) return false;
        const down = events[downIndex];
        const upIndex = events.findIndex((e, i) => i > downIndex && e.type === 'pointerup' && e.trusted && e.pointerType === 'touch' && e.id === down.id && e.inViewer && e.active === 0 && Math.abs(e.x - x) < 2 && Math.abs(e.y - y) < 2);
        const viewer = document.querySelector('.mviewer');
        return upIndex >= 0 && !events.slice(downIndex, upIndex).some(e => e.type === 'pointercancel') && !WosChat.viewer.state.open && !!viewer?.hidden;
      }, { start: finalTap.start, x: outside.x, y: outside.y }, { timeout: 3000 });
      finalTap.trustedPointerReleaseDelivered = true;
      finalTap.visibleDismissal = await p.locator('.mviewer').isHidden();
      assert(finalTap.visibleDismissal && !(await state()).open, 'new outside press after reopen dismisses after actual trusted pointer release');
    } catch (e) { finalTap.error = String(e.stack || e); throw e; }
    finally {
      finalTap.after = await p.evaluate(({ x, y }) => { const hit = document.elementFromPoint(x, y); return { state: WosChat.viewer.state, actualHit: { tag: hit?.tagName, className: hit?.className }, active: __viewerTouchActive.size, events: [...__viewerTouchInput] }; }, outside);
      const fresh = finalTap.after.events.slice(finalTap.start), down = fresh.find(e => e.type === 'pointerdown' && e.trusted);
      finalTap.trustedClickDelivered = !!down && fresh.some(e => e.type === 'click' && e.trusted && e.id === down.id && e.pointerType === 'touch');
      ledger.push(finalTap); write(out, 'phone-gesture-input', ledger); write(out, 'phone-final-outside-input', finalTap);
    }
    await open(2); // leave the next original Back/menu case an open viewer
  } finally { await cdp.detach(); }
}
async function opacity({ p, out, name, settle }) {
  await settle(p);
  assert.equal(await p.evaluate(() => WosChat.viewer.state.scale), 1, 'opacity oracle owns unzoomed chrome only');
  for (const selector of ['.mv-top', '.mv-bar', '.mv-menu-b']) {
    const panel = p.locator(selector); if (!await panel.isVisible()) continue;
    const stem = name.replace(/\W/g, '-') + selector.replace(/\W/g, '-'), ledger = { selector, name, captures: [] };
    let restored;
    const shot = async tag => {
      await settle(p);
      const b = await panel.screenshot(), decoded = decodePNG(b); fs.writeFileSync(path.join(out, stem + '-' + tag + '.png'), b);
      ledger.captures.push({ tag, sha256: hash(b), width: decoded.width, height: decoded.height }); write(out, stem, ledger); return decoded;
    };
    try {
      ledger.meta = await panel.evaluate(e => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e), exclusions = [];
        const add = b => exclusions.push({ left: b.left - r.left, right: b.right - r.left, top: b.top - r.top, bottom: b.bottom - r.top });
        e.querySelectorAll('button,input,img,svg').forEach(n => add(n.getBoundingClientRect()));
        const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.trim()) { const range = document.createRange(); range.selectNodeContents(n); for (const b of range.getClientRects()) add(b); }
        return { width: Math.floor(r.width), height: Math.floor(r.height), rect: r.toJSON(), background: s.backgroundColor, opacity: s.opacity, radii: ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].map(k => parseFloat(s[k]) || 0), borders: ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].map(k => parseFloat(s[k]) || 0), padding: ['paddingTop','paddingRight','paddingBottom','paddingLeft'].map(k => parseFloat(s[k]) || 0), exclusions, oldStyle: e.getAttribute('style') };
      });
      ledger.paint = await panel.evaluate(panelPaint);
      assert(ledger.paint.rgba[3] === 255 && ledger.paint.effectiveOpacity === 1, 'opaque parsed panel and ancestor opacity');
      ledger.roi = interiorROI(ledger.meta);
      // No production style change. Only sibling stacking/fixture geometry is normalized.
      await panel.evaluate(e => { e.style.position = 'relative'; e.style.zIndex = '2'; });
      const a = await shot('bare-a'), b = await shot('bare-b');
      ledger.bareControl = compare(a, b, ledger.roi); assert.equal(ledger.bareControl.changed, 0, 'unchanged interior control');
      ledger.probe = await panel.evaluate(e => {
        const parent = e.parentElement, r = e.getBoundingClientRect(), b = parent.getBoundingClientRect(), x = document.createElement('div'); x.id = 'loud-underlay';
        x.style.cssText = `position:absolute;left:${r.left-b.left}px;top:${r.top-b.top}px;width:${r.width}px;height:${r.height}px;z-index:1;pointer-events:none;background:repeating-linear-gradient(90deg,#ff0000 0 5px,#00ff00 5px 10px);font:40px sans-serif;color:#000`;
        x.textContent = 'LOUD SYNTHETIC TEXT '.repeat(200); parent.insertBefore(x, e);
        x.style.pointerEvents = 'auto'; const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2); x.style.pointerEvents = 'none';
        return { parent: parent.className, panelIndex: stack.indexOf(e), probeIndex: stack.indexOf(x), rect: x.getBoundingClientRect().toJSON(), panelRect: r.toJSON(), immediatelyBefore: x.nextElementSibling === e, zIndex: getComputedStyle(x).zIndex };
      });
      assert(ledger.probe.immediatelyBefore && ledger.probe.zIndex === '1' && ledger.probe.panelIndex >= 0 && ledger.probe.probeIndex > ledger.probe.panelIndex, 'probe is below exact panel in same stack');
      const loud = await shot('loud'); ledger.fullBox = compare(a, loud); ledger.interior = compare(a, loud, ledger.roi);
      assert.equal(ledger.interior.changed, 0, 'zero interior change over loud text');
      // Same exact interior, same sibling. A genuinely transparent text panel MUST fail.
      await panel.evaluate(e => e.style.background = 'transparent');
      const transparent = await shot('transparent-negative'); ledger.negative = compare(a, transparent, ledger.roi);
      assert(ledger.negative.changed > 0, 'same-ROI real transparency negative must be detectable');
      await panel.evaluate((e, background) => e.style.background = background, ledger.meta.background);
      await p.locator('#loud-underlay').evaluate(e => e.remove()); restored = await shot('restored'); ledger.restored = compare(a, restored, ledger.roi);
      assert.equal(ledger.restored.changed, 0, 'restored interior control');
      ledger.pass = true;
    } finally {
      await p.locator('#loud-underlay').evaluateAll(es => es.forEach(e => e.remove()));
      if (ledger.meta) await panel.evaluate((e, old) => old === null ? e.removeAttribute('style') : e.setAttribute('style', old), ledger.meta.oldStyle);
      write(out, stem, ledger);
    }
  }
}
async function phoneBottom({ p, ctx, out, drag, open, state, capture }) {
  // James, 6 Nov 2026: footer is visible immediately; reading requires explicit zoom.
  await open(3);
  const g = await p.evaluate(() => { const i = document.querySelector('.mv-stage img'), s = i.parentElement; return { state: WosChat.viewer.state, image: i.getBoundingClientRect().toJSON(), stage: s.getBoundingClientRect().toJSON() }; });
  write(out, 'phone-footer-measurements', { ...g, measured: containedMetrics(g) });
  await capture('phone-long-contained');
  const b = g.stage, x = b.x + b.width / 2, y = b.y + b.height / 2;
  await p.touchscreen.tap(x,y); await p.waitForTimeout(120); await p.touchscreen.tap(x,y); await p.waitForTimeout(300);
  assert((await state()).scale > 1.02, 'explicit zoom makes long screenshot readable');
  const cdp = await ctx.newCDPSession(p);
  try {
    await drag(cdp,[{x,y:y+80}],[{x,y:y-80}]);
    const moved = await state(); assert(moved.open && moved.y < 0, 'zoomed image still pans');
  } finally { await cdp.detach(); }
}
module.exports = { zoom, opacity, phoneBottom, panelPaint, paintCalibration, phoneGestures };
