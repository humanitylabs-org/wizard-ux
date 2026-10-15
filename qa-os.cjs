// QA for the rebuilt shell: Back never exits, windows tile/move/close, Chats native, view-aware voice.
// Runs against the live origin through the Thales tunnel. Every Hermes/Wizard write is intercepted.
const { chromium } = require('/home/telos/node_modules/playwright');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const OUT = process.env.QA_OUT || '/home/telos/apps/wizard-os-home/qa-live';
const RESOLVE = process.env.QA_RESOLVE || 'MAP wizard.tailc0f369.ts.net 127.0.0.1:18443';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

async function boot(b, { noCloseWatcher = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    { const __m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/); const __W = process.env.QA_WEB_DIR;
      if (__W && __m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(__m[1])) { const __f = __m[1] || 'index.html', __p = require('path').join(__W, 'web', __f); if (require('fs').existsSync(__p)) return r.fulfill({ status: 200, contentType: __f.endsWith('.css') ? 'text/css' : __f.endsWith('.html') ? 'text/html' : 'application/javascript', body: require('fs').readFileSync(__p) }); } }
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen)/.test(u)) {
      writes.push({ m: q.method(), u: u.replace(/^https:\/\/[^/]+/, ''), body: q.postData() || '' });
      if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { id: 'qa-fake-session' } }) });
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return r.continue();
  });
  const p = await ctx.newPage();
  // Only the shell's own errors count; a hosted app (e.g. Topics mid-deploy) is not the shell.
  const errs = [], foreign = [];
  p.on('pageerror', e => { const st = String(e.stack || ''); (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st) ? errs : foreign).push(String(e) + ' @ ' + (st.match(/https?:\/\/[^\s)]+/) || [''])[0]); });
  p.on('close', () => { if (foreign.length) console.log('  (hosted-app errors, not the shell):', foreign.slice(0, 3).join(' | ')); });
  await p.addInitScript(nc => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} if (nc) { try { delete window.CloseWatcher; } catch (e) {} window.CloseWatcher = undefined; } }, noCloseWatcher);
  await p.goto('about:blank');
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  return { ctx, p, writes, errs };
}
const state = p => p.evaluate(() => ({ home: __wos.HOME, idx: __wos.idx, url: location.pathname, sheet: __wos.sheet, desks: __wos.desks.map(d => ({ wins: d.wins.map(id => ({ app: __wos.wins[id].app, thread: __wos.wins[id].thread || null })), full: d.full, focus: d.focus })), back: __wos.back }));
const tap = async (p, sel) => { await p.locator(sel).first().tap(); await p.waitForTimeout(500); };

(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=' + RESOLVE] });

  /* ---------- 1. The repro: open a thread, press Back (CloseWatcher path = Android Back in Chrome 120+) ---------- */
  {
    const { ctx, p, writes, errs } = await boot(b);
    let s = await state(p);
    ok(s.home === 0 && s.desks[0].wins.length === 0, 'Home is the first desk and holds no app');
    ok(s.desks[1].wins.some(w => w.app === 'chats'), 'Chats starts as a window on desk 2 (closable, not pinned)');
    ok(s.back.watchers >= 1, 'Back watcher armed at boot', JSON.stringify(s.back));
    { const g = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); const o = r('#orbWrap'), d = r('#dock');
        const vis = [...document.querySelectorAll('.desk .tiles, .desk .home')].filter(e => { const b = e.getBoundingClientRect(); return b.width && b.left > -5 && b.left < innerWidth - 5; }).map(e => e.getBoundingClientRect().bottom);
        return { orb: Math.round(o.width), dockH: Math.round(d.height), dockTop: Math.round(d.top), contentBottom: Math.round(Math.max(0, ...vis)) }; });
      ok(g.orb <= 48 && g.orb >= 40, 'orb is nav-bar sized (40-48px)', JSON.stringify(g));
      ok(g.dockH <= 72, 'bottom nav bar is slim (≤72px)', JSON.stringify(g));
      ok(g.contentBottom <= g.dockTop + 1, 'content ends above the nav bar (no overlap)', JSON.stringify(g)); }
    await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(900);
    const orbBox = await p.locator('#orbWrap').boundingBox();
    ok(Math.abs(orbBox.x + orbBox.width / 2 - 206) < 3, 'orb stays centred with an app open', JSON.stringify(orbBox));
    ok(await p.locator('.tabbar, .wizard-tabs, nav.tabs').count() === 0, 'Chats has no bottom tabs');
    await tap(p, '.ch-row'); await p.waitForTimeout(1500);
    s = await state(p);
    const thread = s.desks[1].wins[0].thread;
    ok(!!thread, 'tapping a row opens the thread inside the Chats window');
    ok(await p.locator('.msg').count() > 0, 'thread renders real messages');
    await p.screenshot({ path: OUT + '/40-thread-open.png' });
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    s = await state(p);
    ok(s.url.includes('wizard-os-home') && s.desks[1].wins[0].thread === null && s.idx === 1, 'Back from a thread returns to the thread list (app stays open)', JSON.stringify(s));
    await p.keyboard.press('Escape'); await p.waitForTimeout(700);
    s = await state(p);
    ok(s.url.includes('wizard-os-home') && s.idx === s.home, 'next Back goes to the Home desk', JSON.stringify({ idx: s.idx, log: s.back.log }));
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    s = await state(p);
    const warned = await p.locator('#toast').textContent();
    ok(s.url.includes('wizard-os-home') && /again to exit/i.test(warned), 'Back on Home only warns: “Press back again to exit”', warned);
    await p.waitForTimeout(2400);
    s = await state(p);
    ok(s.url.includes('wizard-os-home') && !s.back.exitArmed && s.back.watchers >= 1, 'warning expires after 2 s and Back re-arms', JSON.stringify(s.back));
    // Many Backs in a row (no taps in between) must each be consumed, never leak to the browser.
    await p.evaluate(() => { __wos.goDesk(0); }); await p.waitForTimeout(300);
    await p.locator(`.desk[data-desk="${0}"]`).tap({ position: { x: 200, y: 300 } }).catch(() => {});
    await p.evaluate(() => { __wos.openSheet('launcher'); }); await p.waitForTimeout(300);
    for (let k = 0; k < 2; k++) { await p.keyboard.press('Escape'); await p.waitForTimeout(350); }
    s = await state(p);
    ok(s.url.includes('wizard-os-home') && s.idx === s.home && !s.sheet, 'sheet → Home in two Backs without any tap between', JSON.stringify({ idx: s.idx, log: s.back.log }));
    // Double Back on Home really exits (the only way out).
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    await p.goBack().catch(() => {}); await p.waitForTimeout(600);
    ok(p.url() === 'about:blank', 'second Back within 2 s exits (only way out)', p.url());
    ok(errs.length === 0, 'no page errors (CloseWatcher run)', errs.join(' | '));
    ok(!writes.some(w => /\/v1\/runs|\/api\/sessions$/.test(w.u)), 'no messages sent during Back test');
    await ctx.close();
  }

  /* ---------- 2. Same repro on browsers without CloseWatcher (history guard path) ---------- */
  {
    const { ctx, p, errs } = await boot(b, { noCloseWatcher: true });
    await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(700);
    await tap(p, '.ch-row'); await p.waitForTimeout(1200);
    let s = await state(p);
    ok(s.back.guardOn, 'history guard pushed after a tap', JSON.stringify(s.back));
    await p.goBack(); await p.waitForTimeout(700);
    s = await state(p);
    ok(s.url.includes('wizard-os-home') && s.desks[1].wins[0].thread === null, 'history Back from a thread stays in the app → thread list', JSON.stringify({ url: s.url, log: s.back.log }));
    await tap(p, '.ch-search');
    await p.goBack(); await p.waitForTimeout(700);
    s = await state(p);
    ok(s.url.includes('wizard-os-home') && s.idx === s.home, 'history Back → Home desk', JSON.stringify({ idx: s.idx, log: s.back.log }));
    await p.locator('.home-line').tap().catch(() => {});
    await p.waitForTimeout(300);
    await p.goBack(); await p.waitForTimeout(700);
    ok(p.url().includes('wizard-os-home') && /again to exit/i.test(await p.locator('#toast').textContent()), 'history Back on Home warns and stays', p.url());
    await p.goBack(); await p.waitForTimeout(700);
    ok(p.url() === 'about:blank', 'second history Back exits', p.url());
    ok(errs.length === 0, 'no page errors (history run)', errs.join(' | '));
    await ctx.close();
  }

  /* ---------- 3. Windows: tile, focus, full screen, move, close; Chats is just an app ---------- */
  {
    const { ctx, p, writes, errs } = await boot(b);
    await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
    await p.evaluate(() => __wos.execute({ action: 'open_view', view: 'week' }, 'open week')); await p.waitForTimeout(900);
    let s = await state(p);
    ok(s.idx === 2 && s.desks[2].wins.length === 1 && s.desks[2].wins[0].app === 'review', 'opening an app puts it on its own desk right beside this one', JSON.stringify(s.desks.map(d => d.wins.map(w => w.app))));
    await p.evaluate(() => __wos.mergeDesks(__wos.desks[1].id, __wos.desks[2].id)); await p.waitForTimeout(700);
    s = await state(p);
    ok(s.desks[1].wins.length === 2 && s.desks[1].wins.map(w => w.app).join() === 'chats,review', 'merging two desks tiles the review beside Chats');
    ok(await p.locator(`.desk[data-desk="${1}"]`).locator('.tiles').getAttribute('data-n') === '2', 'two tiles laid out');
    await p.screenshot({ path: OUT + '/41-tiled-2.png' });
    await p.evaluate(() => __wos.execute({ action: 'open_app', app: 'CineQueue' }, 'open cinequeue')); await p.waitForTimeout(1500);
    await p.evaluate(() => { const d = __wos.desks.findIndex(x => x.wins.some(id => __wos.wins[id].appId === 'cinequeue')); if (d > 1) __wos.mergeDesks(__wos.desks[1].id, __wos.desks[d].id); __wos.goDesk(1, true); }); await p.waitForTimeout(900);
    await p.screenshot({ path: OUT + '/42-tiled-3.png' });
    s = await state(p);
    ok(s.desks[1].wins.length === 3, 'third app tiles too (master + stack)');
    // Double-tap a title bar → full screen; Back → tiles again.
    // Let the framed app finish loading first: under headless software rendering a busy
    // main thread delays CDP touch dispatch by ~800 ms, which no real double-tap resembles.
    await p.waitForFunction(() => { try { const f = document.querySelector('.win.app-frame iframe'); return f && f.contentDocument && f.contentDocument.readyState === 'complete'; } catch (e) { return true; } }, null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(3500);
    const cdp = await ctx.newCDPSession(p);
    const bb = await p.locator(`.desk[data-desk="${1}"]`).locator('.win').nth(0).locator('.wbar .wt').boundingBox();
    const tp = async () => { const pt = [{ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, id: 1 }]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    // Headless software rendering can delay CDP touch dispatch past the 450 ms window (a real phone never does).
    // Measure the actual gap between the two clicks and retry when the harness, not the app, was too slow.
    await p.evaluate(() => { window.__barClicks = []; document.addEventListener('click', e => { if (e.target.closest('.wbar')) __barClicks.push(e.timeStamp); }, true); });
    for (let attempt = 0; attempt < 4; attempt++) {
      await p.evaluate(() => { __barClicks.length = 0; });
      await tp(); await p.waitForTimeout(140); await tp(); await p.waitForTimeout(600);
      if (await p.evaluate(() => __wos.desks[1].full)) break;
      const gap = await p.evaluate(() => __barClicks.length === 2 ? __barClicks[1] - __barClicks[0] : -1);
      if (gap >= 0 && gap < 450) break; // a genuine miss: the app ignored a real double-tap
      await p.waitForTimeout(400);
    }
    s = await state(p);
    ok(s.desks[1].full === true, 'double-tap title bar → full screen', JSON.stringify(s.desks[1]));
    await p.screenshot({ path: OUT + '/43-full.png' });
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    s = await state(p);
    ok(s.desks[1].full === false && s.idx === 1, 'Back from full screen returns to tiles (same desk)', JSON.stringify({ full: s.desks[1].full, idx: s.idx, log: s.back.log }));
    // Pinch out on a tile → full screen; pinch in → tiles.
    await p.waitForTimeout(800);
    const w0 = await p.locator(`.desk[data-desk="${1}"]`).locator('.win').nth(0).boundingBox();
    // In-page TouchEvents through the real handlers. (Raw CDP touch streams stall in headless
    // Chromium once a framed app is busy; the CDP path is covered in isolated runs.)
    const pinch = async (box, from, to) => {
      await p.evaluate(([bx, from, to]) => {
        const cx = bx.x + bx.width / 2, cy = bx.y + bx.height / 2;
        const tgt = document.elementFromPoint(cx, cy);
        const mk = d => [new Touch({ identifier: 1, target: tgt, clientX: cx - d, clientY: cy }), new Touch({ identifier: 2, target: tgt, clientX: cx + d, clientY: cy })];
        const fire = (type, touches, changed) => tgt.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches, targetTouches: touches, changedTouches: changed || touches }));
        fire('touchstart', mk(from));
        for (let k = 1; k <= 10; k++) fire('touchmove', mk(from + (to - from) * k / 10));
        fire('touchend', [], mk(to));
      }, [box, from, to]);
      await p.waitForTimeout(500);
    };
    await p.evaluate(() => { window.__pev = []; ['touchstart','touchend','touchcancel'].forEach(k => document.addEventListener(k, e => __pev.push(k + ' n=' + e.touches.length + ' ' + (e.target.className?.baseVal ?? e.target.className) + ' full=' + __wos.desks[1].full), true)); });
    await pinch(w0, 30, 120);
    // Headless software rendering can deliver the touch stream seconds late; wait for the gesture to end.
    await p.waitForFunction(() => __pev.some(x => x.startsWith('touchend n=0')), null, { timeout: 25000 }).catch(() => {});
    await p.waitForFunction(() => __wos.desks[1].full === true, null, { timeout: 3000 }).catch(() => {});
    s = await state(p);
    ok(s.desks[1].full === true, 'pinch out on a window → full screen', JSON.stringify({ d: s.desks[1], ev: await p.evaluate(() => __pev), w0 }));
    const wf = await p.locator(`.desk[data-desk="${1}"]`).locator('.win.full').boundingBox({ timeout: 5000 }).catch(() => w0);
    await p.evaluate(() => { __pev.length = 0; });
    await pinch(wf, 130, 40);
    await p.waitForFunction(() => __pev.some(x => x.startsWith('touchend n=0')), null, { timeout: 25000 }).catch(() => {});
    await p.waitForFunction(() => __wos.desks[1].full === false, null, { timeout: 3000 }).catch(() => {});
    s = await state(p);
    ok(s.desks[1].full === false, 'pinch in → back to tiles');
    // Window overflow retired: expand and close stay in the bar; arrangement is covered by overview QA.
    const chatWin = p.locator(`.desk[data-desk="${1}"]`).locator('.win.app-chats');
    ok(await chatWin.locator('[data-wact="menu"]').count() === 0, 'window bar has no three-dot menu');
    await p.evaluate(() => { const w = Object.values(__wos.wins).find(w => w.app === 'chats'); __wos.moveWin(w.id, 2); }); await p.waitForTimeout(700);
    s = await state(p);
    ok(s.desks[2].wins.some(w => w.app === 'chats') || s.desks.findIndex(d => d.wins.some(w => w.app === 'chats')) === 2, 'shell can move Chats one desk right', JSON.stringify(s.desks.map(d => d.wins.map(w => w.app))));
    ok(s.idx === 2, 'view follows the moved window');
    await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(700);
    const fr = p.locator(`.desk[data-desk="${1}"]`).locator('.win.app-frame');
    await fr.locator('[data-wact="close"]').tap(); await p.waitForTimeout(600);
    s = await state(p);
    ok(!s.desks[1].wins.some(w => w.app === 'frame'), 'close button closes a window');
    // Chats can be closed entirely and reopened from the launcher.
    const ci = s.desks.findIndex(d => d.wins.some(w => w.app === 'chats'));
    await p.evaluate(i => __wos.goDesk(i), ci); await p.waitForTimeout(500);
    await p.locator(`.desk[data-desk="${ci}"]`).locator('.win.app-chats [data-wact="close"]').tap(); await p.waitForTimeout(600);
    s = await state(p);
    ok(!s.desks.some(d => d.wins.some(w => w.app === 'chats')), 'Chats can be closed like any app');
    await p.evaluate(() => __wos.openSheet('launcher')); await p.waitForTimeout(400);
    await p.locator('#launcher [data-app="wizard"]').first().tap(); await p.waitForTimeout(800);
    s = await state(p);
    ok(s.desks[s.idx].wins.some(w => w.app === 'chats'), 'Chats reopens from the launcher on the current desk');
    ok(errs.length === 0, 'no page errors (windows run)', errs.join(' | '));
    await ctx.close();
  }

  /* ---------- 4. View-aware voice + aimed commands (sends intercepted) ---------- */
  {
    const { ctx, p, writes, errs } = await boot(b);
    await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
    await tap(p, '.ch-row'); await p.waitForTimeout(1200);
    const ctxText = await p.evaluate(() => __wos.viewContext(null, 'voice'));
    ok(/Window in front: Chats thread/.test(ctxText), 'orb knows the window in front', ctxText.slice(0, 160));
    const v = await p.evaluate(() => __wos.viewOf(__wos.desks[1].focus));
    ok(v && v.mode === 'auto', 'a Chats thread is an auto-routing view');
    // Speech meant for the thread: a reply goes into that thread (steer or new run), carrying the view context.
    writes.length = 0;
    await p.evaluate(() => __wos.handleText('Yes, go ahead with that plan', 'auto', false, 0, null));
    await p.waitForTimeout(4000);
    const run = writes.find(w => /\/v1\/runs/.test(w.u));
    const body = run ? JSON.parse(run.body || '{}') : {};
    const tid = await p.evaluate(() => __wos.wins[__wos.desks[1].focus].thread);
    ok(run && (body.session_id === tid || /\/steer$/.test(run.u)), 'a reply to the thread in front goes into that thread', JSON.stringify({ u: run?.u, sid: body.session_id, tid }));
    const steered = run && /\/steer$/.test(run.u);
    ok(run && !/Wizard OS context/.test(JSON.stringify(body.input)) && (steered || /Wizard OS context/.test(body.instructions || '')), 'view context rides as instructions (new run) and never pollutes the message text', steered ? 'steered the live run' : 'new run');
    // With a thread open, even a new-sounding request stays in that thread (James, 9 Oct 2026: steering must
    // never spawn a thread). New threads start from the list or New chat; qa-thread-voice.cjs covers both.
    writes.length = 0;
    await p.evaluate(() => __wos.handleText('Research the best e-ink tablets for reading PDFs', 'auto', false, 0, null));
    await p.waitForTimeout(4000);
    const created = writes.find(w => /\/api\/sessions$/.test(w.u));
    ok(!created, 'with a thread open, a new-sounding request stays in that thread', JSON.stringify(writes.map(w => w.u)));
    // Hold + slide right: the command lands on the next desk.
    const before = await state(p);
    await p.evaluate(() => __wos.handleText('open week in review', 'command', false, 0, 2));
    await p.waitForTimeout(900);
    const after = await state(p);
    ok(after.desks[2].wins.some(w => w.app === 'review') && after.idx === 2, 'hold + slide right opens the command on the next desk', JSON.stringify(after.desks.map(d => d.wins.map(w => w.app))));
    ok(errs.length === 0, 'no page errors (voice run)', errs.join(' | '));
    await p.screenshot({ path: OUT + '/44-aimed.png' });
    await ctx.close();
  }

  /* ---------- 5. Desk dots, peek stack, scrubber, Home → Topics → Mizel ---------- */
  {
    const { ctx, p, errs } = await boot(b);
    let s = await state(p);
    const apps = s.desks.map(d => d.wins.map(w => w.app));
    const ids = await p.evaluate(() => __wos.desks.map(d => d.wins.map(id => __wos.wins[id].appId || __wos.wins[id].app)));
    ok(ids[3][0] === 'topics' && ids[4][0] === 'mizel', 'layout: Home, then Topics, then Mizel', JSON.stringify(ids));
    ok(ids[1].includes('chats'), 'Chats still one desk left of Home', JSON.stringify(ids));
    // Topics isn't published yet: its window shows a "coming" card, never an error page.
    await p.evaluate(() => __wos.goDesk(3)); await p.waitForTimeout(1500);
    const topics = await p.evaluate(() => { const w = document.querySelector('.desk[data-desk="3"]').querySelector('.frame-wrap'); const f = w?.querySelector('iframe'); let href = ''; try { href = f.contentWindow.location.href; } catch (e) {} return { coming: w?.classList.contains('coming'), href }; });
    ok(topics.coming || /wizard-topics-preview/.test(topics.href), 'Topics desk: on-its-way card until published, then the live app', JSON.stringify(topics));
    await p.screenshot({ path: OUT + '/50-topics-coming.png' });
    await p.evaluate(() => __wos.goDesk(2)); await p.waitForTimeout(700);
    // Tap a dot → that desk.
    await p.locator('#dotsR [data-goto="4"]').tap(); await p.waitForTimeout(700);
    s = await state(p); ok(s.idx === 4, 'tap a dot → jumps straight to that desk', 'idx=' + s.idx);
    await p.screenshot({ path: OUT + '/51-mizel.png' });
    // Long-press a dot → peek stack.
    const dot = await p.locator('#dotsL [data-goto="1"]').boundingBox();
    const cdp = await ctx.newCDPSession(p);
    const pt = [{ x: dot.x + dot.width / 2, y: dot.y + dot.height / 2, id: 1 }];
    await p.evaluate(() => { window.__dev = []; ['pointerdown','pointerup','pointercancel','pointerleave','click','contextmenu'].forEach(k => document.getElementById('dock').addEventListener(k, e => __dev.push(k + '@' + Math.round(performance.now())), true)); });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await p.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForFunction(() => document.querySelector('#overview.open'), null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(500);
    s = await state(p);
    ok(await p.locator('#overview.open .ov-card[data-ov]').count() === s.desks.length && s.idx === 4, 'long-press a dot → overview of every desk as cards (no jump)', 'idx=' + s.idx + ' ' + JSON.stringify(await p.evaluate(() => ({ dev: __dev, peek: document.getElementById('peek')?.className, cards: document.querySelectorAll('#peek .pk-card').length, back: __wos.back.log.slice(-4) }))));
    await p.screenshot({ path: OUT + '/52-peek.png' });
    await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('#overview.open'), null, { timeout: 4000 }).catch(() => {});
    ok(await p.locator('#overview.open').count() === 0 && (await state(p)).idx === 4, 'Back closes the overview, stays on the desk');
    await p.evaluate(() => __wos.openPeek(4)); await p.waitForTimeout(900);
    await p.locator('#overview .ov-card[data-ov]').nth(1).click(); await p.waitForTimeout(700);
    ok((await state(p)).idx === 1, 'tap a card → that desk');
    // Scrubber: hold the strip under the orb, nudge right desk by desk, release lands.
    const sc = await p.locator('#scrub').boundingBox();
    const sx = sc.x + sc.width / 2, sy = sc.y + sc.height / 2;
    await p.mouse.move(sx, sy); await p.mouse.down(); await p.waitForTimeout(250);
    const seen = [];
    for (let k = 1; k <= 3; k++) { await p.mouse.move(sx + k * 27, sy, { steps: 3 }); await p.waitForTimeout(120); seen.push(await p.evaluate(() => __wos.idx)); }
    await p.screenshot({ path: OUT + '/53-scrub.png' });
    await p.mouse.up(); await p.waitForTimeout(600);
    s = await state(p);
    ok(JSON.stringify(seen) === '[2,3,4]' && s.idx === 4, 'scrubber steps one desk per small nudge, release lands', JSON.stringify({ seen, idx: s.idx }));
    ok(errs.length === 0, 'no page errors (dots/peek/scrub)', errs.join(' | '));
    await ctx.close();
  }

  await b.close();
  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('Error', e); process.exit(2); });
