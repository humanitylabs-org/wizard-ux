// Real-data check of the staged bound-views preview, as James gets it (router + boot.js + front + real hosted apps).
// Every write is refused by the preview; this script also aborts non-GETs itself.
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/telos/node_modules/playwright'); }
const fs = require('fs'), path = require('path');
const HOST = 'bound-views.staging.wizard001.com', OUT = '/home/telos/.hermes/cache/scratch/bv-staged';
fs.mkdirSync(OUT, { recursive: true });
const THREADS = (process.argv[2] || '').split(',').filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/home/telos/.local/bin/google-chrome', args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:9399`] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 WizardOS-Android/0.9.0' });
  await ctx.route('**/*', r => r.request().method() === 'GET' || r.request().method() === 'HEAD' ? r.continue() : r.fulfill({ status: 403, body: '{}' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.rvCoached', 'true'); } catch (e) {} });
  await p.goto(`http://${HOST}/wizard-os-home/?open=chats`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 60000 }); await sleep(2500);
  for (const [k, sid] of THREADS.entries()) {
    await p.evaluate(id => __wos.openWizardThread(id), sid);
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector(`[data-chats="${w.id}"] .ch-msgs .msg.a`); }, sid, { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    const s = await p.evaluate(() => { const b = Object.values(__wos.wins).find(w => w.bound); const e = document.getElementById('boundEdge'); return { title: document.querySelector('.ch-head .ti b')?.textContent, bound: b ? (b.appId === 'link' ? b.url : b.appId) : null, edge: !!e && !e.hidden }; });
    console.log(k, sid, JSON.stringify(s));
    await p.screenshot({ path: path.join(OUT, `${k}-thread.png`) });
    if (s.bound) {
      await p.locator('#boundEdge .be-tab').tap(); await sleep(3500);
      const f = await p.evaluate(() => { const fr = document.querySelector('.desk .win.bound iframe'); let t = ''; try { t = fr.contentDocument.body.innerText.slice(0, 80); } catch (e) { t = 'x-origin'; } return { idx: __wos.idx, focusBound: !!__wos.wins[__wos.desks[__wos.idx].focus]?.bound, text: t, fallback: !!document.querySelector('.desk .win.bound .frame-wrap.coming, .desk .win.bound .frame-wrap.fail') }; });
      console.log('   view', JSON.stringify(f));
      await p.screenshot({ path: path.join(OUT, `${k}-view.png`) });
      await p.keyboard.press('Escape'); await sleep(900);
    }
    await p.keyboard.press('Escape'); await sleep(900);
    const after = await p.evaluate(() => ({ thread: Object.values(__wos.wins).find(w => w.app === 'chats')?.thread ?? null, nBound: Object.values(__wos.wins).filter(w => w.bound).length, host: location.host }));
    console.log('   after back×2', JSON.stringify(after));
  }
  console.log('page errors', errs.length, errs.slice(0, 3));
  await b.close();
})();
