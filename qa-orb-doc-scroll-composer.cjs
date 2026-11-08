// Regression (James, 8 Nov 2026): a full-screen phone thread in the Working state (Stop button) showed a narrow, tall composer
// (model chip wrapped, Stop 60px short of the edge) with the orb parked below it in the corner. Invariant: the composer
// reserves its orb column only where the orb really overlays it. On the Android app (UA WizardOS-DocScroll) the composer is
// position:fixed above the bottom strip, so the corner orb is under it and nothing may be reserved. Checked in both modes,
// through Working -> idle -> Working, resume events, resize and a focus/blur. Every request is intercepted.
// Usage: QA_WEB_DIR=<repo> [QA_SHOTS=dir] node qa-orb-doc-scroll-composer.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin();
const W = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
const now = Date.now() / 1000;
const THREADS = Array.from({ length: 4 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 4, preview: 'Preview line', last_active: now - i * 600, started_at: now - 9000, status: i === 0 ? 'running' : 'idle', wizard_run_id: i === 0 ? 'run-1' : '' }));
const MSGS = [
  { id: 1, role: 'user', content: 'Why are the reports not unread?', timestamp: now - 900 },
  { id: 2, role: 'assistant', content: 'Those 9 threads will show as unread once Wizard refreshes on your phone. '.repeat(6), timestamp: now - 880 },
];
let RUN = true;
const VW = 360, VH = 780;
(async () => {
  const b = await chromium.launch({});
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, userAgent: process.env.QA_DOC ? 'Mozilla/5.0 (Linux; Android 14; SM-S938B) AppleWebKit/537.36 Chrome/156.0 Mobile Safari/537.36 WizardOS-DocScroll' : undefined, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.origin !== ORIGIN) return r.abort();
    const json = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (q.method() !== 'GET' && q.method() !== 'HEAD') return json(200, { state: { initializedAt: Date.now(), threads: {} } });
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html';
      let p = path.join(W, 'web', f); if (!fs.existsSync(p) && /^(data|summaries)\.js$/.test(f)) p = path.join(require('./tools/qa-paths.cjs').repoRoot, 'web', f);
      if (!fs.existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(p) });
    }
    if (/\/hermes\/api\/sessions$/.test(u.pathname)) return json(200, { data: THREADS.map((t, i) => i ? t : { ...t, status: RUN ? 'running' : 'idle', wizard_run_id: RUN ? 'run-1' : '' }), has_more: false });
    const mm = u.pathname.match(/\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) return json(200, { object: 'list', data: MSGS.map(x => ({ ...x, session_id: mm[1] })), pagination: { has_more: false } });
    const sm = u.pathname.match(/\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) return json(200, { session: THREADS.find(t => t.id === sm[1]) || THREADS[0] });
    return json(200, {});
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(sk => { try { if (sk) localStorage.setItem('wos.skin', sk); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.welcome.v1', 'done'); localStorage.setItem('wos.voiceTipSeen', 'true'); if (location.search.includes('layout=ai-apps') || window.__QA_LAYOUT) localStorage.setItem('wos.layout', 'ai-apps'); } catch (e) {} }, process.env.QA_SKIN || '');
  await p.goto(ORIGIN + '/wizard-os-home/' + (process.env.QA_SHELL ? '?shell=' + process.env.QA_SHELL : process.env.QA_LAYOUT ? '?layout=' + process.env.QA_LAYOUT : ''), { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(700);
  const shot = async n => { await p.addStyleTag({ content: '#wosWelcome { display: none !important }' }).catch(() => {}); if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
  const geo = label => p.evaluate(label => {
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const dev = document.querySelector('#device'), c = document.querySelector('.win .ch-thread .ch-compose');
    return { label, layout: document.documentElement.dataset.layout || '', cls: dev.className.replace(/\s+/g, ' '), voice: __wos.voice,
      stop: !!document.querySelector('.ch-stop'), docScroll: document.documentElement.classList.contains('wos-doc-scroll'), compPos: c ? getComputedStyle(c).position : null, compOP: c ? !!c.offsetParent : null, compH: getComputedStyle(dev).getPropertyValue('--comp-h'), orb: r(document.querySelector('#orbWrap')), dock: r(document.querySelector('#dock')),
      comp: r(c), row: r(c?.querySelector('.ch-row2')), ta: r(c?.querySelector('textarea')),
      padR: c ? getComputedStyle(c).paddingRight : null, wbar: (() => { const w = document.querySelector('.win .wbar'); return w ? getComputedStyle(w).display : null; })(), head: document.querySelector('.win .ch-head')?.innerText?.slice(0, 40), title: document.querySelector('.win .wt')?.textContent, winCls: document.querySelector('.win.full') ? 'full' : 'tiled', vv: [innerWidth, innerHeight] };
  }, label);
  const log = async l => { const g = await geo(l); return g; };

  let fails = 0, checks = 0;
  const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
  const inv = async label => {
    const g = await geo(label);
    const hit = !!(g.orb && g.comp && g.orb[0] < g.comp[0] + g.comp[2] && g.orb[0] + g.orb[2] > g.comp[0] && g.orb[1] < g.comp[1] + g.comp[3] && g.orb[1] + g.orb[3] > g.comp[1]);
    const pad = parseFloat(g.padR);
    if (process.env.QA_DOC) ok(!hit, `${label}: on the Android app the orb sits below the composer, not over it`);
    ok(hit || pad <= 12, `${label}: orb ${hit ? 'overlays' : 'is outside'} the composer, reserved right padding ${g.padR}`);
    // the controls reach the right edge unless the orb is over them
    const right = await p.evaluate(() => { const c = document.querySelector('.win .ch-thread .ch-compose'); const kids = [...c.querySelectorAll('.ch-row2 > *, .ch-row2 .ch-stop, .ch-row2 .ch-mic')].filter(k => k.offsetWidth); return Math.max(...kids.map(k => Math.round(k.getBoundingClientRect().right))); });
    ok(hit ? right <= g.orb[0] + 1 : right >= VW - 24, `${label}: composer controls end at x=${right} (orb ${hit ? 'overlays: must stop left of it' : 'outside: must reach the edge'})`);
    ok(g.comp[3] <= 70 || !g.stop, `${label}: composer stays one line tall (${g.comp[3]}px)`);
    return g;
  };
  const chatsDesk = await p.evaluate(() => __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')));
  await p.evaluate(i => __wos.goDesk(i, true), chatsDesk); await p.waitForTimeout(600);
  const cid = await p.evaluate(() => __wos.desks[__wos.idx].focus);
  await p.evaluate(id => __wos.openChat(id, 'qa-0'), cid); await p.waitForTimeout(1500);
  await p.evaluate(id => __wos.setFull(id, true), cid); await p.waitForTimeout(1000);
  const g0 = await inv('full, Working');
  ok(g0.stop && /orb-corner/.test(g0.cls), 'the Stop button shows in a full-screen corner-orb thread');
  await shot('full-working');
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); window.dispatchEvent(new Event('focus')); }); await p.waitForTimeout(500);
  await inv('after resume events');
  await p.setViewportSize({ width: VW, height: VH - 120 }); await p.waitForTimeout(400); await p.setViewportSize({ width: VW, height: VH }); await p.waitForTimeout(600);
  await inv('after viewport shrink and back');
  for (const [name, run] of [['run ends', false], ['run again', true]]) { RUN = run; await p.evaluate(() => __wos.live.refresh()); await p.waitForTimeout(1200); await inv(name); }
  await p.evaluate(() => document.querySelector('.win.full .ch-compose textarea')?.focus()); await p.waitForTimeout(500); await inv('textarea focused');
  await p.evaluate(() => document.activeElement?.blur()); await p.waitForTimeout(500); await inv('blurred');
  await shot('full-working-final');
  console.log(`${process.env.QA_DOC ? 'DOC-SCROLL' : 'PLAIN'}: ${checks - fails}/${checks} checks, errors ${JSON.stringify(errs)}`);
  await b.close();
  process.exit(fails || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
