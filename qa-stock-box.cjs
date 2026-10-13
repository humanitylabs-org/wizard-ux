// Wizard UX on a stock Hermes box: boot, neutral identity, no owner-specific strings, real send + reply.
// Usage: node qa-stock-box.cjs http://127.0.0.1:18787/wizard-ux/
const { chromium } = require('/home/developer/node_modules/playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18787/wizard-ux/';
const BANNED = /Archimedes|James|Bangkok|wizard001/;
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };

(async () => {
  const browser = await chromium.launch();
  try {
    // ---- desktop shell ----
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    await page.goto(BASE + 'desktop.html?shell=desktop', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.WizConfig && window.WizConfig.live, null, { timeout: 15000 });
    const cfg = await page.evaluate(() => ({ agent: WizConfig.agent(), owner: WizConfig.owner(), tz: WizConfig.timeZone(), voice: WizConfig.has('voice'), route: WizConfig.endpoint('route') }));
    ok('desktop boots from /wizard/v1/bootstrap', cfg.agent === 'Wizard', JSON.stringify(cfg));
    ok('voice hidden when no transcriber answers', cfg.voice === false);
    ok('no router on a stock box', cfg.route === '');
    ok('mic hidden without a transcriber', await page.evaluate(() => document.querySelector('#micBtn').hidden));
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[placeholder]')].map(e => e.placeholder).join(' '));
    const hit = text.match(BANNED);
    ok('desktop shows no owner-specific names', !hit, hit ? hit[0] : '');
    await page.screenshot({ path: '/home/developer/.hermes/cache/scratch/stock-desktop.png' });
    ok('desktop: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    // ---- phone shell ----
    const pctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' });
    const ph = await pctx.newPage();
    const perr = [];
    ph.on('pageerror', e => perr.push(String(e.message || e)));
    await ph.goto(BASE + '?shell=phone', { waitUntil: 'networkidle' });
    await ph.waitForFunction(() => window.WizConfig && window.WizConfig.live, null, { timeout: 15000 });
    await ph.waitForTimeout(1500);
    const ptext = await ph.evaluate(() => document.body.innerText);
    const phit = ptext.match(BANNED);
    ok('phone shows no owner-specific names', !phit, phit ? phit[0] : '');
    const apps = await ph.evaluate(() => window.WizCore.apps('mobile').APPS.filter(a => a.kind === 'wizard' || a.kind === 'chats').map(a => a.id));
    ok('phone launcher has Chats only (no private apps baked in)', apps.length === 1 && apps[0] === 'wizard', apps.join(','));
    await ph.screenshot({ path: '/home/developer/.hermes/cache/scratch/stock-phone.png' });
    ok('phone: no page errors', perr.length === 0, perr.slice(0, 2).join(' | '));

    // ---- real send through the UX's own client (live.js → Agent Service → stock Hermes) ----
    const marker = 'UX-STOCK-' + Date.now().toString(36).toUpperCase();
    const sent = await page.evaluate(async m => {
      const live = window.WizLive || (window.wos && window.wos().live) || window.LIVE;
      if (!live || !live.send) return { error: 'no live client' };
      return live.send(`Reply with exactly: ${m}`);
    }, marker);
    ok('UX send admitted', !!(sent && sent.sessionId && sent.runId), JSON.stringify(sent).slice(0, 160));
    let reply = '';
    for (let i = 0; i < 50 && sent?.sessionId; i++) {
      await page.waitForTimeout(3000);
      reply = await page.evaluate(async sid => {
        const r = await fetch(`/wizard/hermes/api/sessions/${encodeURIComponent(sid)}/messages`);
        const d = await r.json();
        const a = (d.data || []).filter(x => x.role === 'assistant').pop();
        return a ? String(a.content || '') : '';
      }, sent.sessionId);
      if (reply.includes(marker)) break;
    }
    ok('stock Hermes replied through Wizard UX', reply.includes(marker), reply.slice(0, 80));
    let listed = false;
    for (let i = 0; i < 40 && !listed; i++) {
      await page.evaluate(() => window.WizLive.refresh && window.WizLive.refresh());
      await page.waitForTimeout(1500);
      listed = await page.evaluate(sid => [...document.querySelectorAll('[data-thread],[data-sid],[data-session]')].some(e => (e.dataset.thread || e.dataset.sid || e.dataset.session) === sid) || !!window.WizLive.session(sid), sent?.sessionId);
    }
    ok('thread appears in the Chats list', listed);
  } finally {
    await browser.close();
  }
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
