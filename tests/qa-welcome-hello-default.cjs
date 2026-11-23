// Browser QA for wizard-ux#1729: Welcome › Say hello, Send with an empty box sends the shown default text.
// Real Chromium, the real phone shell (web/index.html) at phone size (412 px), on a fake brand-new Wizard: an AI is
// signed in and the Agent Service says first_run, so the Welcome opens; it is walked to Say hello. Each case taps
// the real Send button and reads the first message the shell saved in its outbox (WosOutbox.enqueue, the step that
// hands it to the agent):
//   1. empty box  -> "Hi! What can you help me with?" goes out, the Welcome closes
//   2. "Hello"    -> "Hello" goes out, not the default
//   3. only spaces-> the default goes out
//   4. a failed send puts the words that went back into the box as real text
// and the placeholder reads clearly (contrast >= 3:1 against the box) in Nebula and Light.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-welcome-hello-default.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the empty and spaces cases must fail there.
//   QA_SHOTS=<dir>: Say hello before and after Send, in Nebula and Light.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const BROKEN = process.env.QA_EXPECT === 'broken';
const DEFAULT = 'Hi! What can you help me with?';
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const sessions = {}, delivered = [];
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => {
    if (p === '/' ) { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end(); }
    if (p.startsWith('/wizard-os-home/')) {
      let f = path.join(WEB, decodeURIComponent(p.slice('/wizard-os-home/'.length)) || 'index.html');
      if (f.endsWith('/')) f += 'index.html';
      if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    if (p === '/wizard/hermes/api/model/options') return json(res, 200, { provider: 'anthropic', model: 'claude-sonnet-4-5', providers: [{ slug: 'anthropic', name: 'Anthropic', authenticated: true, auth_type: 'api_key', models: ['claude-sonnet-4-5'] }] });
    if (p === '/wizard/v1/setup') return json(res, 200, { first_run: true, items: [] });
    if (p === '/wizard/v1/setup/seen') return json(res, 200, { ok: true });
    // Enough of a box for the outbox to deliver the first message and the thread to open with a reply.
    if (p === '/troubleshoot/api/ping') return json(res, 200, { ok: true });
    if (p === '/troubleshoot/api/status') return json(res, 200, { checks: [] });
    if (p === '/wizard/hermes/api/sessions' && req.method === 'POST') { try { const j = JSON.parse(body); sessions[j.id] = sessions[j.id] || []; } catch (e) {} return json(res, 200, { ok: true }); }
    if (p === '/wizard/hermes/v1/runs' && req.method === 'POST') {
      let j = {}; try { j = JSON.parse(body); } catch (e) {}
      const words = typeof j.input === 'string' ? j.input : JSON.stringify(j.input);
      delivered.push(words);
      const now = Date.now() / 1000;
      sessions[j.session_id] = [{ id: 'm1', role: 'user', content: words, timestamp: now }, { id: 'm2', role: 'assistant', content: 'Hi! I can help with your mail, calendar, notes and more. What would you like to start with?', timestamp: now + 1 }];
      return json(res, 200, { run_id: 'r-' + delivered.length, status: 'completed' });
    }
    const m = p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (m) return json(res, 200, { data: sessions[decodeURIComponent(m[1])] || [] });
    if (p === '/wizard/hermes/api/sessions') return json(res, 200, { data: Object.keys(sessions).map(id => ({ id, title: 'First chat', message_count: sessions[id].length, last_active: Date.now() / 1000, source: 'wizard-mobile' })) });
    if (process.env.QA_DEBUG) console.log('404', req.method, p);
    json(res, 404, { error: 'not here' });
  });
});

// WCAG relative luminance contrast of two CSS colours (rgb/rgba strings, alpha composited on the second).
function contrast(fg, bg) {
  const parse = s => (s.match(/[\d.]+/g) || []).map(Number);
  const [br, bgG, bb] = parse(bg); const f = parse(fg); const a = f.length > 3 ? f[3] : 1;
  const mix = [f[0] * a + br * (1 - a), f[1] * a + bgG * (1 - a), f[2] * a + bb * (1 - a)];
  const lum = c => { const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const l1 = lum(mix), l2 = lum([br, bgG, bb]);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const fails = [], notes = [];
  async function helloPage(skin, failSave = false) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    // Record every message the shell saves for delivery; failSave: the save fails, like a full phone storage.
    await ctx.addInitScript(fail => {
      if (window !== window.top) return;
      window.__qaSent = [];
      let box;
      Object.defineProperty(window, 'WosOutbox', { configurable: true, get: () => box, set: v => {
        box = v; const real = v && v.enqueue;
        if (real) v.enqueue = async item => { window.__qaSent.push(item && item.text); if (fail) throw new Error('qa: save failed'); return real.call(v, item); };
      } });
    }, failSave);
    await ctx.addInitScript(s => { if (window !== window.top) return; try { localStorage.setItem('wos.skin', s); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {} }, skin);
    const page = await ctx.newPage();
    page.on('pageerror', e => notes.push(`${skin} pageerror: ${e.message}`));
    await page.goto(base + '/wizard-os-home/');
    await page.waitForFunction(() => window.WosWelcome?.active, null, { timeout: 20000 });
    // Walk Look (and Bring your AI if shown) with the real Continue buttons up to Say hello.
    for (let i = 0; i < 4; i++) {
      const t = await page.locator('.wl-card h2').textContent();
      if (t.trim() === 'Say hello') break;
      await page.locator('.wl-card [data-wl="next"]').first().click();
    }
    await page.waitForSelector('.wl-hello textarea');
    return { ctx, page };
  }
  async function trySend(skin, typed, label) {
    const { ctx, page } = await helloPage(skin);
    const wire = delivered.length;
    if (typed != null) await page.locator('.wl-hello textarea').fill(typed);
    if (SHOTS && label === 'empty') await page.screenshot({ path: path.join(SHOTS, `${skin}-before.png`) });
    await page.locator('.wl-hello button[type=submit]').click();
    await page.waitForFunction(() => !window.WosWelcome?.active, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const out = await page.evaluate(() => window.__qaSent.slice());
    const open = await page.evaluate(() => !!window.WosWelcome?.active);
    // The box received it (the agent's run), and the thread opened with it and the reply.
    for (let i = 0; i < 60 && delivered.length === wire && !open; i++) await page.waitForTimeout(250);
    const went = delivered.slice(wire);
    if (process.env.QA_DEBUG) console.log('outbox', JSON.stringify(await page.evaluate(() => [...(window.WosOutbox?._items?.values?.() || [])].map(i => ({ state: i.state, error: i.error, text: i.text })))));
    const thread = !open && went.length ? await page.waitForFunction(() => /I can help with your mail/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true, () => false) : false;
    if (SHOTS && label === 'empty') await page.screenshot({ path: path.join(SHOTS, `${skin}-after.png`) });
    await ctx.close();
    return { out, open, went, thread };
  }
  try {
    // 1. empty box
    let r = await trySend('nebula', null, 'empty');
    if (!(r.out.length === 1 && r.out[0] === DEFAULT && !r.open)) fails.push(`empty box: sent ${JSON.stringify(r.out)}, welcome open ${r.open}`);
    else if (!(r.went.length === 1 && r.went[0] === DEFAULT && r.thread)) fails.push(`empty box: the box received ${JSON.stringify(r.went)}, thread with reply shown ${r.thread}`);
    else notes.push(`empty box: sent "${r.out[0]}", Welcome closed, the box received it and the thread opened with the reply`);
    // 2. typed
    r = await trySend('nebula', 'Hello', 'typed');
    if (!(r.out.length === 1 && r.out[0] === 'Hello' && !r.open && r.went[0] === 'Hello')) fails.push(`typed: sent ${JSON.stringify(r.out)}, box received ${JSON.stringify(r.went)}, welcome open ${r.open}`);
    else notes.push('typed "Hello": sent "Hello"');
    // 3. only spaces
    r = await trySend('nebula', '    ', 'spaces');
    if (!(r.out.length === 1 && r.out[0] === DEFAULT && !r.open && r.went[0] === DEFAULT)) fails.push(`spaces: sent ${JSON.stringify(r.out)}, box received ${JSON.stringify(r.went)}, welcome open ${r.open}`);
    else notes.push('only spaces: sent the default');
    // Light skin, empty box too (and its shots)
    r = await trySend('obsidian-light', null, 'empty');
    if (!(r.out.length === 1 && r.out[0] === DEFAULT && !r.open && r.went[0] === DEFAULT && r.thread)) fails.push(`light empty box: sent ${JSON.stringify(r.out)}, box received ${JSON.stringify(r.went)}, thread ${r.thread}, welcome open ${r.open}`);
    // 4. failed send keeps the words as real text
    {
      const { ctx, page } = await helloPage('nebula', true);
      await page.locator('.wl-hello button[type=submit]').click();
      await page.waitForSelector('.wl-status.err', { timeout: 8000 }).catch(() => {});
      const v = await page.locator('.wl-hello textarea').inputValue().catch(() => '');
      const open = await page.evaluate(() => !!window.WosWelcome?.active);
      if (!(open && v === DEFAULT)) fails.push(`failed send: box holds ${JSON.stringify(v)}, welcome open ${open}`);
      else notes.push('failed send: the default is back in the box as real text');
      await ctx.close();
    }
    // Placeholder legible in both skins.
    for (const skin of ['nebula', 'obsidian-light']) {
      const { ctx, page } = await helloPage(skin);
      const c = await page.evaluate(() => {
        const t = document.querySelector('.wl-hello textarea');
        const ph = getComputedStyle(t, '::placeholder');
        let n = t, bg = 'rgba(0, 0, 0, 0)';
        while (n && n.nodeType === 1) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(.*, 0\)$/.test(b) && b !== 'transparent') { bg = b; break; } n = n.parentElement; }
        return { color: ph.color, opacity: ph.opacity, bg, placeholder: t.getAttribute('placeholder') };
      });
      const fg = c.color.replace(/rgba?\(([^)]*)\)/, (m, inner) => { const p = inner.split(',').map(s => s.trim()); const a = (p[3] != null ? +p[3] : 1) * +(c.opacity || 1); return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${a})`; });
      const ratio = contrast(fg, c.bg);
      notes.push(`${skin} placeholder ${fg} on ${c.bg}: ${ratio.toFixed(2)}:1`);
      if (c.placeholder !== DEFAULT) fails.push(`${skin}: placeholder reads ${JSON.stringify(c.placeholder)}`);
      if (ratio < 3) fails.push(`${skin}: placeholder contrast ${ratio.toFixed(2)}:1 is under 3:1`);
      await ctx.close();
    }
  } finally {
    await browser.close(); server.close();
  }
  for (const n of notes) console.log('  ' + n);
  if (BROKEN) {
    if (!fails.some(f => f.startsWith('empty box'))) { console.error('expected the empty-box case to fail on this build'); process.exit(1); }
    console.log('broken as expected:\n  ' + fails.join('\n  ')); return;
  }
  if (fails.length) { console.error('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('PASS: Say hello sends the shown default on an empty Send');
})().catch(e => { console.error(e); process.exit(1); });
