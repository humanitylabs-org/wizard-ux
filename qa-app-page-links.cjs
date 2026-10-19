// QA: a chat link to a page inside an installed app (e.g. /voice-outline-streaming/) opens AS that app, so the
// window gets the app's Wizard services (shared microphone, Back, theme). James, 19 Oct 2026: Outline opened from a
// chat link said "This link is not connected to Wizard's shared microphone."
// Runs the real live origin with this tree's shell JS substituted; every non-GET write is refused.
// Usage: QA_WEB_DIR=<tree> PW=<playwright module dir> node qa-app-page-links.cjs [origin]
const { createRequire } = require('module');
const pw = createRequire((process.env.PW || '/home/telos/node_modules') + '/')('playwright');
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || 'https://wizard.tailc0f369.ts.net', WEB = process.env.QA_WEB_DIR, OUT = process.env.QA_OUT || './evidence';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x).slice(0, 400)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await pw.chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
  const writes = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && !/\/api\/(live|document)/.test(u.pathname)) { writes.push(u.pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    if (q.method() !== 'GET' && /\/api\/document/.test(u.pathname)) { writes.push(u.pathname); return r.fulfill({ status: 409, body: '{}' }); }
    const m = WEB && u.pathname.match(/^\/wizard-os-home\/((?:core\/|desktop\/)?[a-z0-9-]+\.js)$/);
    if (m && fs.existsSync(path.join(WEB, 'web', m[1]))) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(WEB, 'web', m[1])) });
    return r.continue();
  });
  const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(ORIGIN + '/wizard-os-home/?shell=desktop'); await p.waitForFunction(() => window.__wux && window.WizCore?.apps, null, { timeout: 60000 });
  await sleep(3000);
  const reg = await p.evaluate(() => { const r = window.WizCore.apps('desktop'); if (!r.appAt) return { missing: true }; return { page: r.appAt('/voice-outline-streaming/')?.id || null, deep: r.appAt('/voice-outline-streaming/index.html?x=1')?.id || null, other: r.appAt('/not-an-app/')?.id || null, home: r.appAt('/wizard-os-home/')?.id || null }; });
  ok(reg.page === 'outline-streaming-demo', 'the app URL resolves to its installed app', reg);
  ok(reg.deep === 'outline-streaming-demo', 'a page below the app URL resolves to that app', reg);
  ok(reg.other === null && reg.home === null, 'unrelated pages and the shell stay plain links', reg);
  // Drive the real chat-link path: a synthetic message link clicked inside a Chats window.
  await p.evaluate(() => __wux.newChat && __wux.newChat()); await sleep(1500);
  const clicked = await p.evaluate(() => { const pane = document.querySelector('[data-chats] .ch-msgs') || document.querySelector('[data-chats]'); if (!pane) return false;
    const m = document.createElement('div'); m.className = 'msg a'; m.innerHTML = '<div class="bub"><a href="/voice-outline-streaming/">Open Outline</a></div>'; pane.append(m); m.querySelector('a').click(); return true; });
  ok(clicked, 'a chat link was clicked in a Chats window');
  await sleep(6000);
  const st = await p.evaluate(() => { const all = Object.values(__wux.wins).map(x => ({ app: x.app, appId: x.appId, url: x.url, title: x.title })); const w = all.find(x => x.appId === 'outline-streaming-demo'); return w || { none: true, all }; });
  ok(st && st.appId === 'outline-streaming-demo', 'the link opens as the Outline app window, not a bare link window', st);
  const fh = await p.$('.win iframe[src*="/voice-outline-streaming/"], .win iframe.appframe'), fr = fh ? await fh.contentFrame() : null;
  if (fr) await fr.waitForFunction(() => window.WizardApp && document.querySelector('#save'), null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => !!document.querySelector('.linksheet:not([hidden])')) === false, 'the plain link pane did not open');
  const inner = fr ? await fr.evaluate(() => ({ hosted: WizardApp.hosted, notice: document.querySelector('#notice')?.textContent || '' })) : null;
  ok(inner && inner.hosted === true, 'the opened Outline is connected to Wizard (hosted)', inner);
  ok(inner && !/not connected/i.test(inner.notice), 'no "not connected to Wizard’s shared microphone" notice', inner); // the mic itself is not started: this runs against live data
  await p.screenshot({ path: path.join(OUT, 'app-page-link.png') });
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close(); console.log(`app-page-links: ${pass} passed, ${fail} failed; intercepted writes: ${writes.length}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
