// QA (orb prototype, James 25 Oct 2026): hold = desk fan, short tap take = quick command, long take = agent.
// Usage: node qa-orb-fan.cjs  (QA_SHOTS=<dir> for screenshots). Every Hermes/Wizard write is refused and recorded.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const THREADS = Array.from({ length: 6 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview', last_active: NOW / 1000 - i * 600, started_at: NOW / 1000 - i * 600 - 60 }));
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const R = { cmd: { route: 'agent' } };
const routes = [];
const APPS = [['wizard-search', 'Search', '⌕'], ['notes', 'Notes', '✎'], ['wizard-calendar', 'Calendar', '◷'], ['stories', 'Stories', '✦'], ['wisdom', 'Wisdom', '❖'], ['wizard-music', 'Wizard Music', '♪'], ['topics', 'Topics', '◉']];
async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.hostname !== new URL(ORIGIN).hostname) return m === 'GET' ? r.continue() : r.abort();
    const app = APPS.find(a => u.pathname.startsWith('/' + a[0] + '/'));
    if (app) return r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>${app[1]}</title><body style="background:#123;color:#fff;font:24px system-ui;padding:40px">${app[1]} app</body>` });
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW, threads: {} } });
      if (u.pathname === '/wizard/v1/route') { routes.push(JSON.parse(q.postData() || '{}')); return json(r, { ms: 5, cmd: R.cmd }); }
      return json(r, { error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: THREADS, has_more: false });
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) return json(r, { object: 'list', data: [{ id: 1, role: 'user', content: 'hello', timestamp: NOW / 1000 - 100 }, { id: 2, role: 'assistant', content: 'hi', timestamp: NOW / 1000 - 90 }] });
    const sm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) { const t = THREADS.find(x => x.id === decodeURIComponent(sm[1])); return t ? json(r, { session: t }) : json(r, { error: 'not_found' }, 404); }
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json(r, { state: {} });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: APPS.map(([id, name, icon]) => ({ id, name, desc: name, url: `/${id}/`, icon, colors: ['#8f63ff', '#ff5ccf'], source: 'launcher.json' })) });
    return json(r, {});
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await sleep(1500);
  return { ctx, p, writes };
}
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const agentWrites = w => w.filter(x => /\/runs|\/sessions|\/upload/.test(x));
const state = p => p.evaluate(() => ({ idx: window.__wos.idx, n: window.__wos.desks.length, voice: window.__wos.voice }));
async function orbXY(p) { const r = await p.locator('#orbWrap').boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }

(async () => {
  const b = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  const { p, writes } = await boot(b);
  // Open several apps so there are desks to fan.
  for (const n of ['Notes', 'Calendar', 'Stories', 'Wisdom', 'Topics']) { await p.evaluate(n => window.__wos.handleText(n, 'command', false, 100, null), n).catch(() => {}); await sleep(700); }
  await p.evaluate(() => window.__wos.goDesk(0)); await sleep(700);
  let s = await state(p);
  console.log('desks', s.n);
  ok(s.n >= 5, 'fixture has at least five desks', JSON.stringify(s));

  // 1. Hold opens the fan (no recording), one item per desk.
  let o = await orbXY(p);
  await p.mouse.move(o.x, o.y); await p.mouse.down(); await sleep(650);
  const fan = await p.evaluate(() => ({ open: !!document.querySelector('.wdf'), items: [...document.querySelectorAll('.wdf-item')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }), voice: window.__wos.voice }));
  ok(fan.open && fan.items.length === s.n, 'hold fans out one item per desk', JSON.stringify(fan));
  ok(fan.voice === 'idle', 'hold does not start a recording');
  ok(fan.items.every(i => i.x > 0 && i.x < 412 && i.y > 0 && i.y < o.y), 'every fan item is on screen above the orb', JSON.stringify(fan.items));
  await shot(p, '1-fan-open');
  // 2. Slide onto desk 3 (index 3): it highlights, the label names it, the desk slides in behind.
  const k = Math.min(3, s.n - 1), t = fan.items[k];
  for (let i = 1; i <= 8; i++) { await p.mouse.move(o.x + (t.x - o.x) * i / 8, o.y + (t.y - o.y) * i / 8); await sleep(30); }
  await sleep(300);
  const hov = await p.evaluate(() => ({ sel: window.WosDeskFan.selected, label: document.querySelector('.wdf-label')?.textContent, tr: document.querySelector('.track')?.style.transform }));
  ok(hov.sel === k, 'sliding onto a desk selects it', JSON.stringify(hov));
  ok(/px/.test(hov.tr) && true, 'hovered desk slides in behind the fan', hov.tr);
  await shot(p, '2-fan-hover');
  await p.mouse.up(); await sleep(800);
  s = await state(p);
  ok(s.idx === k, 'release jumps to the selected desk', JSON.stringify(s));
  ok(!(await p.evaluate(() => !!document.querySelector('.wdf'))), 'fan closes after release');
  await shot(p, '3-after-jump');
  // 3. Hold, slide to desk 0, slide back onto the orb, release: cancelled, desk unchanged.
  o = await orbXY(p);
  await p.mouse.move(o.x, o.y); await p.mouse.down(); await sleep(650);
  const items2 = await p.evaluate(() => [...document.querySelectorAll('.wdf-item')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  await p.mouse.move(items2[0].x, items2[0].y, { steps: 6 }); await sleep(150);
  await p.mouse.move(o.x + 4, o.y - 4, { steps: 6 }); await sleep(150);
  await p.mouse.up(); await sleep(700);
  const s3 = await state(p);
  ok(s3.idx === k, 'release back on the orb cancels (desk unchanged)', JSON.stringify(s3));
  // 4. Outer ring: 9 desks lay out two rings, all on screen and a thumb apart.
  const L = await p.evaluate(() => window.WosDeskFan._layout(10, 206, 820, 412));
  const minGap = Math.min(...L.flatMap((a, i) => L.slice(i + 1).map(b => Math.hypot(a.x - b.x, a.y - b.y))));
  ok(L.every(q => q.x >= 20 && q.x <= 392) && minGap >= 50, '10 desks: two rings, on screen, items ≥50px apart', 'minGap=' + minGap.toFixed(1));
  // 5. Quick-take rule.
  const q = await p.evaluate(() => {
    const T = window.__wos.quickTake, v = { view: null };
    return { short: T('auto', v, null, null, 2000), long: T('auto', v, null, null, 3500), dict: T('dictation', v, null, null, 1000), reply: T('auto', v, { sid: 'x' }, null, 1000), app: T('auto', { conversation: { label: 'Notes' } }, null, null, 1000), general: T('auto', { general: true }, null, null, 1000), ms: window.__wos.QUICK_MS };
  });
  ok(q.ms === 3000 && q.short && !q.long && !q.dict && !q.reply && !q.app && !q.general, 'under 3 s is a quick command; 3 s+, dictation, composer replies, app voice and general takes are not', JSON.stringify(q));
  // 6. Quick "Calendar" opens the app on-device: no router, nothing to the agent.
  await p.evaluate(() => window.__wos.goDesk(0)); await sleep(500);
  writes.length = 0; routes.length = 0;
  await p.evaluate(() => window.__wos.handleText('Search for good art.', 'quick', false, 200, null)); await sleep(1200);
  const sh = await p.evaluate(() => window.__wos.links?.state?.() || {});
  ok(sh.open && /wizard-search/.test(sh.url || ''), 'quick "Search for good art" opens Search', JSON.stringify(sh));
  ok(agentWrites(writes).length === 0 && routes.length === 0, 'quick on-device command: nothing to the agent, no router', JSON.stringify({ writes, routes }));
  await p.evaluate(() => window.__wos.links?.close?.()); await sleep(400);
  // 7. Quick take with no command match goes to the agent as before (never lost).
  writes.length = 0; routes.length = 0; R.cmd = { route: 'agent' };
  const ob0 = await p.evaluate(() => (window.__wos.outbox?.unsent?.() || []).length);
  await p.evaluate(() => window.__wos.handleText('Is it raining', 'quick', false, 200, null)); await sleep(1500);
  const ob1 = await p.evaluate(() => (window.__wos.outbox?.unsent?.() || []).length);
  ok(routes.length === 1 && (agentWrites(writes).length > 0 || ob1 > ob0), 'quick non-command asks the router once, then goes to the agent', JSON.stringify({ routes: routes.length, writes, ob0, ob1 }));
  // 8. Router says command (quick, off-thread): it runs, nothing to the agent.
  writes.length = 0; routes.length = 0; R.cmd = { route: 'command', action: 'desk', to: 'next' };
  const before = (await state(p)).idx;
  await p.evaluate(() => window.__wos.handleText('take me one over', 'quick', false, 200, null)); await sleep(1200);
  ok(agentWrites(writes).length === 0, 'router-matched quick command sends nothing to the agent', JSON.stringify({ writes, before, after: (await state(p)).idx }));
  // 9. Inside a thread a short "ship it" still reaches that thread, no router call.
  await p.evaluate(() => window.__wos.openWizardThread('qa-0')); await sleep(1500);
  writes.length = 0; routes.length = 0;
  const ob2 = await p.evaluate(() => (window.__wos.outbox?.unsent?.() || []).length);
  await p.evaluate(() => window.__wos.handleText('Ship it', 'quick', false, 200, null)); await sleep(1500);
  const ob3 = await p.evaluate(() => (window.__wos.outbox?.unsent?.() || []).length);
  ok(routes.length === 0 && (agentWrites(writes).some(w => /runs|sessions/.test(w)) || ob3 > ob2), 'short reply in a thread goes to that thread (no router)', JSON.stringify({ routes, writes, ob2, ob3 }));
  // 10. Live label during a take: Quick command before 3 s, agent after.
  await p.evaluate(() => window.__wos.goDesk(0)); await sleep(500);
  o = await orbXY(p); await p.mouse.click(o.x, o.y); await sleep(900);
  const l1 = await p.evaluate(() => ({ t: document.querySelector('#voiceDestination')?.textContent, hidden: document.querySelector('#voiceDestination')?.hidden, v: window.__wos.voice }));
  await shot(p, '4-quick-window');
  await sleep(2800);
  const l2 = await p.evaluate(() => document.querySelector('#voiceDestination')?.textContent);
  await shot(p, '5-agent-window');
  ok(/Quick command/.test(l1.t || '') && /Merlin/.test(l2 || '') && !/Quick/.test(l2 || ''), 'label flips from Quick command to the agent at 3 s', JSON.stringify({ l1, l2 }));
  await p.evaluate(() => window.__wos.cancelVoice(true)); await sleep(300);
  ok(p.errs.length === 0, 'zero page errors', p.errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
