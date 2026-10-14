// QA (screen context): when James speaks or types, the [Wizard OS context] note carries the words visible in the
// window in front (read at send time), so the agent can resolve "this", "here", "that step" without a screenshot.
// Covers a native-web window (Usuals), a same-origin framed app (visible text in, off-screen / hidden / password out),
// the review-page note, the size bound, and that a chat thread's own text is not repeated.
// Usage: node qa-screen-context.cjs   (Hermes/Wizard writes are refused and recorded)
const QA_ORIGIN = (process.env.WIZARD_QA_ORIGIN || 'https://wizard.example.ts.net').replace(/\/+$/, ''); // the Wizard under test (env; see docs/qa-targets.md)
const QA_HOST = new URL(QA_ORIGIN).hostname;
const { chromium } = require('/home/telos/node_modules/playwright');
const fs = require('fs'), path = require('path');
const ORIGIN = QA_ORIGIN, URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; SM-S928B Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 WizardOS-Android/0.9.0';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const THREADS = Array.from({ length: 3 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview', last_active: NOW / 1000 - i * 600, started_at: NOW / 1000 - i * 600 - 60 }));
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };
const FRAME = `<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0;font:16px sans-serif;background:#111;color:#eee">
<h1>Cart review</h1><p>Green curry bowl</p><label>Note <input aria-label="Note" value="no peanuts"></label>
<input type="password" aria-label="PIN" value="SECRET-PIN-4821"><div style="display:none">HIDDEN-DISPLAY-NONE</div>
<div aria-hidden="true">HIDDEN-ARIA</div><div style="height:3000px"></div><p>OFFSCREEN-FOOTER</p></body>`;

async function boot(b, ua) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, acceptDownloads: true, ...(ua ? { userAgent: ua } : {}) });
  const writes = [];
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.hostname !== QA_HOST) return m === 'GET' ? r.continue() : r.abort();
    if (u.pathname.startsWith('/qa-frame/')) return r.fulfill({ status: 200, contentType: 'text/html', body: FRAME });
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW, threads: {} } });
      if (u.pathname === '/wizard/v1/route') return json(r, { ms: 5, cmd: { route: 'agent' } });
      return json(r, { error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: THREADS, has_more: false });
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) return json(r, { object: 'list', data: [{ id: 1, role: 'user', content: 'hello', timestamp: NOW / 1000 - 100 }, { id: 2, role: 'assistant', content: 'hi', timestamp: NOW / 1000 - 90 }] });
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json(r, { state: {} });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: [{ id: 'wizard-search', name: 'Search', desc: 'Image search and AI overview', url: '/wizard-search/', icon: '⌕', colors: ['#8f63ff', '#ff5ccf'], source: 'launcher.json' }] });
    return json(r, {});
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {}
    // Record every programmatic download click (what the Android WebView hands to its DownloadListener).
    // A stand-in for the Android bridge's Usuals: one saved usual with a single learned step.
    window.WizardOSNative = Object.assign(window.WizardOSNative || {}, {
      usuals: () => JSON.stringify({ blocker: '', state: { mode: 'idle' }, list: [{ id: 'u1', name: 'Kra pao', basket: '1x Kra pao moo', place: 'Som Tam Nua', lastTotal: '฿120', script: 'tap Priority', steps: [{ kind: 'tap', text: 'Priority' }] }] }),
    });
    // Every toast the shell shows.
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(() => { document.querySelectorAll('#toast').forEach(t => { const s = (t.textContent || '').trim(); if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s); }); })
      .observe(document.documentElement, { subtree: true, childList: true, characterData: true }));
  });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.goto(ORIGIN + '/qa-start').catch(() => {});
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  
  await sleep(1200);
  return { ctx, p, writes };
}

const ctxOf = p => p.evaluate(() => window.__wos.viewContext());
(async () => {
  const b = await chromium.launch();
  const { ctx, p, writes } = await boot(b, ANDROID_UA);

  // 1. Usuals (native-web window): the list's words ride in the note.
  await p.evaluate(() => window.__wos.openApp({ id: 'usuals', name: 'Usuals', kind: 'usuals' })); await sleep(1200);
  let c = await ctxOf(p);
  ok(/Window in front: Usuals/.test(c), 'Usuals: note names the window', c);
  ok(/Visible on screen: .*Kra pao/.test(c) && /Order something new/.test(c), 'Usuals: visible list text is in the note', c);
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'usuals.png') });
  // The edit sheet: its steps are what James was asking about.
  const more = await p.$('[data-us="edit"]');
  if (more) { await more.click(); await sleep(700); c = await ctxOf(p); ok(/Edit usual/.test(c) && /Name · Kra pao/.test(c) && /tap Priority/.test(c), 'Usuals edit: the sheet, its name and the step James sees ("tap Priority") are in the note', c); if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'usuals-edit.png') }); }
  else ok(false, 'Usuals edit: ⋯ button present');
  await p.evaluate(() => window.__wos.onBack && window.__wos.onBack()); await sleep(400);

  // 2. A same-origin framed app: visible text in; hidden, off-screen and password out.
  await p.evaluate(() => window.__wos.openWin({ app: 'frame', url: '/qa-frame/', title: 'QA Cart' })); await sleep(1800);
  c = await ctxOf(p);
  console.log('  sample:', c.slice(0, 400));
  ok(/Window in front: QA Cart/.test(c), 'Frame: note names the app', c);
  ok(/Cart review/.test(c) && /Green curry bowl/.test(c) && /no peanuts/.test(c), 'Frame: visible text and field value are in the note', c);
  ok(!/SECRET-PIN-4821/.test(c), 'Frame: password field value is never read', c);
  ok(!/HIDDEN-DISPLAY-NONE|HIDDEN-ARIA/.test(c), 'Frame: hidden text is left out', c);
  ok(!/OFFSCREEN-FOOTER/.test(c), 'Frame: off-screen text is left out', c);
  // Scrolled: what is now on screen is what is read.
  await p.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find(x => /qa-frame/.test(x.src)); f.contentWindow.scrollTo(0, 99999); }); await sleep(300);
  c = await ctxOf(p);
  ok(/OFFSCREEN-FOOTER/.test(c) && !/Cart review/.test(c), 'Frame: after scrolling, the note follows what is on screen', c);

  // 3. Bound: a huge page stays a small note (server caps the whole note at 2400; shell keeps screen text ≤ 1400).
  const big = await p.evaluate(() => { const d = document.createElement('div'); d.className = 'win'; d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;color:#fff;overflow:hidden'; d.innerHTML = Array.from({ length: 400 }, (_, i) => `<p>Line ${i} lorem ipsum dolor sit amet</p>`).join(''); document.body.appendChild(d); const s = window.WizScreen.read(d); d.remove(); return s; });
  ok(big.length > 200 && big.length <= 1400, 'Bound: screen text capped at 1400 chars', String(big.length));

  // 4. A chat thread: its own text is the conversation, so the note does not repeat it.
  await p.evaluate(() => window.__wos.openWizardThread('qa-0')); await sleep(1800);
  const v = await p.evaluate(() => { const w = window.__wos; const f = w.desks[w.idx].focus; return w.viewOf(f); });
  c = await ctxOf(p);
  if (v && v.kind === 'chat thread') ok(!/Visible on screen/.test(c), 'Chat thread: thread text is not repeated in the note', c);
  else ok(false, 'Chat thread: a thread is in front', v);

  ok(!p.errs.length, 'No page errors', p.errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
