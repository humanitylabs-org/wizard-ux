/* Compact Chats-list send pill: real outbox + phone shell, fixture reads, no agent writes.
 * QA_WEB_DIR=<repo> QA_OUT=<evidence> PLAYWRIGHT_MODULE=<module> node qa-compact-send-pill.cjs [qa-origin]
 * qa-ab.sh supplies the two qa-origins; without one, serve the source under an intercepted localhost origin. */
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.env.QA_WEB_DIR || __dirname, out = process.env.QA_OUT || 'qa-live/compact-send-pill';
const origin = process.argv[2] || 'http://localhost:9481/wizard-os-home/';
const sid = 'compact-fixture', model = 'qa', provider = 'qa';
const sessions = Array.from({ length: 24 }, (_, i) => ({ id: i ? 'compact-' + i : sid, title: i ? 'Sample conversation ' + i : 'Design review', source: 'wizard-mobile', model, provider, message_count: 2, last_active: Date.now() / 1000 - i * 600, preview: 'A sample conversation for layout review' }));
const results = [], measurements = [];
const ok = (v, name, detail) => { results.push({ pass: !!v, name, detail }); console.log(v ? 'PASS' : 'FAIL', name, v ? '' : JSON.stringify(detail)); };
fs.mkdirSync(out, { recursive: true });
(async () => {
 const browser = await chromium.launch();
 for (const desktop of [false, true]) {
  const label = desktop ? 'desktop' : 'phone';
  const ctx = await browser.newContext({ viewport: desktop ? { width: 1440, height: 960 } : { width: 412, height: 892 }, isMobile: !desktop, hasTouch: !desktop, userAgent: desktop ? undefined : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', serviceWorkers: 'block' });
  const errors = []; let writes = 0;
  await ctx.route('**/*', async r => {
   const q = r.request(), u = new URL(q.url()), p = u.pathname;
   const json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
   if (q.method() === 'GET' && p.startsWith('/wizard-os-home/')) {
    if (process.argv[2]) return r.continue();
    const f = path.join(root, 'web', p.slice('/wizard-os-home/'.length) || 'index.html');
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : 'image/svg+xml' });
    return r.fulfill({ status: 404, body: '' });
   }
   if (q.method() !== 'GET') { writes++; return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"QA refuses writes"}' }); }
   if (p.endsWith('/bootstrap')) return json({ bootstrap: 1, display: { agent_name: 'Wizard', owner_name: 'Tester' }, capabilities: { voice: true, router: true, files: true } });
   if (p.endsWith('/api/sessions')) return json({ sessions });
   if (p.endsWith('/v1/runs')) return json({ runs: [] });
   if (p.endsWith('/api/jobs')) return json({ jobs: [] });
   if (p.endsWith('/agents')) return json({ agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running' }] });
   return json({});
  });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.goto(new URL(desktop ? 'desktop.html' : 'index.html', origin).href);
  await p.waitForFunction(() => (window.__wos || window.__wux)?.chats && window.WosOutbox?.recoveryComplete && WizLive.ok);
  const { wid, id } = await p.evaluate(async ({ sid, model, provider }) => {
   const A = window.__wos || window.__wux, w = A.openWin ? A.openWin({ app: 'chats' }) : null;
   const wid = w?.id || Object.keys(A.wins).find(k => A.wins[k].app === 'chats');
   A.chats.openChat(wid, null); A.focusWin?.(wid);
   const it = await WosOutbox.stage({ kind: 'reply', sessionId: sid, model, provider, audio: new Blob(['retained recording'], { type: 'audio/webm' }), text: 'Unsent fixture' });
   await WosOutbox.transition(it.id, 'failed', 'Not sent'); return { wid, id: it.id };
  }, { sid, model, provider });
  const scope = `[data-chats="${wid}${desktop ? '::list' : ''}"]`;
  await p.locator(scope + ' .ch-pill .pbtn').waitFor();
  for (const skin of ['nebula', 'grove', 'obsidian']) {
   // Use the actual visible Settings skin controls, preserving the live outbox and document.
   await p.evaluate(() => (window.__wos || window.__wux).openSettings());
   await p.locator(`[data-skinpick="${skin}"]:visible`).click();
   if (desktop) await p.evaluate(() => __wux.closeSettings());
   else await p.locator('[data-stclose]:visible').click();
   await p.waitForTimeout(500);
   const m = await p.locator(scope + ' .ch-pill').evaluate(el => {
    const b = el.querySelector('.pbtn'), r = b.getBoundingClientRect(), pr = el.getBoundingClientRect(), fab = el.parentElement.querySelector('.ch-fab').getBoundingClientRect();
    const hit = (x, y) => b === document.elementFromPoint(x, y), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const st = getComputedStyle(b);
    return { text: el.textContent, pill: pr.toJSON(), button: r.toJSON(), fab: fab.toJSON(), skin: document.documentElement.dataset.skin, pillBackground: getComputedStyle(el).backgroundColor, buttonBackground: st.backgroundColor, buttonColor: st.color, radius: st.borderRadius, overflow: getComputedStyle(el).overflow, above8: hit(x, r.top - 8), below8: hit(x, r.bottom + 8), target44: [[x,y-21.9],[x,y+21.9],[x-21.9,y],[x+21.9,y]].every(([a,b]) => hit(a,b)), gap: fab.left - pr.right };
   });
   measurements.push({ label, skin, ...m });
   ok(m.skin === skin && /Not sent · Design review/.test(m.text), `${label}/${skin}: actual failed reply and chosen skin`, m);
   ok(Math.abs(m.pill.height - 34) < .5 && Math.abs(m.button.height - 26) < .5, `${label}/${skin}: 34px pill / 26px button`, m);
   ok(m.above8 && m.below8 && m.target44, `${label}/${skin}: invisible >=44px hit area above and below visible button`, m);
   ok(m.gap >= 6, `${label}/${skin}: no FAB overlap, including horizontal hit extension`, m.gap);
   await p.screenshot({ path: path.join(out, `${label}-${skin}.png`) });
  }
  // Text-only failed replies expose Edit with the same compact shape and target.
  await p.evaluate(async id => { await WosOutbox.remove(id); const it = await WosOutbox.stage({ kind: 'reply', sessionId: 'compact-fixture', model: 'qa', provider: 'qa', text: 'Editable fixture' }); await WosOutbox.transition(it.id, 'failed', 'Not sent'); }, id);
  const edit = p.locator(scope + ' .ch-pill [data-obedit]'); await edit.waitFor(); await p.waitForTimeout(300);
  ok(await edit.evaluate(el => { const r = el.getBoundingClientRect(), x = r.x + r.width / 2; return r.height === 26 && document.elementFromPoint(x, r.top - 8) === el && document.elementFromPoint(x, r.bottom + 8) === el; }), `${label}: Edit compact visual and extended target`);
  await p.evaluate(async () => { for (const x of WosOutbox.unsent()) await WosOutbox.remove(x.id); const it = await WosOutbox.stage({ kind: 'new', audio: new Blob(['held recording'], { type: 'audio/webm' }) }); await WosOutbox.transition(it.id, 'held', 'Kept on device'); });
  const dismiss = p.locator(scope + ' .ch-pill [data-obdismiss]'); await dismiss.waitFor(); await p.waitForTimeout(300);
  ok(await dismiss.evaluate(el => { const r = el.getBoundingClientRect(), x = r.x + r.width / 2; return r.height === 26 && document.elementFromPoint(x, r.top - 8) === el && document.elementFromPoint(x, r.bottom + 8) === el; }), `${label}: Dismiss compact visual and extended target`);
  ok(errors.length === 0, `${label}: no browser errors`, errors);
  console.log(`${label}: ${writes} intercepted writes; no agent writes reached a service`);
  await ctx.close();
 }
 await browser.close();
 fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ source: root, origin, results, measurements }, null, 2));
 console.log(`${results.filter(x => x.pass).length} passed, ${results.filter(x => !x.pass).length} failed`);
 if (results.some(x => !x.pass)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(2); });
