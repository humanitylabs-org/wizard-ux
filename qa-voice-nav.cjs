// QA: navigate freely while the orb records (James, 9 Oct).
// No Listening card (one-time first-use tip only); arc = Cancel, Pause, Attach; Android Back while
// recording navigates (only Cancel discards); desk swipes work while recording and from anywhere on
// the bottom bar; the desk label names the app, not the thread; an attached file rides with the take.
// Usage: QA_WEB_DIR=<repo> node qa-voice-nav.cjs [url]. Every Hermes/Wizard write is intercepted.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/telos/node_modules/playwright');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const W = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
const SEND_MS = 1500;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

const THREADS = Array.from({ length: 40 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview line for scrolling', last_active: Date.now() / 1000 - i * 600, started_at: Date.now() / 1000 - i * 600 - 60 }));

async function boot(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = []; const runs = [];
  let slowSend = null;
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (!/wizard\.tailc0f369\.ts\.net$/.test(u.hostname)) return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && q.method() === 'GET' && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html', p = require('path').join(W, 'web', f);
      if (!require('fs').existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: require('fs').readFileSync(p) });
    }
    if (q.method() !== 'GET') writes.push(u.pathname);
    // The current send contract requires an authoritative fixture route, just like the real model/options API.
    if (/\/hermes\/api\/model\/options$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'openai-codex', model: 'gpt-6.1-sol', providers: [{ slug: 'openai-codex', authenticated: true, is_current: true, models: ['gpt-6.1-sol'] }] }) });
    if (/\/api\/sessions\/[^/]+\/model$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runtime: { ...q.postDataJSON(), model_lock: 'accepted', selection_version: 1 } }) });
    if (/\/files\/upload$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file: { id: 'qa-file-1', filename: 'shot.png', mime: 'image/png', bytes: 68 } }) });
    if (/\/hermes\/v1\/runs$/.test(u.pathname)) { runs.push(q.postDataJSON()); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-run' }) }); }
    if (/\/api\/transcribe$/.test(u.pathname)) { await new Promise(res => { slowSend = res; setTimeout(res, SEND_MS); }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'something for archimedes about the week', ms: 300 }) }).catch(() => {}); }
    if (/\/api\/route$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ms: 5, cmd: { route: 'agent' } }) });
    if (/\/hermes\/api\/sessions$/.test(u.pathname) && q.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: THREADS, has_more: false }) });
    if (/\/wizard\/thread-seen$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: Date.now(), threads: {} } }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { if (/wizard-os-home\//.test(String(e.stack || '')) || !/https?:\/\//.test(String(e.stack || ''))) errs.push(String(e)); });
  await p.addInitScript(fresh => { try { localStorage.setItem('wos.coached', 'true'); if (!fresh) localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} }, !!opts.fresh);
  await p.goto('about:blank');
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  return { ctx, p, errs, writes, runs };
}
async function tapOrb(p, wait = 1500) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); await p.waitForTimeout(wait); }
// Visual state of whatever is on screen: every desk/window layer that is visible must be undimmed.
const look = p => p.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth; };
  const layers = [...document.querySelectorAll('.desk > *, .tiles, .win')].filter(vis);
  const dim = layers.filter(el => !(el.classList.contains('glance') && el.closest('.desk.has-wins'))).map(el => { const cs = getComputedStyle(el); return { c: el.className.toString().slice(0, 30), o: +cs.opacity, f: cs.filter }; }).filter(x => x.o < 0.99 || (x.f && x.f !== 'none'));
  const mid = document.elementFromPoint(innerWidth / 2, innerHeight * 0.42);
  const upper = document.elementFromPoint(innerWidth / 2, innerHeight * 0.25);
  const lean = getComputedStyle(document.querySelector('.lean'));
  return { voice: __wos.voice, layers: layers.length, dim, midInVoice: !!mid?.closest('#voice'), upperInVoice: !!upper?.closest('#voice'), mid: mid?.className?.toString().slice(0, 40), lean: +lean.opacity };
});
// The scrollable thread list in the focused Chats window.
const scroller = p => p.evaluateHandle(() => {
  const els = [...document.querySelectorAll('.win *')].filter(el => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 40; });
  return els.sort((a, b) => b.clientHeight - a.clientHeight)[0] || null;
});

// Real finger drag: touchStart → moves → touchEnd, so the page sees what a thumb does.
async function drag(ctx, p, x, y, dy) {
  const c = await ctx.newCDPSession(p);
  const pt = yy => [{ x: Math.round(x), y: Math.round(yy), id: 1 }];
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(y) });
  for (let k = 1; k <= 12; k++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(y + dy * k / 12) }); await p.waitForTimeout(16); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(500);
}


const voiceCard = p => p.evaluate(() => { const v = document.querySelector('#voice'), t = document.querySelector('#transcript'); const r = t.getBoundingClientRect(); return { shown: v.classList.contains('tx') && +getComputedStyle(t).opacity > .05, brief: t.classList.contains('brief'), tip: t.classList.contains('tip'), h: Math.round(r.height), w: Math.round(r.width), text: document.querySelector('#txRouteText').textContent }; });
const arcs = p => p.evaluate(() => [...document.querySelectorAll('#voice .arc')].filter(a => +getComputedStyle(a).opacity > .5).map(a => a.getAttribute('aria-label')));
async function dockSwipe(ctx, p, x, dx) {
  const y = await p.evaluate(() => { const r = document.querySelector('#dock').getBoundingClientRect(); return r.top + r.height * 0.4; });
  const c = await ctx.newCDPSession(p);
  const pt = xx => [{ x: Math.round(xx), y: Math.round(y), id: 2 }];
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x) });
  for (let k = 1; k <= 10; k++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x + dx * k / 10) }); await p.waitForTimeout(16); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(700);
}
const deskIdx = p => p.evaluate(() => __wos.idx ?? null);

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  /* 1. First ever tap: a one-time tip, then never again. No big Listening card. */
  {
    const { ctx, p, errs } = await boot(b, { fresh: true });
    await p.evaluate(() => __wos.goDesk(1, true)); await p.waitForTimeout(700);
    await tapOrb(p, 500);
    let c = await voiceCard(p);
    ok(c.shown && c.tip && c.brief && /tap the orb again to send/i.test(c.text) && c.h < 50, 'first use: a one-line tip explains tap-to-send', JSON.stringify(c));
    await p.waitForTimeout(3600); c = await voiceCard(p);
    ok(!c.shown, 'first use: the tip goes away by itself', JSON.stringify(c));
    await p.click('#arcCancel'); await p.waitForTimeout(500);
    await tapOrb(p, 600); c = await voiceCard(p);
    ok(!c.shown && (await look(p)).voice === 'listen', 'second recording: no tip, no card at all', JSON.stringify(c));
    ok(errs.length === 0, 'no page errors (first use)', errs.join(' | '));
    await ctx.close();
  }
  /* 2. Recording: no card; arc = Cancel, Pause, Attach (no Auto) */
  const { ctx, p, errs, runs } = await boot(b);
  await p.evaluate(() => __wos.goDesk(1, true)); await p.waitForTimeout(800);
  await tapOrb(p, 900);
  let c = await voiceCard(p);
  ok((await look(p)).voice === 'listen' && !c.shown, 'recording: no Listening / tap-to-send card covering the screen', JSON.stringify(c));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/voice-recording.png` });
  const a = await arcs(p);
  const expectedControls = (await p.$('#arcScreen')) ? 4 : 3;
  ok(a.length === expectedControls && a.some(x => /Cancel/.test(x)) && a.some(x => /Pause/.test(x)) && a.some(x => /Attach/.test(x)), 'recording: buttons are Cancel, Pause, optional Screenshot, Attach', JSON.stringify(a));
  ok(!(await p.$('#arcRoute')), 'the Auto/route button is gone');

  /* 3. Back while recording navigates instead of discarding */
  const sh = await scroller(p);
  await p.evaluate(el => { el.scrollTop = 0; }, sh); await p.waitForTimeout(400);
  const row = await p.evaluate(el => { const rows = [...el.querySelectorAll('[data-chopen]')].filter(r => { const b = r.getBoundingClientRect(); return b.top > el.getBoundingClientRect().top + 10 && b.bottom < innerHeight * 0.55 && b.height > 20; }); const r = rows[0]?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, sh);
  const info = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return { tag: e?.tagName, cls: e?.className?.toString().slice(0, 40), html: e?.outerHTML.slice(0, 160), desk: __wos.idx }; }, row || { x: 0, y: 0 });
  await p.touchscreen.tap(row.x, row.y); await p.waitForTimeout(700);
  ok(await p.evaluate(() => !!document.querySelector('.win [data-chback]')), 'recording: tapped thread opens', JSON.stringify({ row, info }));
  let did = await p.evaluate(() => window.__wosNativeBack());
  await p.waitForTimeout(500);
  ok(did === 'thread' && (await look(p)).voice === 'listen', 'Android Back while recording: thread → list, still recording', did);
  ok(!(await p.evaluate(() => !!document.querySelector('.win [data-chback]'))), 'Back landed on the thread list');
  did = await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(500);
  ok((await look(p)).voice === 'listen' && (await deskIdx(p)) === (await p.evaluate(() => __wos.HOME)), 'second Back goes to the Home desk, still recording', `${did} desk=${await deskIdx(p)}`);

  /* 4. Swipe desks while recording: on the orb, and anywhere on the bar */
  let d0 = await deskIdx(p);
  await dockSwipe(ctx, p, 360, -200);
  let d1 = await deskIdx(p);
  ok(d1 === d0 + 1 && (await look(p)).voice === 'listen', 'recording: swipe on the bar edge (right of the dots) moves a desk', `${d0}→${d1}`);
  await dockSwipe(ctx, p, 40, 220);
  ok((await deskIdx(p)) === d0 && (await look(p)).voice === 'listen', 'recording: swipe on the far-left of the bar moves back', `${await deskIdx(p)}`);
  const orb = await p.locator('#orbWrap').boundingBox();
  await dockSwipe(ctx, p, orb.x + orb.width / 2, -180);
  ok((await deskIdx(p)) === d0 + 1 && (await look(p)).voice === 'listen', 'recording: swipe starting on the orb also moves a desk (no send)', `${await deskIdx(p)}`);
  await dockSwipe(ctx, p, 200, 180);
  ok((await deskIdx(p)) === d0 && (await look(p)).voice === 'listen', 'recording: swipe from the gap between dots and orb works', `${await deskIdx(p)}`);

  /* 5. Bottom label: short app name, never the thread title (Chats desk with a thread open) */
  await p.evaluate(() => __wos.goDesk(2, true)); await p.waitForTimeout(300);
  await p.evaluate(() => { const id = __wos.desks[1].wins.find(x => __wos.wins[x].app === 'chats'); __wos.openChat(id, 'qa-0'); }); await p.waitForTimeout(500);
  await dockSwipe(ctx, p, 360, 200);
  const lab = await p.evaluate(() => document.querySelector('#deskLabel').textContent);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/voice-label.png` });
  ok(/Chats/.test(lab) && !/QA thread/.test(lab), 'desk label names the app (Chats), not the thread', lab);

  /* 6. Attach a file mid-recording; it rides along with the voice message */
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#arcAttach')]);
  ok((await look(p)).voice === 'paused', 'attach: recording pauses while the picker is open');
  await chooser.setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex') });
  await p.waitForTimeout(900);
  ok((await look(p)).voice === 'listen', 'attach: recording resumes after picking');
  const cnt = await p.evaluate(() => document.querySelector('#attachCount').textContent);
  ok(cnt === '1', 'attach: button shows 1 file', cnt);
  await tapOrb(p, 600);
  ok((await look(p)).voice === 'think', 'send: transcribing');
  await p.waitForTimeout(4500);
  const sent = runs.find(r => Array.isArray(r.wizard_file_ids) && r.wizard_file_ids.includes('qa-file-1'));
  ok(!!sent && /archimedes about the week/.test(sent.input), 'the voice message reaches Archimedes with the attached file', JSON.stringify(runs).slice(0, 300));

  /* 7. Explicit Cancel still discards */
  await tapOrb(p, 700); await p.click('#arcCancel'); await p.waitForTimeout(500);
  ok((await look(p)).voice === 'idle', 'Cancel button discards the recording');
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await ctx.close();
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
