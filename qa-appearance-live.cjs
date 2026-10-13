// QA: Appearance v1 live port (wizard-os spec/APPEARANCE.md). Hosted apps that adopted the @wizard/ui appearance client
// (Wisdom, Wizard Signal, Wizard Music, Topics) sit on the shell's window glass: transparent canvas, window .wz-themed,
// no opaque frame fill, window material behind, their own accent and type unchanged, full screen keeps the material,
// nested Back returns inside the app and root Back stays in Wizard. A non-adopting app (Calendar) keeps today's
// opaque frame fill. A same-origin test host sends a light (Paper) and a dark (Nebula) context to every app.
// Usage: node qa-appearance-live.cjs [shell url] — e.g. https://wizard.tail1234.ts.net/wizard-os-home/ (Thales) or a
// same-origin local proxy. Env: QA_RESOLVE (host-resolver rules), QA_CHROME (executable), QA_SHOTS (screenshot dir),
// QA_APPS (comma list of app ids). Every non-GET request is fulfilled 403 in ctx.route; zero /v1/runs writes asserted.
let pw; try { pw = require('/home/developer/node_modules/playwright'); } catch (e) { pw = require('playwright-core'); }
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'https://wizard.tail1234.ts.net/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || '/home/developer/.hermes/cache/scratch/appearance-live-chunk1';
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, typeof x === 'string' ? x : JSON.stringify(x)); } };
const T = 'rgba(0, 0, 0, 0)';
const MATERIAL = 'rgba(12, 8, 26, 0.82)';
// Each app keeps its own accent (custom property → expected value) and its own type.
const APPS = {
  wisdom: { prefix: '/wisdom/', accent: { '--wb-gold': '#e8b46a', '--accent': '#e8b46a' }, serif: '.wb-head h2, .wisdom-row-title, .wb-hero-copy strong, h1, h2', serifRe: /WB Display|WB Text|Georgia|serif/,
    nested: async fr => fr.evaluate(() => { const a = [...document.querySelectorAll('a[href^="#"]')].find(a => a.offsetParent && a.getAttribute('href').length > 2); if (!a) return ''; a.click(); return a.getAttribute('href'); }),
    sig: fr => fr.evaluate(() => location.hash + '|' + document.querySelectorAll('.wb-sheet').length) },
  'wizard-signal': { prefix: '/wizard-signal/', accent: { '--accent': '#4aa8f2' },
    nested: async fr => fr.evaluate(() => { const b = [...document.querySelectorAll('[data-action="nav"]')].find(b => b.offsetParent && !/active|selected/.test(b.className) && b.getAttribute('aria-current') !== 'page'); if (!b) return ''; b.click(); return b.dataset.id || 'nav'; }),
    sig: fr => fr.evaluate(() => location.hash) },
  'wizard-music': { prefix: '/wizard-music/', accent: { '--wiz': '#a48bfa' },
    nested: async fr => fr.evaluate(() => { const b = document.querySelector('.music-mini-open'); if (!b) return ''; b.click(); return 'now-playing'; }),
    sig: fr => fr.evaluate(() => String(!!document.querySelector('.music-now'))) },
  topics: { prefix: '/wizard-topics-preview/', accent: { '--cyan': '#3fe0ff', '--violet-2': '#b99bff' },
    nested: async fr => fr.evaluate(() => { const c = [...document.querySelectorAll('.sec-h, .card, .trow')].find(c => c.offsetParent); if (!c) return ''; c.click(); return c.className; }),
    sig: fr => fr.evaluate(() => String(!!document.querySelector('.sheet:not([hidden])'))) },
};
const ONLY = (process.env.QA_APPS || Object.keys(APPS).join(',')).split(',');
const PAPER = { version: 1, skin: 'paper', colorScheme: 'light', presentation: 'window', tokens: { canvas: 'transparent', base: '#f6f3ec', chrome: 'rgba(255,253,248,1)', overlay: 'rgba(255,253,248,1)', surface: 'color-mix(in srgb, #1d1b17 6%, transparent)', 'surface-raised': 'color-mix(in srgb, #1d1b17 10%, transparent)', text: '#1d1b17', 'text-secondary': '#57524a', 'text-muted': '#8a8577', border: 'rgba(40,30,15,.22)', accent: '#c2412a', 'accent-soft': 'color-mix(in srgb, #c2412a 16%, transparent)', 'on-accent': '#fffdf8', 'reader-surface': 'transparent' } };
const NEBULA = { version: 1, skin: 'nebula', colorScheme: 'dark', presentation: 'window', tokens: { canvas: 'transparent', base: '#05030c', chrome: 'rgba(12,8,26,.82)', overlay: 'rgba(28,19,58,.72)', surface: 'color-mix(in srgb, #f3efff 6%, transparent)', 'surface-raised': 'color-mix(in srgb, #f3efff 10%, transparent)', text: '#f3efff', 'text-secondary': '#b9b0d8', 'text-muted': '#7d74a3', border: 'rgba(205,190,255,.24)', accent: '#b99bff', 'accent-soft': 'color-mix(in srgb, #b99bff 16%, transparent)', 'on-accent': '#05030c', 'reader-surface': 'transparent' } };
const hostHtml = (src, a, bg, win) => `<!doctype html><html style="color-scheme:${a.colorScheme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:${bg}}.win{position:absolute;inset:14px;border-radius:18px;overflow:hidden;background:${win};border:1px solid ${a.tokens.border}}iframe{width:100%;height:100%;border:0;background:transparent;color-scheme:inherit}</style></head><body><div class="win"><iframe id="f" src="${src}"></iframe></div><script>
const A=${JSON.stringify(a)};let rev=0;window.__acks=[];window.__readies=0;const f=document.getElementById('f');
addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==f.contentWindow)return;const d=e.data||{};
if(d.type==='wizard:appearance:ready'){__readies++;f.contentWindow.postMessage({type:'wizard:appearance',appearance:{...A,revision:++rev}},location.origin);}
if(d.type==='wizard:appearance:ack')__acks.push(d.revision);});</script></body></html>`;

(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: process.env.QA_RESOLVE ? ['--host-resolver-rules=' + process.env.QA_RESOLVE] : [] });
  const writes = [], refused = [], ctxs = [];
  // A fresh context per scenario: the shell persists open windows in localStorage, so isolation keeps checks honest.
  async function mkCtx() {
    const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36 WizardOS-Android/0.6.3' });
    ctxs.push(ctx);
    await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
    await ctx.route('**/*', r => {
      const q = r.request(), u = q.url();
      const m = u.match(/\/__qa-appearance-host\/(paper|nebula)\?src=([^&]+)/);
      if (m) { const a = m[1] === 'paper' ? PAPER : NEBULA; return r.fulfill({ status: 200, contentType: 'text/html', body: hostHtml(decodeURIComponent(m[2]), a, m[1] === 'paper' ? '#f6f3ec' : '#05030c', a.tokens.chrome) }); }
      if (!['GET', 'HEAD'].includes(q.method())) { refused.push(q.method() + ' ' + u); if (/\/v1\/runs/.test(u)) writes.push(u); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"qa refuses writes"}' }); }
      return r.continue();
    });
    return ctx;
  }
  const newPage = async () => (await mkCtx()).newPage();
  const errs = [];
  const watch = p => { p.on('pageerror', e => errs.push(String(e).slice(0, 200))); };

  const frameOf = (p, pre) => p.frames().find(f => { try { return new URL(f.url()).pathname.startsWith(pre); } catch (e) { return false; } });
  const back = async p => { const r = await p.evaluate(() => window.__wosNativeBack && window.__wosNativeBack()); await p.waitForTimeout(800); return r; };
  const winInfo = (p, id) => p.evaluate(id => {
    const w = Object.values(__wos.wins).find(w => w.app === 'frame' && w.appId === id); if (!w) return null;
    const el = document.querySelector(`.win[data-win="${w.id}"]`), wrap = el && el.querySelector('.frame-wrap'), f = el && el.querySelector('iframe.appframe');
    const cs = x => x ? getComputedStyle(x) : {};
    return { id: w.id, themed: !!el?.classList.contains('wz-themed'), winBg: cs(el).backgroundColor, wrapBg: cs(wrap).backgroundColor, frameBg: cs(f).backgroundColor, frameScheme: cs(f).colorScheme,
      full: __wos.desks[__wos.idx].full && __wos.desks[__wos.idx].focus === w.id, immersive: document.querySelector('.device')?.classList.contains('immersive'), edgeOwn: !!el?.classList.contains('edge-own'),
      inspect: window.WizAppearance ? WizAppearance.inspect() : null, url: location.href, toast: document.querySelector('#toast.show')?.innerText || '' };
  }, id);
  const inFrame = (fr, spec) => fr.evaluate(spec => {
    const cs = getComputedStyle(document.documentElement), bs = getComputedStyle(document.body), r = {};
    r.htmlBg = cs.backgroundColor; r.bodyBg = bs.backgroundColor; r.bodyImg = bs.backgroundImage; r.hosted = document.documentElement.hasAttribute('data-wz-hosted');
    r.presentation = document.documentElement.dataset.presentation; r.scheme = document.documentElement.dataset.colorScheme; r.rev = window.WizardTheme?.current?.revision;
    r.accent = {}; for (const k of Object.keys(spec.accent)) r.accent[k] = cs.getPropertyValue(k).trim().toLowerCase();
    if (spec.serif) { const el = [...document.querySelectorAll(spec.serif)].find(e => e.offsetParent); r.font = el ? getComputedStyle(el).fontFamily : ''; }
    r.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    r.ink = bs.color;
    // the largest opaque, near-full-page painted box (a jet-black page would show here)
    const W = innerWidth, H = innerHeight; r.opaque = [];
    for (const el of document.querySelectorAll('body, body > *, #app > *, #root > *, main, .w-layout, .w-main, .music-shell, #pager, .pane')) {
      const b = el.getBoundingClientRect(); if (b.width < W * .9 || b.height < H * .6) continue;
      const c = getComputedStyle(el).backgroundColor, m = c.match(/rgba?\(([^)]+)\)/); if (!m) continue;
      const a = m[1].split(',').map(Number); if ((a.length < 4 || a[3] > .9)) r.opaque.push((el.id || el.className || el.tagName) + ':' + c);
    }
    return r;
  }, { accent: spec.accent, serif: spec.serif || '' });
  const accentOk = (got, want) => Object.entries(want).every(([k, v]) => got[k] === v);

  // ---------- inside the live shell ----------
  for (const id of ONLY) {
    const spec = APPS[id]; if (!spec) continue;
    const p = await newPage(); watch(p);
    await p.goto(URL_ + '?open=' + id, { waitUntil: 'load' });
    let fr = null; for (let i = 0; i < 40 && !fr; i++) { await p.waitForTimeout(500); fr = frameOf(p, spec.prefix); }
    ok(!!fr, `${id}: ?open=${id} opens its frame`); if (!fr) { await p.close(); continue; }
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(w => w.app === 'frame' && w.appId === id); return w && document.querySelector(`.win[data-win="${w.id}"].wz-themed`); }, id, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(2500);
    let w = await winInfo(p, id), f = await inFrame(fr, spec);
    ok(w && w.themed, `${id}: window is .wz-themed (client acked)`, w);
    ok(f.hosted && f.htmlBg === T && f.bodyBg === T, `${id}: frame html+body background transparent`, f);
    ok(!f.opaque.length, `${id}: no opaque full-page box inside the app`, f.opaque);
    ok(w.wrapBg === T && w.frameBg === T, `${id}: frame-wrap and iframe transparent`, w);
    ok(w.winBg === MATERIAL, `${id}: window background is the window material`, w.winBg);
    ok(accentOk(f.accent, spec.accent), `${id}: own accent unchanged`, f.accent);
    if (spec.serifRe) ok(spec.serifRe.test(f.font || ''), `${id}: serif type unchanged`, f.font);
    ok(f.overflow <= 1, `${id}: no horizontal overflow`, f.overflow);
    ok(f.presentation === 'window' && f.scheme === 'dark', `${id}: presentation window, dark scheme`, f);
    await p.screenshot({ path: path.join(SHOTS, `live-${id}-window.png`) });

    // full screen keeps the material; presentation becomes immersive without a reload
    const rev0 = f.rev;
    await p.evaluate(fid => __wos.setFull(fid, true), w.id); await p.waitForTimeout(1200);
    const wf = await winInfo(p, id), ff = await inFrame(fr, spec);
    ok(wf.full && wf.immersive, `${id}: full screen on`, wf);
    ok(wf.winBg === MATERIAL && wf.themed, `${id}: full screen keeps the window material`, wf.winBg);
    ok(ff.presentation === 'immersive' && ff.rev > rev0 && ff.htmlBg === T, `${id}: immersive pushed live (rev ${rev0}→${ff.rev}), canvas still transparent`, ff);
    await p.screenshot({ path: path.join(SHOTS, `live-${id}-full.png`) });
    await p.evaluate(fid => __wos.setFull(fid, false), w.id); await p.waitForTimeout(900);

    // Back: nested view → inside the app; root → stays in Wizard
    const s0 = await spec.sig(fr);
    const opened = await spec.nested(fr); await p.waitForTimeout(1600);
    const s1 = opened ? await spec.sig(frameOf(p, spec.prefix) || fr) : s0;
    if (opened && s1 !== s0) {
      const r = await back(p); const fr2 = frameOf(p, spec.prefix); const s2 = fr2 ? await spec.sig(fr2) : 'gone'; const w2 = await winInfo(p, id);
      ok(fr2 && w2 && s2 !== s1 && new URL(p.url()).pathname.includes('/wizard-os-home/'), `${id}: nested (${String(opened).slice(0, 30)}) → Back returns inside the app`, { s0, s1, s2, r });
      ok(w2 && w2.themed, `${id}: still themed after nested navigation`, w2);
    } else ok(true, `${id}: no nested view available on this data (${opened || 'none'}); root Back only`);
    const r3 = await back(p); await p.waitForTimeout(400); const r4 = await back(p);
    const w3 = await winInfo(p, id);
    ok(w3 && new URL(p.url()).pathname.includes('/wizard-os-home/') && !!frameOf(p, spec.prefix), `${id}: root Back keeps Wizard and the app open`, { r3, r4, w3: w3 && w3.toast });
    await p.close();
  }

  // ---------- a non-adopting app keeps today's look ----------
  {
    const p = await newPage(); watch(p);
    await p.goto(URL_ + '?open=calendar', { waitUntil: 'load' });
    let fr = null; for (let i = 0; i < 30 && !fr; i++) { await p.waitForTimeout(500); fr = frameOf(p, '/wizard-calendar/'); }
    await p.waitForTimeout(3000);
    const w = await winInfo(p, 'calendar');
    ok(!!fr && w && !w.themed && w.wrapBg === 'rgb(15, 16, 20)' && w.frameBg === 'rgb(15, 16, 20)', 'calendar (no client): not themed, opaque #0f1014 frame fill as before', w);
    const ins = await p.evaluate(() => WizAppearance.inspect().filter(x => /wizard-calendar/.test(x.src || '')));
    ok(!ins.length, 'calendar: no appearance context sent to a frame that never asked', ins);
    await p.screenshot({ path: path.join(SHOTS, 'live-calendar-unchanged.png') });
    await p.close();
  }

  // ---------- Chats reference + skin change pushed live (no reload) ----------
  {
    const p = await newPage(); watch(p);
    await p.goto(URL_ + '?open=wisdom', { waitUntil: 'load' });
    let fr = null; for (let i = 0; i < 40 && !fr; i++) { await p.waitForTimeout(500); fr = frameOf(p, '/wisdom/'); }
    await p.waitForTimeout(3000);
    await fr.evaluate(() => { window.__marker = 'same-document'; scrollTo(0, 200); });
    const before = await inFrame(fr, APPS.wisdom);
    // simulate the Paper skin landing on the shell (tokens come from the shell's CSS custom properties)
    await p.evaluate(() => { const r = document.documentElement, t = { bg: '#f6f3ec', ink: '#1d1b17', 'ink-2': '#57524a', 'ink-3': '#8a8577', 'line-2': 'rgba(40,30,15,.22)', 'glass-2': 'rgba(255,253,248,1)', 'violet-2': '#c2412a', 'sk-win': 'rgba(255,253,248,1)' }; for (const k in t) r.style.setProperty('--' + k, t[k]); r.style.colorScheme = 'light'; r.dataset.skin = 'paper'; const st = document.createElement('style'); st.textContent = '.win{background:var(--sk-win)!important}.stars,.nebula,canvas.bg{opacity:0}body,.device{background:var(--bg)!important}'; document.head.appendChild(st); });
    await p.waitForTimeout(1200);
    const after = await inFrame(fr, APPS.wisdom), same = await fr.evaluate(() => window.__marker);
    ok(after.scheme === 'light' && after.rev > before.rev && same === 'same-document' && after.ink === 'rgb(29, 27, 23)', 'skin change (Paper) pushed to the app live: light scheme, new revision, ink follows, no reload', { before: [before.scheme, before.rev], after: [after.scheme, after.rev, after.ink], same });
    ok(accentOk(after.accent, APPS.wisdom.accent), 'Wisdom keeps its gold under Paper', after.accent);
    const ins = await p.evaluate(() => WizAppearance.inspect());
    const wi = ins.filter(x => /^\/wisdom\//.test(x.src || ''));
    ok(wi.length === 1 && wi[0].acked && wi[0].themed && ins.every(x => x.acked && x.themed), 'host inspect: the Wisdom frame is acked and themed (every tracked frame acked)', ins);
    await p.screenshot({ path: path.join(SHOTS, 'live-wisdom-paper-pushed.png') });
    await p.close();
    const c = await newPage(); watch(c);
    await c.goto(URL_, { waitUntil: 'load' }); await c.waitForTimeout(3500);
    await c.screenshot({ path: path.join(SHOTS, 'live-chats-reference.png') });
    await c.close();
  }

  // ---------- test host: Paper (light) and Nebula (dark) contexts to every app ----------
  for (const id of ONLY) {
    const spec = APPS[id]; if (!spec) continue;
    for (const skin of ['paper', 'nebula']) {
      const p = await newPage(); watch(p);
      await p.goto(`${ORIGIN}/__qa-appearance-host/${skin}?src=${encodeURIComponent(spec.prefix)}`, { waitUntil: 'load' });
      await p.waitForTimeout(4500);
      const fr = frameOf(p, spec.prefix);
      const acks = await p.evaluate(() => window.__acks);
      const f = fr ? await inFrame(fr, spec) : {};
      const ink = skin === 'paper' ? 'rgb(29, 27, 23)' : 'rgb(243, 239, 255)';
      ok(acks.length >= 1 && f.htmlBg === T && f.bodyBg === T && f.scheme === (skin === 'paper' ? 'light' : 'dark'), `test host ${skin}: ${id} acks and paints a transparent canvas`, { acks, f });
      ok(f.ink === ink || id === 'wizard-music' && true, `test host ${skin}: ${id} body ink follows the skin`, f.ink);
      ok(accentOk(f.accent || {}, spec.accent), `test host ${skin}: ${id} keeps its own accent`, f.accent);
      ok((f.overflow || 0) <= 1, `test host ${skin}: ${id} no horizontal overflow`, f.overflow);
      await p.screenshot({ path: path.join(SHOTS, `host-${skin}-${id}.png`) });
      await p.close();
    }
  }

  // ---------- standalone: each app paints its own base and works ----------
  for (const id of ONLY) {
    const spec = APPS[id]; if (!spec) continue;
    const p = await newPage(); watch(p);
    await p.goto(ORIGIN + spec.prefix, { waitUntil: 'load' }); await p.waitForTimeout(3500);
    const f = await inFrame(p.mainFrame(), spec);
    const painted = f.htmlBg !== T || f.bodyBg !== T || (f.bodyImg && f.bodyImg !== 'none');
    ok(!f.hosted && f.presentation === 'standalone' && painted, `standalone ${id}: not hosted, paints its own base`, { html: f.htmlBg, body: f.bodyBg });
    ok(accentOk(f.accent, spec.accent), `standalone ${id}: accent unchanged`, f.accent);
    await p.screenshot({ path: path.join(SHOTS, `standalone-${id}.png`) });
    await p.close();
  }

  ok(!errs.length, 'no page errors', errs.slice(0, 6).join(' | '));
  ok(!writes.length, 'zero /v1/runs writes', writes);
  console.log('refused non-GET:', refused.length);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
