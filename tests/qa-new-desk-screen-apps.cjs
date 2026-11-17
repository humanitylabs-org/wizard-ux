// ux#1505: apps with their own screen are Apps, never Agent apps. The main agent's chats (Hermes Main Agent) and an app
// that declares a screen but has no page yet (Money) show in the phone New desk's Apps group, not under the folded
// "For agents"; Money is in the desktop AI apps picker's Apps; a screenless app (Transcriber) stays an Agent app.
// Synthetic shell, never a live API. QA_WEB=<main worktree>/web QA_EXPECT=broken shows main hiding them.
// QA_OUT=<dir> saves screenshots.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead, seedOwner } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(process.env.QA_WEB || path.join(__dirname, '..', 'web')), out = process.env.QA_OUT || '';
const broken = process.env.QA_EXPECT === 'broken';
const ORIGIN = 'http://new-desk-screen-apps.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const AGENTS = { agents: [{ id: 'hermes', label: 'Hermes', harness: 'hermes', is_default: true, privacy: 'standard', appearance: {} }] };
// What the box's app list holds when Money's route is not published yet: no url, but it declares a screen.
const BACKEND = [
  { id: 'money', name: 'Money', desc: 'Review transactions.', source: 'apps.json', type: 'view', category: 'app' },
  { id: 'transcriber', name: 'Transcriber', desc: 'Local speech-to-text.', source: 'apps.json', type: 'service', category: 'system' },
];
async function transport(ctx) {
  await ctx.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== ORIGIN) return r.abort();
    const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET') return json({});
    if (/\/v1\/setup$/.test(u.pathname)) return json({ first_run: false });
    if (u.pathname === '/wizard/v1/agents') return json(AGENTS);
    if (u.pathname.includes('/store-data/')) return json({ results: [], installed: [], wam: [], shell: [], complete: true });
    const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html', f = path.resolve(web, rel);
    if (f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    return json(ownerRead(u.pathname));
  });
}
const shot = async (p, name) => { if (out) await p.screenshot({ path: path.join(out, name + '.png') }); };
(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ headless: true }), seen = [];
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      const ctx = await b.newContext(shell === 'phone' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' } : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await transport(ctx); await ctx.addInitScript(seedOwner, { phone: true });
      await ctx.addInitScript(([shell, skin, back]) => { if (window !== top) return; localStorage.setItem('wux.shell', shell); localStorage.setItem('wos.shell', shell); localStorage.setItem('wos.skin', skin); localStorage.setItem('wux.apps.backend.v1', JSON.stringify(back)); }, [shell, skin, BACKEND]);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
      await p.goto(`${ORIGIN}/wizard-os-home/${shell === 'desktop' ? 'desktop.html' : 'index.html?phone'}`);
      await p.waitForFunction(sh => document.documentElement.dataset.shell === sh && window.WosAppKinds, shell, { timeout: 20000 });
      await p.addStyleTag({ content: '#wosWelcome{display:none!important}' });
      await p.waitForTimeout(1200);
      if (shell === 'phone') {
        // New desk: the overview's + (an empty desk shows the kinds grid).
        await p.evaluate(() => { window.__wos.openOverview(); }); await p.waitForTimeout(300);
        await p.evaluate(() => document.querySelector('[data-ovadd]')?.click()); await p.waitForTimeout(800);
        const s = await p.evaluate(() => {
          const nd = [...document.querySelectorAll('.new-desk')].find(n => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.left < innerWidth; });
          if (!nd) return null;
          // The main agent's tile is data-app="wizard" (named after the agent, e.g. Hermes Main Agent); backend tiles
          // carry data-appinfo.
          const names = sel => [...nd.querySelectorAll(sel)].map(t => t.dataset.app || t.dataset.appinfo).filter(Boolean);
          return { apps: names('.kg-apps .lapp'), forAgents: names('.forag .lapp'), agentsOpen: nd.querySelector('.forag')?.classList.contains('open') };
        });
        seen.push([shell, skin, s]); await shot(p, `phone-${skin}-new-desk`);
        assert.ok(s, 'New desk painted');
        if (!broken) {
          assert.ok(s.apps.includes('wizard'), `phone ${skin}: the main agent's chats in Apps ${JSON.stringify(s)}`);
          assert.ok(s.apps.includes('money'), `phone ${skin}: Money in Apps`);
          assert.ok(!s.forAgents.includes('wizard') && !s.forAgents.includes('money'), `phone ${skin}: neither under For agents`);
          assert.ok(s.forAgents.includes('transcriber'), `phone ${skin}: a screenless app stays an Agent app`);
          // Tapping Hermes Main Agent opens the main chats on this desk.
          await p.evaluate(() => [...document.querySelectorAll('.new-desk .kg-apps .lapp[data-app="wizard"]')].find(t => t.offsetParent !== null).click());
          await p.waitForTimeout(900); await shot(p, `phone-${skin}-hermes-opened`);
          assert.ok(await p.evaluate(() => [...document.querySelectorAll('.win, .desk')].some(w => w.offsetParent !== null && w.querySelector('.ch-list, .ch-thread, [data-chview]'))), `phone ${skin}: main chats opened`);
        } else assert.ok(!s.apps.includes('wizard') && !s.apps.includes('money'), 'main hides both under For agents');
      } else {
        await p.click('.aad-vall');
        await p.waitForSelector('.vc-pick .vc-app', { timeout: 8000 });
        await p.waitForTimeout(300);
        const s = await p.evaluate(() => ({
          apps: [...document.querySelectorAll('.vc-pick .vc-list[data-kind="apps"] .vc-app, .vc-pick .vc-list[aria-label="For people"] .vc-app')].map(b => b.getAttribute('data-app')),
          wiz: [...document.querySelectorAll('.vc-pick .vc-list[data-kind="wiz"] .vc-app')].map(b => b.getAttribute('data-app')),
        }));
        seen.push([shell, skin, s]); await shot(p, `desktop-${skin}-app-picker`);
        if (!broken) {
          assert.ok(s.apps.includes('money'), `desktop ${skin}: Money in the picker's apps ${JSON.stringify(s)}`);
          assert.ok(!s.wiz.includes('money'), `desktop ${skin}: Money not an Agent app`);
          // Money has no page yet: its tile opens its settings sheet instead of doing nothing.
          await p.click('.vc-pick .vc-app[data-app="money"]'); await p.waitForTimeout(900); await shot(p, `desktop-${skin}-money-tap`);
          assert.ok(await p.evaluate(() => [...document.querySelectorAll('.ar-head b')].some(b => b.offsetParent !== null && b.textContent.trim() === 'Money')), `desktop ${skin}: Money tile opened its sheet`);
        } else assert.ok(!s.apps.includes('money'));
      }
      assert.deepEqual(errs, [], `${shell} ${skin}: no page errors`);
      await ctx.close();
    }
    console.log(JSON.stringify(seen));
    console.log(broken ? 'QA_EXPECT=broken: main hides them as expected' : 'ok: apps with a screen are Apps, in two skins, phone and desktop');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
