/* Open Troubleshooter always reaches the repair page (James, 8 Nov 2026: "The user should never be unable to access
 * the app they need to use to recover it").
 * Per skin, on phone and desktop shells: the waiting send pill's Open Troubleshooter button opens a Troubleshooter
 * window showing the repair page. Then, with Wizard's usual address hung (every /wizard/* and /troubleshoot/* request
 * on the shell origin never answers; simulated here, never by stopping a service), a fresh tap lands on the
 * Troubleshooter's direct line: the phone goes there by itself, desktop offers "Open Troubleshooter directly",
 * which opens it. Fixture reads only; every write on the shell origin is dropped as a network error.
 * Desktop (8 Nov run 5): the 'Name your Wizard' welcome step covered the shell while the fixture agent kept the
 * default name, so the desktop rows never reached the button; the fixture now names the agent (unverified).
 * QA_WEB_DIR=<repo> QA_TS_PAGE=<troubleshooter web/index.html> QA_OUT=<evidence> QA_PLAYWRIGHT=<module> node qa-troubleshooter-direct-line.cjs */
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('./tools/qa-playwright.cjs');
const root = process.env.QA_WEB_DIR || __dirname, out = process.env.QA_OUT || 'qa-live/troubleshooter-direct-line';
const tsPage = process.env.QA_TS_PAGE || path.resolve(root, '..', 'wizard-troubleshooter/web/index.html');
const skins = (process.env.QA_SKINS || 'nebula,sepia').split(',');
const origin = 'http://localhost:9481/wizard-os-home/', DIRECT = 'https://localhost:9691/troubleshoot/';
const sid = 'ts-fixture';
const sessions = Array.from({ length: 12 }, (_, i) => ({ id: i ? 'ts-' + i : sid, title: i ? 'Sample conversation ' + i : 'Design review', source: 'wizard-mobile', model: 'qa', provider: 'qa', message_count: 2, last_active: Date.now() / 1000 - i * 600, preview: 'A sample preview line ' + i }));
const results = [];
const ok = (v, name, detail) => { results.push({ pass: !!v, name, detail }); console.log(v ? 'PASS' : 'FAIL', name, v ? '' : JSON.stringify(detail)); };
const type = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : /\.m?js$/.test(f) ? 'application/javascript' : f.endsWith('.png') ? 'image/png' : f.endsWith('.json') ? 'application/json' : f.endsWith('.woff2') ? 'font/woff2' : 'image/svg+xml';
const KIT = { 'wizard-tokens.css': 'kit/wizard-tokens.css', 'wizard-ui.css': 'kit/wizard-ui.css', 'app-client.js': 'core/app-client.js' };
fs.mkdirSync(out, { recursive: true });

async function run(browser, { desktop, skin, hang }) {
  const label = `${desktop ? 'desktop' : 'phone'}-${skin}${hang ? '-hung' : ''}`;
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: desktop ? { width: 1440, height: 1000 } : { width: 412, height: 892 }, isMobile: !desktop, hasTouch: !desktop, userAgent: desktop ? undefined : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
  const errors = [], state = { hung: false, hungHits: 0, writes: 0 };
  // The Troubleshooter's own page: on the shell origin's /troubleshoot/ route and on its direct line (port 9691).
  const troubleshooter = (r, p) => {
    const json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/troubleshoot/' || p === '/troubleshoot/index.html') return r.fulfill({ contentType: 'text/html', body: r.request().method() === 'HEAD' ? '' : fs.readFileSync(tsPage) });
    const kit = p.startsWith('/troubleshoot/kit/') && KIT[p.slice(18)];
    if (kit) return r.fulfill({ contentType: type(kit), body: fs.readFileSync(path.join(root, 'web', kit)) });
    if (p === '/troubleshoot/api/ping') return json({ ok: true });
    if (p === '/troubleshoot/api/status') return json({ overall: 'degraded', checks: [{ id: 'agent-service', label: 'Agent Service', ok: false, detail: 'QA fixture' }], direct: DIRECT, actions: {} });
    if (p.startsWith('/troubleshoot/api/')) return json({});
    return r.fulfill({ status: 404, body: '' });
  };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname;
    if (u.hostname !== 'localhost') return r.abort();
    if (u.port === '9691') return troubleshooter(r, p); // the direct line has its own process; never hung here
    const json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (q.method() === 'GET' && p.startsWith('/wizard-os-home/')) {
      const rel = p.slice('/wizard-os-home/'.length) || 'index.html', f = path.join(root, 'web', rel);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ body: fs.readFileSync(f), contentType: type(f) });
      return r.fulfill({ status: 404, body: '' });
    }
    // Backend hung: the request is accepted and never answered (gateway up, everything behind it stuck).
    if (state.hung && (p.startsWith('/wizard/') || p.startsWith('/troubleshoot/'))) { state.hungHits++; return; }
    if (p.startsWith('/troubleshoot/')) return troubleshooter(r, p);
    if (q.method() !== 'GET') { state.writes++; return r.abort('connectionreset'); }
    if (p.endsWith('/bootstrap')) return json({ bootstrap: 1, display: { agent_name: 'Merlin', owner_name: 'Tester' }, capabilities: { voice: true, router: true, files: true } });
    if (p.endsWith('/api/sessions')) return json({ sessions });
    if (p.endsWith('/v1/runs')) return json({ runs: [] });
    if (p.endsWith('/api/jobs')) return json({ jobs: [] });
    if (p.endsWith('/agents')) return json({ agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running' }] });
    return json({});
  });
  await ctx.addInitScript(skin => { try { for (const [k, v] of [['wos.coached', 'true'], ['wos.voiceTipSeen', 'true'], ['wos.tour.v1', 'true'], ['wos.tour.done', '1'], ['wos.welcome.v1', 'done'], ['wos.skin', skin]]) localStorage.setItem(k, v); } catch (_) {} }, skin);
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.goto(new URL(desktop ? 'desktop.html' : 'index.html', origin).href);
  await p.waitForFunction(() => (window.__wos || window.__wux)?.chats && window.WosOutbox?.recoveryComplete && WizLive.ok, null, { timeout: 20000 });
  await p.evaluate(skin => { document.getElementById('wosWelcome')?.remove(); try { window.WosSkin?.set?.(skin); } catch (_) {} }, skin);
  // The address Troubleshooter itself reported on an earlier healthy status read (the shell's own learn path).
  await p.evaluate(() => WizReach.diagnose(0));
  ok(await p.evaluate(() => localStorage.getItem('wz.troubleshoot.direct')) === DIRECT, `${label}: direct line learned from Troubleshooter's status`);
  const { wid } = await p.evaluate(async ({ sid }) => {
    // The shells' own Chats openers (phone openWin, desktop openChatsList), as in tools/qa-troubleshooter-entry.cjs.
    const A = window.__wos || window.__wux, w = A.openWin ? A.openWin({ app: 'chats' }) : (A.openChatsList?.(), null);
    const wid = w?.id || Object.keys(A.wins).filter(k => A.wins[k].app === 'chats').pop();
    if (A.openWin) A.chats.openChat(wid, null); A.focusWin?.(wid);
    // Stage it for the agent this Chats window shows (desktop's default window is bound to the default agent).
    const agent = A.chats.winAgent?.(A.wins[wid]) || '';
    const it = await WosOutbox.stage({ kind: 'reply', sessionId: sid, model: 'qa', provider: 'qa', text: 'Waiting fixture', ...(agent ? { agent } : {}) });
    await WosOutbox.transition(it.id, 'failed', 'Not sent'); WosOutbox.retry(it.id);
    return { wid };
  }, { sid });
  // The waiting send pill's button (desktop also accepts the list's own Troubleshoot control: same handler).
  const btn = desktop ? p.locator('[data-chtroubleshoot]:visible').first() : p.locator(`[data-chats="${wid}"] .ch-pill [data-chtroubleshoot]`);
  // Desktop's list pane (id::list) repaints on a connection change, not on an outbox change: nudge it the same way.
  if (desktop) for (let i = 0; i < 10 && !(await btn.count()); i++) { await p.evaluate(() => dispatchEvent(new Event('wizreachchange'))); await p.waitForTimeout(500); }
  await btn.waitFor({ timeout: 15000 }).catch(async e => {
    console.log('DEBUG', label, JSON.stringify(await p.evaluate(wid => ({ wid, lists: [...document.querySelectorAll('[data-chats]')].map(el => el.dataset.chats), pill: document.querySelector('.ch-pill')?.outerHTML?.slice(0, 600) || null, ts: [...document.querySelectorAll('[data-chtroubleshoot]')].map(b => b.closest('[data-chats]')?.dataset.chats + ':' + b.className), listHead: document.querySelector(`[data-chats="${wid}::list"]`)?.innerHTML?.slice(0, 400), items: WosOutbox.unsent?.().map(x => [x.state, x.error, x.kind, x.agent]), agent: (window.__wos || window.__wux).chats.winAgent?.((window.__wos || window.__wux).wins[wid]) || '' }), wid)));
    await p.screenshot({ path: path.join(out, `${label}-no-button.png`) });
    throw e;
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('wosWelcome')?.remove());
  if (hang) state.hung = true;
  const tapAt = Date.now();
  if (await btn.evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)) await btn.click(); else await btn.dispatchEvent('click');
  const winOpen = await p.waitForFunction(() => { const A = window.__wos || window.__wux; return Object.values(A.wins).some(w => w.appId === 'troubleshooter'); }, null, { timeout: 3000 }).then(() => true).catch(() => false);
  if (!hang) {
    ok(winOpen, `${label}: Open Troubleshooter opens a Troubleshooter window`);
    const frame = await p.waitForFunction(() => { const f = document.querySelector('iframe[data-own-app="troubleshooter"]'); return f && !f.hidden && f.contentDocument?.querySelector('header h1') ? true : false; }, null, { timeout: 10000 }).then(() => true).catch(() => false);
    ok(frame, `${label}: the repair page shows in the window`, await p.evaluate(() => document.querySelector('[data-recovery-remote]')?.textContent));
    await p.waitForTimeout(700);
    const shot = path.join(out, `${label}-window.png`); await p.screenshot({ path: shot });
  } else if (!desktop) {
    const landed = await p.waitForURL(u => u.href.startsWith(DIRECT), { timeout: 15000 }).then(() => true).catch(() => false);
    ok(landed, `${label}: with Wizard hung, the button lands on the direct line by itself`, { url: p.url(), hungHits: state.hungHits });
    ok(landed && Date.now() - tapAt < 12000, `${label}: within 12 s of the tap (${Date.now() - tapAt} ms)`);
    const page = landed && await p.waitForSelector('header h1', { timeout: 8000 }).then(() => true).catch(() => false);
    ok(page, `${label}: the Troubleshooter page is up on its direct line`);
    await p.waitForTimeout(700);
    await p.screenshot({ path: path.join(out, `${label}-direct.png`) });
  } else {
    ok(winOpen, `${label}: the Troubleshooter window opens while Wizard is hung`);
    const offered = await p.waitForFunction(() => { const d = document.querySelector('[data-recovery-direct]'); return d && !d.hidden && d.getBoundingClientRect().height > 0; }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    ok(offered, `${label}: "Open Troubleshooter directly" is offered`, { hungHits: state.hungHits });
    const href = await p.evaluate(() => document.querySelector('[data-recovery-direct-link]')?.href);
    ok(href === DIRECT, `${label}: it points at the direct line`, href);
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(out, `${label}-offer.png`) });
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), p.locator('[data-recovery-direct-link]').click().catch(() => {})]);
    const page = popup && await popup.waitForSelector('header h1', { timeout: 8000 }).then(() => true).catch(() => false);
    ok(popup && popup.url().startsWith(DIRECT) && page, `${label}: tapping it opens the Troubleshooter on its direct line`, popup?.url());
    if (popup) { await popup.waitForTimeout(500); await popup.screenshot({ path: path.join(out, `${label}-direct.png`) }); }
  }
  ok(errors.length === 0, `${label}: no browser errors`, errors);
  console.log(`${label}: ${state.writes} dropped writes, ${state.hungHits} hung requests; nothing reached a service`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  for (const skin of skins) for (const desktop of [false, true]) await run(browser, { desktop, skin, hang: false }).catch(e => ok(false, `${desktop ? 'desktop' : 'phone'}-${skin}: harness`, String(e)));
  for (const desktop of [false, true]) await run(browser, { desktop, skin: skins[0], hang: true }).catch(e => ok(false, `${desktop ? 'desktop' : 'phone'}-hung: harness`, String(e)));
  await browser.close();
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ source: root, results }, null, 2));
  console.log(`${results.filter(x => x.pass).length} passed, ${results.filter(x => !x.pass).length} failed`);
  if (results.some(x => !x.pass)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(2); });
