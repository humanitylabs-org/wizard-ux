/* Browser proof for AI Look up (core/lookup-pop.js + the Look up item of core/sel-menu.js), real Chromium, real files.
 *   node tests/lookup-pop.browser.cjs        (needs Playwright; run it on forum, QA_PLAYWRIGHT=<path> if not installed locally)
 * Fixture thread + a scripted local backend speaking the Wisdom NDJSON contract; no owner data, no real model, no network.
 * Covers: menu offers Look up (Copy · Share · Quote · Look up · Select all); the tap paints the popover with its loading
 * state in the same task (backend held 5 s); context is the message only (≤800 chars each side); streaming then validated
 * final; abort on close / newer selection / newer lookup; Back and outside tap close it one layer; retry after an error;
 * text inside is selectable + copyable; opaque panel; private threads get no Look up; works on James's own messages. */
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const SHOTS = process.env.QA_SHOTS || '';
const LONG = 'The demiurge appears in Plato\'s Timaeus as a craftsman who shapes the world from a model. ' + 'Filler sentence about nothing in particular. '.repeat(40);
const OTHER = 'SECOND-MESSAGE-MUST-NOT-LEAK about Gnostic emanations, and also Plato\'s Timaeus.';
const ANSWER = 'Plato\'s Timaeus is a late dialogue in which a divine craftsman, the demiurge, shapes the ordered cosmos from pre-existing chaos.';
const MODEL = 'claude-haiku-4-5';
const PAGE = `<!doctype html><html data-skin="${process.env.QA_SKIN || 'nebula'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/kit/wizard-tokens.css"><link rel="stylesheet" href="/core/skins.css"><link rel="stylesheet" href="/core/chats.css"><link rel="stylesheet" href="/core/sel-menu.css"><link rel="stylesheet" href="/core/lookup-pop.css">
<style>html,body{margin:0;background:var(--wz-base);color:var(--wz-text);font:16px system-ui;user-select:none;-webkit-user-select:none}.msg{padding:12px}</style>
<script>window.__copied=[];window.__toasts=[];window.__private=false;
window.WosChat={copyText:async t=>{window.__copied.push(t);return true},shareText:async()=>'shared',shareAssistantText:async()=>'shared'};
window.__wos={toast:(i,t)=>window.__toasts.push(t),chats:{insertText:()=>true,lookupScope:id=>({session:'sess_1',agent:window.__private?'priv':'',private:window.__private,frame:'Philosopher · Mythological terms'})}};</script>
<script src="/core/sel-menu.js"></script><script src="/core/lookup-pop.js"></script></head><body>
<section data-chats="w1"><div class="ch-thread" data-chats="w1">
<div class="msg a"><div class="bub" id="m1"><p>${LONG}</p></div></div>
<div class="msg u"><div class="bub" id="m2"><p>${OTHER}</p></div></div></div></section></body></html>`;

let mode = 'good', calls = [], closed = 0;
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(PAGE); }
  if (p === '/wizard/v1/lookup/stream' && req.method === 'POST') {
    let raw = ''; req.on('data', b => { raw += b; });
    req.on('end', () => {
      calls.push(JSON.parse(raw)); res.on('close', () => { if (!res.writableFinished) closed++; });
      const m = typeof mode === 'function' ? mode(calls.length) : mode;
      if (m === 'error') { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"lookup_unavailable"}'); }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const done = () => { res.write(JSON.stringify({ type: 'done', text: ANSWER, model: MODEL }) + '\n'); res.end(); };
      if (m === 'slow5') return setTimeout(done, 5000);
      if (m === 'hold') { res.write(JSON.stringify({ type: 'delta', text: 'Starting ' }) + '\n'); return; }
      if (m === 'stream') { res.write(JSON.stringify({ type: 'delta', text: 'Plato\'s Timaeus is a late dialogue ' }) + '\n'); return setTimeout(() => { res.write(JSON.stringify({ type: 'delta', text: 'in which a divine craftsman' }) + '\n'); setTimeout(done, 700); }, 500); }
      return done();
    });
    return;
  }
  const file = path.join(root, 'web', p);
  if (file.startsWith(path.join(root, 'web') + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/css'); return res.end(fs.readFileSync(file)); }
  res.statusCode = 404; res.end();
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const W = +process.env.QA_W || 412, H = +process.env.QA_H || 892;
    const page = await browser.newPage({ viewport: { width: W, height: H }, isMobile: W < 700, hasTouch: W < 700 });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.WosLookup && window.WosSelMenu);
    const select = async (id, phrase) => page.evaluate(([id, phrase]) => {
      document.getElementById(id).scrollIntoView({ block: 'start' }); const n = document.getElementById(id).querySelector('p').firstChild, at = n.nodeValue.indexOf(phrase), r = document.createRange();
      r.setStart(n, at); r.setEnd(n, at + phrase.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString();
    }, [id, phrase]);
    const menu = async () => { await page.locator('.selmenu:not([hidden]).on [data-sm]').first().waitFor({ timeout: 4000 }); return page.evaluate(() => WosSelMenu.state.items); };
    const pop = () => page.evaluate(() => { const e = document.querySelector('.wos-lookup'); return e && !e.hidden ? { text: e.querySelector('.lk-body')?.textContent.trim(), term: e.querySelector('.lk-term')?.textContent, label: e.querySelector('small')?.textContent, state: e.dataset.state } : null; });
    const waitState = (s, ms = 8000) => page.waitForFunction(s => document.querySelector('.wos-lookup')?.dataset.state === s, s, { timeout: ms });
    const look = () => page.evaluate(() => { if (!window.__fw) { const f = window.fetch; window.__fw = []; window.fetch = (...a) => { const e = document.querySelector('.wos-lookup'); window.__fw.push(!!e && !e.hidden && /Explaining/.test(e.textContent)); return f(...a); }; } const b = document.querySelector('.selmenu [data-sm="lookup"]'); b.click(); const e = document.querySelector('.wos-lookup'); return { visible: !!e && !e.hidden, text: e?.querySelector('.lk-body')?.textContent.trim(), label: e?.querySelector('small')?.textContent, sel: getSelection().toString(), menuHidden: document.querySelector('.selmenu').hidden, rect: e && e.getBoundingClientRect().toJSON() }; });
    const cleanup = async () => { await page.evaluate(() => { WosLookup.close(); WosLookup.clearCache(); getSelection().removeAllRanges(); }); await sleep(250); };
    const tap = async (x, y) => { if (W < 700) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };

    // 1. The menu: Copy · Share · Quote · Look up · Select all
    await select('m1', "Plato's Timaeus");
    assert.deepEqual(await menu(), ['copy', 'share', 'quote', 'lookup', 'all'], 'menu order');

    // 2. Same task as the tap, loading state, backend held for 5 s; selection stays alive under it
    mode = 'slow5'; calls = []; closed = 0;
    const t0 = Date.now(); const first = await look();
    assert.ok(first.visible && first.text === 'Explaining…' && first.label === 'AI explanation', 'popover painted in the tap task: ' + JSON.stringify(first));
    assert.equal(first.sel, "Plato's Timaeus", 'selection stays alive'); assert.ok(first.menuHidden, 'menu steps aside');
    assert.deepEqual(await page.evaluate(() => window.__fw), [true], 'loading state was already on screen when the request was issued');
    if (SHOTS) { await sleep(300); await page.screenshot({ path: path.join(SHOTS, `lookup-loading-${W}.png`) }); }
    await waitState('done', 9000);
    const dt = Date.now() - t0; assert.ok(dt >= 4500, 'the delayed backend really delayed: ' + dt);
    const done = await pop(); assert.equal(done.text, ANSWER); assert.equal(done.term, "Plato's Timaeus");
    assert.ok(!/…$/.test(done.text), 'final text has no trailing ellipsis');
    // 3. Request: term + message-only context, ≤800 each side, frame, never the other message
    const body = calls[0];
    assert.equal(body.text, "Plato's Timaeus"); assert.ok(body.before.endsWith('The demiurge appears in ') && body.before.length <= 800 && body.after.length <= 800);
    assert.ok(body.after.startsWith(' as a craftsman'), 'after: ' + body.after.slice(0, 30));
    assert.equal(body.frame, 'Philosopher · Mythological terms'); assert.equal(body.session, 'sess_1');
    assert.ok(!JSON.stringify(body).includes('SECOND-MESSAGE'), 'context is the message only');
    assert.deepEqual(Object.keys(body).sort(), ['after', 'before', 'frame', 'session', 'text']);
    // 4. Text inside is selectable; opaque panel; skin tokens
    const style = await page.evaluate(() => { const e = document.querySelector('.wos-lookup'), c = getComputedStyle(e); return { us: getComputedStyle(e.querySelector('.lk-body')).userSelect, bg: c.backgroundColor, z: c.zIndex, pos: c.position }; });
    assert.equal(style.us, 'text'); assert.ok(/^(rgb|color)\(/.test(style.bg) && !/\/|rgba|, 0\)/.test(style.bg), 'fully opaque panel (no alpha): ' + style.bg); assert.equal(style.pos, 'fixed');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `lookup-done-${W}.png`) });
    // 5. Copy out of the popover: select its words, the menu offers Copy, the popover stays
    await page.evaluate(() => { const n = document.querySelector('.wos-lookup .lk-body').firstChild, r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 22); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    const inner = await menu(); assert.ok(inner.includes('copy') && !inner.includes('lookup') && !inner.includes('quote'), 'popover selection menu: ' + inner);
    await page.evaluate(() => document.querySelector('.selmenu [data-sm="copy"]').click()); await sleep(200);
    assert.deepEqual(await page.evaluate(() => window.__copied), [ANSWER.slice(0, 22)], 'copied the popover words'); assert.ok(await pop(), 'popover stays open after copying');
    // a repeat of the same words in the same message is answered from memory (no second request, instant)
    await page.evaluate(() => { WosLookup.close(); getSelection().removeAllRanges(); });
    await select('m1', "Plato's Timaeus"); await menu(); const rep = await look(); assert.equal(rep.text, ANSWER); assert.equal(calls.length, 1, 'repeat served from the in-page cache');
    await cleanup();

    // 6. Streaming: provisional deltas trail "…", then the validated final replaces them
    mode = 'stream'; calls = [];
    await select('m1', "Plato's Timaeus"); await menu(); await look();
    await page.waitForFunction(() => /late dialogue/.test(document.querySelector('.wos-lookup .lk-body')?.textContent || '') && document.querySelector('.wos-lookup').dataset.state === 'streaming', null, { timeout: 4000 });
    assert.match((await pop()).text, / …$/, 'provisional text ends with ellipsis');
    await waitState('done'); assert.equal((await pop()).text, ANSWER); await cleanup();

    // 7. Abort: outside tap closes it and the request is cancelled; the tap also ends the selection
    mode = 'hold'; calls = []; closed = 0;
    await select('m1', "Plato's Timaeus"); await menu(); await look(); await page.waitForFunction(() => /Starting/.test(document.querySelector('.wos-lookup .lk-body')?.textContent || ''), null, { timeout: 4000 });
    await tap(W / 2, H - 8); await sleep(500);
    assert.equal(await pop(), null, 'outside tap closes'); assert.ok(closed >= 1, 'request aborted by close'); assert.equal(await page.evaluate(() => getSelection().toString()), '', 'outside tap ends the selection');
    // 8. Newer selection closes it and aborts; a newer lookup supersedes an older one
    closed = 0; calls = [];
    await select('m1', "Plato's Timaeus"); await menu(); await look(); await sleep(300);
    await select('m1', 'craftsman'); await sleep(500);
    assert.equal(await pop(), null, 'newer selection closes'); assert.ok(closed >= 1, 'newer selection aborts the fetch');
    // the very same words picked in ANOTHER message are a newer selection, not the old one
    closed = 0; mode = 'hold';
    await select('m1', "Plato's Timaeus"); await menu(); await look(); await sleep(200);
    await select('m2', "Plato's Timaeus"); await sleep(500);
    assert.equal(await pop(), null, 'same text elsewhere closes it'); assert.ok(closed >= 1, 'and aborts the fetch'); await cleanup();
    mode = (n) => n === 1 ? 'hold' : 'good'; closed = 0; calls = [];
    await select('m1', "Plato's Timaeus"); await menu(); await look(); await sleep(200);
    await page.evaluate(() => { const s = getSelection(); WosLookup.open({ text: 'craftsman', before: 'a ', after: ' who', range: s.getRangeAt(0) }); });
    await waitState('done'); await sleep(200); assert.equal((await pop()).term, 'craftsman'); assert.ok(closed >= 1, 'older lookup aborted'); assert.equal((await pop()).text, ANSWER);
    await cleanup();

    // 9. Back closes it one layer: selection stays and its menu returns; a second Back does nothing here
    mode = 'hold'; await select('m1', "Plato's Timaeus"); await menu(); await look(); await sleep(200);
    assert.equal(await page.evaluate(() => WosLookup.back()), 'lookup'); assert.equal(await pop(), null);
    assert.equal(await page.evaluate(() => getSelection().toString()), "Plato's Timaeus", 'selection survives Back');
    assert.ok((await menu()).includes('lookup'), 'selection menu returns after Back'); assert.equal(await page.evaluate(() => WosLookup.back()), '', 'nothing left for Back to close');
    await cleanup();

    // 10. Error: compact retry, then it works
    mode = (n) => n === 1 ? 'error' : 'good'; calls = [];
    await select('m1', "Plato's Timaeus"); await menu(); await look(); await waitState('error');
    const err = await pop(); assert.match(err.text, /AI explanation unavailable\.\s*Retry/); assert.ok(!/claude|token|503/i.test(err.text));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `lookup-error-${W}.png`) });
    await page.evaluate(() => document.querySelector('[data-lk-retry]').click()); await waitState('done'); assert.equal((await pop()).text, ANSWER); assert.equal(calls.length, 2);
    await cleanup();

    // 11. Long selections are explained locally, no request; James's own messages work too
    mode = 'good'; calls = [];
    await select('m1', 'The demiurge appears in Plato\'s Timaeus as a craftsman'); await menu(); await look();
    assert.equal((await pop()).text, 'Select a word or short phrase to explain.'); assert.equal(await page.locator('[data-lk-retry]').count(), 0, 'no retry for a local notice'); assert.equal(calls.length, 0); await cleanup();
    await select('m2', 'Gnostic emanations'); await menu(); await look(); await waitState('done'); assert.equal(calls[0].text, 'Gnostic emanations'); assert.ok(calls[0].before.includes('SECOND-MESSAGE-MUST-NOT-LEAK')); await cleanup();

    // 12a. A chat selection whose thread scope cannot be resolved fails closed
    await page.evaluate(() => { window.__lkScope = window.__wos.chats.lookupScope; window.__wos.chats.lookupScope = () => null; });
    await select('m1', "Plato's Timaeus"); const lost = await menu(); assert.ok(!lost.includes('lookup'), 'unresolved scope never offers Look up: ' + lost);
    await page.evaluate(() => { window.__wos.chats.lookupScope = window.__lkScope; getSelection().removeAllRanges(); });
    await sleep(300);
    // 12. Private thread: no Look up at all
    await page.evaluate(() => { window.__private = true; });
    await select('m1', "Plato's Timaeus"); const priv = await menu(); assert.ok(!priv.includes('lookup'), 'private threads never offer Look up: ' + priv);
    await page.evaluate(() => { window.__private = false; getSelection().removeAllRanges(); });
    assert.deepEqual(errs, []);
    console.log(`pass (${W}x${H}): menu, same-task paint with 5 s backend, context bounds, stream→final, abort (close/newer selection/newer lookup), Back, outside tap, retry, copy, opaque, private`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
