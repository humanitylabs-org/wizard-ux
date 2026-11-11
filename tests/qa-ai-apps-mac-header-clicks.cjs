'use strict';
// AI apps view inside Wizard for Mac (wizard-os issue 548): the Mac app lays a title-bar drag strip over the page. It
// reads #bar's box and the controls inside #bar (try-wizard WizardDragView.script, copied below as it ships) and takes
// every mouse-down in that box that is not on one of those controls to move the window. The docked chat's header (and
// the app panel's) sits over #bar but lives on its desk, so its buttons (Chats list, the four arrangements, close) never
// got the click. Real browser, disposable synthetic data, writes refused; the page is told it is in the Mac app and the
// native hit test is replayed on the regions the page posts. QA_EXPECT=broken checks the dead buttons on the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://mac-header-clicks.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'mac-header-clicks-evidence');
const BROKEN = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
// try-wizard next/mac/App/main.swift WizardDragView.script, verbatim (the Mac app injects it at document start).
const NATIVE = `(() => {
  let pending = false;
  const rect = e => { const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; };
  const update = () => {
    pending=false;
    const bar=document.querySelector('header#bar.bar');
    const header=bar ? rect(bar) : [0,0,innerWidth,28];
    const elements=(bar || document).querySelectorAll('button,a,input,select,textarea,summary,[role="button"],[tabindex],[contenteditable],[data-ws],#voicePill');
    const params={header,controls:[...elements].filter(e=>e.getClientRects().length && e.getBoundingClientRect().top < header[3]).map(rect)};
    window.webkit.messageHandlers.wizardNative.postMessage({method:'chrome.regions',params});
  };
  const schedule = () => { if (!pending) { pending=true; setTimeout(update,0); } };
  addEventListener('DOMContentLoaded', () => {
    const bar=document.querySelector('header#bar.bar');
    if (bar) new MutationObserver(schedule).observe(bar,{subtree:true,childList:true,attributes:true});
    new ResizeObserver(schedule).observe(document.documentElement);
    document.fonts.ready.then(schedule);
    schedule();
  }, {once:true});
  addEventListener('resize',schedule); addEventListener('scroll',schedule,true);
})();`;
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const ROWS = [['qa-a', 'Run sleep 900 in background'], ['qa-b', 'Write three-word greeting']].map(([id, title], i) => ({
  id, title, runtime: 'direct', status: 'completed', updated_at: iso(now - (i + 1) * 36e5), updatedAt: iso(now - (i + 1) * 36e5),
  last_active: (now - (i + 1) * 36e5) / 1000, message_count: 2, messageCount: 2, archived: false, preview: 'Done.' }));
const report = { web, expect: BROKEN ? 'broken' : 'fixed', cases: [] };

(async () => {
  const browser = await chromium.launch();
  try {
    // centred: the chat floats below the strip, so its header was never under it (a check that the stand-ins follow)
    // fold: the sidebar folds to its rail with the keyboard only (no pointer over the top row), so #bar and the header move
    // together and the Mac app must still be told (Codex review)
    for (const scene of ['chat', 'chat+app', 'centred', 'fold']) {
      const entry = { scene, errors: [], dead: [], checked: 0 }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(() => {
          if (window !== top) return;
          window.__regions = null;
          window.webkit = { messageHandlers: { wizardNative: { postMessage(m) { if (m?.method === 'chrome.regions') window.__regions = m.params; } } } };
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' }))
            if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
        });
        await context.addInitScript(`if (window === top) ${NATIVE}`); // forMainFrameOnly
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) return r.abort();
          if (p.includes('/v1/runs')) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            if (p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true } });
            return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'store/index.html') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><h1>Synthetic app</h1>' });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Run sleep 900 in the background', timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Started.', timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'desktop.html');
        await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && document.documentElement.dataset.layout === 'ai-apps' && document.querySelector('.ch-compose'), null, { timeout: 20000 });
        assert.equal(await page.evaluate(() => document.documentElement.dataset.nativeChrome), 'mac');
        await page.evaluate(() => __wux.openThread('qa-a'));
        await page.waitForFunction(() => document.documentElement.hasAttribute('data-aad-chat'), null, { timeout: 10000 });
        if (scene === 'chat+app') { await page.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store'])); await page.waitForFunction(() => document.documentElement.hasAttribute('data-aad-split'), null, { timeout: 10000 }); }
        if (scene === 'centred') { await page.mouse.move(700, 20); await nap(100); await page.locator('.aad-ctop [data-mode="centre"]').click({ force: true }); }
        if (scene === 'fold') { await nap(800); await page.keyboard.press('Control+Shift+S'); await page.waitForFunction(() => document.documentElement.dataset.aadSide === 'rail', null, { timeout: 5000 }); }
        await nap(800);
        // the pointer reaches the top row before it clicks (not for fold: that one must follow without it)
        if (scene !== 'fold') { await page.mouse.move(900, 22); await nap(300); }
        const r = await page.evaluate(() => {
          const reg = window.__regions; if (!reg) return null;
          const [hx, hy, hw, hh] = reg.header, inR = ([x, y, w, h], px, py, pad = 0) => px >= x - pad && px <= x + w + pad && py >= y - pad && py <= y + h + pad;
          // WizardDragView.hitTest: traffic-light corner and full screen aside, a mouse-down in the header box that is
          // not on a control (each grown by 2 px) moves the window and never reaches the page.
          const swallowed = (px, py) => !(px < 96 && py < 32) && inR([hx, hy, hw, hh], px, py) && !reg.controls.some(c => inR(c, px, py, 2));
          const buttons = [...document.querySelectorAll('.aad-ctop button, .aad-ptop button, .aad-stop button')].filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden').map(b => {
            const q = b.getBoundingClientRect(), x = q.x + q.width / 2, y = q.y + q.height / 2;
            return { label: b.getAttribute('aria-label') || b.title || b.className, x: Math.round(x), y: Math.round(y), swallowed: swallowed(x, y), page: b.contains(document.elementFromPoint(x, y)) };
          });
          const tt = document.querySelector('.aad-ctop .aad-tt'), tq = tt?.getBoundingClientRect();
          const title = tq && tq.width ? { x: Math.round(tq.x + Math.min(40, tq.width / 2)), y: Math.round(tq.y + tq.height / 2) } : null;
          if (title) title.drags = swallowed(title.x, title.y);
          return { header: reg.header, controls: reg.controls.length, buttons, title };
        });
        assert.ok(r, scene + ': the page posted its title-bar regions');
        entry.header = r.header; entry.controls = r.controls; entry.title = r.title;
        entry.checked = r.buttons.length; entry.dead = r.buttons.filter(b => b.swallowed).map(b => `${b.label} @${b.x},${b.y}`);
        assert.ok(r.buttons.length >= 6, scene + ': found the header buttons');
        assert.ok(r.buttons.every(b => b.page), scene + ': every header button is on top in the page itself');
        await page.screenshot({ path: path.join(out, `${scene.replace('+', '-')}-${BROKEN ? 'before' : 'after'}.png`), clip: { x: 0, y: 0, width: 1440, height: 160 } });
        // a second capture with the Mac app's view drawn on: red = a click there moves the window, green = the page gets it
        await page.evaluate(() => { const reg = window.__regions, box = (r, c) => { const d = document.createElement('div'); d.className = 'qa-reg'; d.style.cssText = `position:fixed;z-index:99999;pointer-events:none;left:${r[0]}px;top:${r[1]}px;width:${r[2]}px;height:${r[3]}px;background:${c}`; document.body.append(d); };
          box(reg.header, 'rgba(255,40,40,.35)'); for (const c of reg.controls) box(c, 'rgba(40,220,90,.75)'); });
        await page.screenshot({ path: path.join(out, `${scene.replace('+', '-')}-${BROKEN ? 'before' : 'after'}-regions.png`), clip: { x: 0, y: 0, width: 1440, height: 160 } });
        await page.evaluate(() => document.querySelectorAll('.qa-reg').forEach(n => n.remove()));
        if (BROKEN) { if (scene !== 'centred') assert.ok(entry.dead.length > 0, scene + ': expected header buttons under the Mac drag strip on the baseline'); entry.pass = true; continue; }
        assert.deepEqual(entry.dead, [], scene + ': header buttons the Mac app would take as a window drag');
        // blank header space still moves the window
        if (r.title && r.title.y < r.header[1] + r.header[3]) assert.equal(r.title.drags, true, scene + ': the chat title area still drags the window');
        // and the page's own buttons still work: an arrangement change, then the regions follow the new place
        const before = await page.evaluate(() => WizCore.panes.get().mode);
        const target = before === 'centre' ? 'tiled' : 'pair';
        await page.locator(`.aad-ctop [data-mode="${target}"]`).click();
        await page.waitForFunction(t => WizCore.panes.get().mode === t, target, { timeout: 5000 });
        await nap(500); await page.mouse.move(901, 22); await nap(300);
        const again = await page.evaluate(() => {
          const reg = window.__regions, [hx, hy, hw, hh] = reg.header;
          const inR = ([x, y, w, h], px, py, pad = 0) => px >= x - pad && px <= x + w + pad && py >= y - pad && py <= y + h + pad;
          return [...document.querySelectorAll('.aad-ctop button')].filter(b => b.getClientRects().length).map(b => { const q = b.getBoundingClientRect(), x = q.x + q.width / 2, y = q.y + q.height / 2;
            return !(x < 96 && y < 32) && inR([hx, hy, hw, hh], x, y) && !reg.controls.some(c => inR(c, x, y, 2)) ? b.getAttribute('aria-label') : null; }).filter(Boolean);
        });
        assert.deepEqual(again, [], scene + ': after an arrangement change');
        assert.deepEqual(entry.errors, [], scene + ': page errors');
        entry.pass = true;
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.cases.map(c => ({ scene: c.scene, pass: !!c.pass, checked: c.checked, controls: c.controls, dead: c.dead, title: c.title, errors: c.errors.slice(0, 3) })), null, 1));
  }
})().catch(e => { console.error(e); process.exit(1); });
