// Scratch QA for wizard-ux issue 1236: in-shell phone Chats on two skins with a fresh Look, plus off and desktop checks.
const fs = require('fs'), path = require('path');
const root = process.env.QA_SOURCE, out = process.env.QA_OUT; fs.mkdirSync(out, { recursive: true });
const { chromium } = require(process.env.QA_PLAYWRIGHT);
const model = 'anthropic/claude-sonnet-4-6', provider = 'openrouter', now = Math.floor(Date.now() / 1000);
const sessions = [
  { id: 's1', source: 'wizard-mobile', title: 'Plan the week', status: 'completed', model, provider, last_active: now - 60, started_at: now - 3600, message_count: 4, preview: 'Here is a plan for Monday to Friday.' },
  { id: 's2', source: 'wizard-mobile', title: 'Garden watering timer', status: 'completed', model, provider, last_active: now - 7200, started_at: now - 9000, message_count: 6, preview: 'Set it for 6am.' },
  { id: 's3', source: 'wizard-mobile', title: 'Book flights to Lisbon', status: 'completed', model, provider, last_active: now - 90000, started_at: now - 99000, message_count: 2, preview: 'Two options found.' },
  { id: 's4', source: 'wizard-mobile', title: 'Recipe ideas', status: 'completed', model, provider, last_active: now - 200000, started_at: now - 210000, message_count: 3, preview: 'A risotto.' },
];
const results = []; const ok = (v, n, d) => { results.push({ n, pass: !!v, d }); console.log(`${v ? 'PASS' : 'FAIL'} ${n}`, v ? '' : JSON.stringify(d)); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  async function boot({ desktop = false, skin, saved = null }) {
    const ctx = await browser.newContext({ viewport: desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 }, isMobile: !desktop, hasTouch: !desktop, serviceWorkers: 'block' });
    await ctx.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
      if (q.method() === 'GET' && p.startsWith('/wizard-os-home/')) { let f = p.slice('/wizard-os-home/'.length) || 'index.html'; f = path.join(root, 'web', f); if (fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.json') ? 'application/json' : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream' }); }
      if (p.endsWith('/bootstrap')) return json({ bootstrap: 1, display: { agent_name: 'Wizard', owner_name: 'Tester' }, endpoints: {}, capabilities: {} });
      if (p === '/wizard/v1/setup') return json({ first_run: false });
      if (p.includes('wizard-look/look.json')) return json({ error: 'file_not_found' }, 404);
      if (p.includes('/api/sessions/') && q.method() === 'GET') { const id = decodeURIComponent(p.split('/api/sessions/')[1].split('/')[0]); const s = sessions.find(x => x.id === id) || sessions[0]; return json(p.endsWith('/messages') ? { data: [], has_more: false } : { session: s, messages: [] }); }
      if (p.endsWith('/api/sessions')) return json({ sessions, has_more: false });
      if (p.endsWith('/api/jobs')) return json({ jobs: [] });
      if (p.endsWith('/v1/runs')) return json({ runs: [] });
      if (p.endsWith('/api/model/options')) return json({ model, provider, providers: [{ slug: provider, name: 'QA', authenticated: true, is_current: true, models: [model] }] });
      if (p.endsWith('/agents')) return json({ agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running', model: { model, provider } }] });
      if (p.includes('/thread-seen')) return json({ seen: {} });
      if (q.method() !== 'GET') return json({ accepted: true });
      return json({});
    });
    await ctx.addInitScript(({ skin, saved }) => {
      for (const [k, v] of [['wos.coached', 'true'], ['wos.voiceTipSeen', 'true'], ['wos.tour.v1', 'true'], ['wos.welcome.v1', 'done'], ['wos.skin', skin], ['wos.channel.v1', 'latest']]) localStorage.setItem(k, v);
      if (saved && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify(saved)); }
    }, { skin, saved });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://localhost:9481/wizard-os-home/' + (desktop ? 'desktop.html' : ''));
    await page.waitForFunction(() => !!(window.__wos || window.__wux)?.chats, null, { timeout: 20000 });
    await page.waitForFunction(() => window.WosExperience && !window.WosExperience.state.busy && window.WosExperience.state.tweaks.length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    return { ctx, page, errors };
  }
  const tweaks = page => page.evaluate(() => (document.documentElement.dataset.tweaks || '').split(' '));
  for (const skin of ['nebula', 'grove']) {
    const { ctx, page, errors } = await boot({ skin });
    await page.evaluate(() => __wos.openApp(WizCore.apps('mobile').APPS.find(a => a.id === 'wizard'))).catch(e => console.log('open', e.message));
    await page.waitForTimeout(1200);
    const t = await tweaks(page);
    ok(t.includes('wizard/desktop-chats'), `${skin}: fresh install wears wizard/desktop-chats on phone`, t);
    const tt = await page.evaluate(() => getComputedStyle(document.querySelector('.ch-sec-h')).textTransform);
    ok(tt === 'none', `${skin}: desktop-style section headers (sentence case)`, tt);
    ok(!errors.length, `${skin}: no page errors`, errors);
    await page.screenshot({ path: path.join(out, `phone-${skin}-default.png`) });
    await ctx.close();
  }
  // Explicit off stays off.
  { const { ctx, page } = await boot({ skin: 'nebula', saved: { version: 1, off: {}, preset: 'none', mix: {}, defaultsOff: ['wizard/desktop-chats'], defaultsMigrated: true, machinesHomeMoved: true, miguelLayoutMoved: true } });
    await page.evaluate(() => __wos.openApp(WizCore.apps('mobile').APPS.find(a => a.id === 'wizard'))).catch(e => console.log('open', e.message)); await page.waitForTimeout(1000);
    const t = await tweaks(page); ok(!t.includes('wizard/desktop-chats'), 'explicit off: old phone list', t);
    const tt = await page.evaluate(() => getComputedStyle(document.querySelector('.ch-sec-h')).textTransform);
    ok(tt === 'uppercase', 'explicit off: stock section headers', tt);
    await page.screenshot({ path: path.join(out, 'phone-nebula-switched-off.png') }); await ctx.close(); }
  // Desktop unchanged: the tweak may be in data-tweaks, but no header and no phone rules apply.
  { const { ctx, page, errors } = await boot({ skin: 'nebula', desktop: true });
    ok(!(await page.evaluate(() => !!document.querySelector('.dc-head'))), 'desktop: no phone header', {});
    ok(await page.evaluate(() => document.documentElement.dataset.shell === 'desktop'), 'desktop: shell is desktop', {});
    ok(!errors.length, 'desktop: no page errors', errors);
    await page.screenshot({ path: path.join(out, 'desktop-nebula.png') }); await ctx.close(); }
  await browser.close();
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
  process.exit(results.every(r => r.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
