// Live check of the per-app update banner on the real tailnet shell with the real Wisdom app (Thales).
// Reads only: every non-GET is answered locally. The installed-apps feed is read live, then Wisdom's revision is
// moved forward in the response to simulate the next Wisdom release.
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_DIR);
const OUT = process.env.EVIDENCE; fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'https://wizard.tailc0f369.ts.net';
const out = { checks: [], blocked: [], feed: [] };
const ok = (n, c, d) => { out.checks.push({ n, pass: !!c, d }); console.error((c ? 'PASS ' : 'FAIL ') + n, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); };
(async () => {
  const b = await chromium.launch({ headless: true });
  try {
    for (const mobile of [true, false]) {
      const S = mobile ? 'phone' : 'desktop';
      let flip = false, realRev = '';
      const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' } : { viewport: { width: 1440, height: 950 } });
      await ctx.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url());
        if (!['GET', 'HEAD'].includes(q.method())) { out.blocked.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
        if (u.pathname === '/wizard-os-home/store-data/wizard/v1/installed-apps') {
          const res = await r.fetch(); const d = await res.json();
          const w = (d.wam || []).find(a => a.id === 'wisdom'); realRev = w?.commit || ''; out.feed.push({ status: res.status(), wisdom: w && { commit: w.commit, version: w.version }, flip });
          if (flip && w) w.commit = 'qa-next-' + w.commit.slice(0, 8);
          return r.fulfill({ response: res, body: JSON.stringify(d) });
        }
        return r.continue();
      });
      await ctx.addInitScript(() => { try { if (window === parent) localStorage.setItem('wos.coached', 'true'); } catch (_) {} });
      const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
      await p.goto(ORIGIN + '/wizard-os-home/' + (mobile ? '?open=wisdom' : 'desktop.html?open=wisdom'), { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => !!window.WizAppVersions, null, { timeout: 30000 });
      await p.evaluate(() => { try { window.WosTour?.finish?.(); } catch (_) {} });
      if (!mobile) await p.evaluate(() => { const a = WizCore.apps('desktop').APP.wisdom; if (!Object.values(__wux.wins).some(w => w.appId === 'wisdom')) __wux.openApp(a); });
      await p.waitForFunction(() => WizAppServices.update.frames().some(f => f.appId === 'wisdom'), null, { timeout: 30000 });
      const fr = async () => { for (let i = 0; i < 100; i++) { const f = p.frames().find(f => /\/wisdom\//.test(f.url())); if (f) return f; await p.waitForTimeout(100); } throw new Error('no wisdom frame'); };
      let w = await fr(); await w.waitForFunction(() => document.readyState === 'complete' && !!window.WizardApp, null, { timeout: 30000 });
      await p.waitForTimeout(2500);
      await w.evaluate(() => { window.__qaMark = 1; });
      const href0 = await w.evaluate(() => location.href);
      await p.evaluate(() => WizAppVersions.check());
      ok(S + ': live feed readable through the gateway, Wisdom revision present', out.feed.length && out.feed.at(-1).status === 200 && /^[0-9a-f]{40}$/.test(realRev), out.feed.at(-1));
      ok(S + ': same live version → no strip', !(await p.$('.app-upd[data-app="wisdom"]')));
      flip = true; await p.evaluate(() => WizAppVersions.check()); await p.waitForTimeout(900);
      const s = await p.evaluate(() => { const s = document.querySelector('.app-upd[data-app="wisdom"]'); if (!s) return null; const b = s.getBoundingClientRect(), t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { text: s.innerText.replace(/\s+/g, ' ').trim(), onTop: !!t && s.contains(t), box: [b.left, b.top, b.width, b.height].map(Math.round) }; });
      ok(S + ': next Wisdom release → "Wisdom updated · Reload" on top of the Wisdom window', s && /Wisdom updated/.test(s.text) && s.onTop, s);
      await p.screenshot({ path: path.join(OUT, S + '-live-strip.png') });
      ok(S + ': Wisdom not reloaded behind the owner', (await w.evaluate(() => window.__qaMark)) === 1);
      await p.click('.app-upd[data-app="wisdom"] [data-go]');
      let reloaded = false; for (let i = 0; i < 60 && !reloaded; i++) { await p.waitForTimeout(250); try { w = await fr(); reloaded = (await w.evaluate(() => window.__qaMark)) !== 1; } catch (_) {} }
      ok(S + ': Reload reloads Wisdom', reloaded);
      await w.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30000 }).catch(() => {});
      ok(S + ': Wisdom comes back on the same address', (await w.evaluate(() => location.href)) === href0, { href0 });
      await p.evaluate(() => WizAppVersions.check()); await p.waitForTimeout(500);
      ok(S + ': strip gone after reload', !(await p.$('.app-upd[data-app="wisdom"]')));
      ok(S + ': no page errors from the banner', !errs.some(e => /app-versions|WizAppVersions/.test(e)), errs);
      await ctx.close();
    }
  } catch (e) { out.error = String(e.stack || e); }
  finally { await b.close(); out.status = !out.error && out.checks.every(c => c.pass) ? 'pass' : 'fail'; fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify({ status: out.status, error: out.error, n: out.checks.length, blocked: out.blocked.length })); }
})();
