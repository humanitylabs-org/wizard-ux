'use strict';
// wizard-ux issue 1964 (James, 27 Nov 2026): the AI apps app panel header has no double-arrow Wider button any more, in
// every state (an app alone, chat + app, Full screen, Half screen); Full screen / Half screen and Hide still work and
// stay where they were. Real AI-apps shell, synthetic origin only. QA_PLAYWRIGHT=<playwright> node tests/qa-no-wider-button.cjs
// QA_EXPECT=broken runs the same steps against a build without it (QA_WEB=<that build's web dir>) and expects them to fail.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://no-wider-button.test', prefix = '/wizard-os-home/', root = path.resolve(process.env.QA_WEB || path.join(__dirname, '../web'));
const out = process.env.QA_OUT || 'no-wider-button-evidence'; fs.mkdirSync(out, { recursive: true });
const report = { cases: [] };
(async () => {
  const browser = await chromium.launch(); let p;
  try {
    // each skin in a plain browser, then Nebula inside the Mac app (its title-bar stand-ins, `macHoles`)
    for (const [skin, mac] of [...(process.env.QA_SKINS || 'nebula,obsidian-light').split(',').map(s => [s, false]), ['nebula', true]]) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const errors = [];
      await c.routeWebSocket('**/*', ws => ws.close());
      await c.addInitScript(skin => { if (window !== top) return; for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, skin);
      if (mac) await c.addInitScript(() => { if (window === top) window.webkit = { messageHandlers: { wizardNative: { postMessage() {} } } }; });
      await c.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url()); if (u.origin !== origin) return r.abort();
        if (u.pathname.includes('/v1/runs')) return r.abort();
        if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 403, json: { error: 'QA refuses writes' } });
        if (u.pathname === prefix + 'store/index.html') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><style>body{background:#171722;color:#eee;padding:24px;font:16px system-ui}</style><h1>Synthetic app</h1>' });
        if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [{ id: 'qa-thread', title: 'No Wider — synthetic chat', status: 'completed', updatedAt: '2026-11-05T00:00:00Z' }], has_more: false } });
        if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
        if (u.pathname.startsWith(prefix)) { const f = path.resolve(root, u.pathname.slice(prefix.length) || 'index.html'); if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ path: f }); }
        return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
      });
      p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
      const settle = async () => { await p.waitForTimeout(150); await p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime))); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
      const boot = async () => { await p.waitForFunction(() => window.__wux && document.documentElement.dataset.aiApps === 'desktop' && !WosWelcome.active && !WosExperience.state.busy && document.querySelector('.ch-compose')); await settle(); };
      const model = () => p.evaluate(() => WizCore.panes.get());
      const box = role => p.locator('#stage > .wsp[data-aad-role="' + role + '"]').boundingBox();
      // every arrangement button on screen, wherever it sits
      const shown = () => p.evaluate(() => [...document.querySelectorAll('.aad-modes [data-mode], .aad-ctop [data-mode], .aad-ptop [data-mode], .aad-stop [data-mode]')].filter(b => b.getClientRects().length && b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden').map(b => b.dataset.mode));
      const shot = async name => { const file = path.join(out, skin + (mac ? '-mac' : '') + '-' + name + '.png'); await p.screenshot({ path: file }); report.cases.push({ skin, name, file, model: await model(), shown: await shown() }); };
      const halfBtn = () => p.locator('.aad-modes [data-mode="half"]:visible');
      const fullBtn = () => p.locator('.aad-modes [data-mode="full"]:visible');
      await p.goto(origin + prefix + 'desktop.html'); await boot();
      // every control in the app panel's header that is on screen: class, label, x
      const appHead = () => p.evaluate(() => [...document.querySelectorAll('.aad-ptop button')].filter(b => b.getClientRects().length && b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden').map(b => ({ cls: b.className, label: b.getAttribute('aria-label') || b.title || '', x: Math.round(b.getBoundingClientRect().x) })));
      // no double-arrow (expand / shrink) icon and no "Wider" / "Back to the side" control anywhere in a header
      const noWider = async state => {
        const bad = await p.evaluate(() => [...document.querySelectorAll('.aad-ptop, .aad-ctop, .aad-stop')].flatMap(h => [...h.querySelectorAll('button')]).filter(b => b.getClientRects().length && (b.classList.contains('aad-pw') || /wider|back to the side|narrower/i.test((b.title || '') + ' ' + (b.getAttribute('aria-label') || '')))).map(b => b.outerHTML.slice(0, 120)));
        assert.deepEqual(bad, [], state + ': no Wider button');
      };
      await p.evaluate(() => __wux.openThread('qa-thread')); await p.waitForFunction(() => document.documentElement.hasAttribute('data-aad-chat')); await settle();
      await p.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store'])); await p.waitForFunction(() => document.documentElement.hasAttribute('data-aad-split')); await settle();
      // two windows: the pair, then Hide; nothing else
      await noWider('two windows');
      let h = await appHead();
      assert.deepEqual(h.slice(0, 2).map(b => b.label), ['Full screen', 'Half screen'], 'two windows: the pair first');
      assert.equal(h.length, 3, 'two windows: Full screen, Half screen, Hide: ' + JSON.stringify(h));
      assert.ok(/aad-px/.test(h[2].cls), 'Hide last');
      const rel = hs => hs.map(b => b.x - hs.at(-1).x), gaps = rel(h);   // the group's place relative to Hide (the header itself moves with its window)
      await shot('two-windows');
      if (mac) {
        // Mac app: one click-through stand-in per header button over #bar, none for a removed Wider button
        await p.waitForFunction(() => document.documentElement.dataset.nativeChrome === 'mac');
        await p.mouse.move(700, 10); await settle();
        const holes = await p.evaluate(() => {
          const bar = document.getElementById('bar').getBoundingClientRect();
          const btns = [...document.querySelectorAll('.aad-ctop button, .aad-ptop button, .aad-stop button')].filter(b => { const r = b.getBoundingClientRect(); return b.getClientRects().length && r.width && r.bottom > bar.top && r.top < bar.bottom; });
          return { holes: document.querySelectorAll('#bar .aad-mac-holes > i').length, buttons: btns.length, pw: document.querySelectorAll('.aad-pw').length };
        });
        assert.equal(holes.pw, 0, 'Mac: no Wider button'); assert.ok(holes.buttons >= 4, 'Mac: the header buttons are over #bar ' + JSON.stringify(holes));
        assert.equal(holes.holes, holes.buttons, 'Mac: one stand-in per header button, no extra one ' + JSON.stringify(holes));
        report.cases.push({ skin, mac, holes });
        assert.deepEqual(errors, [], 'no page errors'); await c.close(); continue;
      }
      // Full screen works, the header keeps its places
      await fullBtn().click(); await settle(); assert.equal((await model()).mode, 'full', 'Full screen works');
      await noWider('full screen'); h = await appHead();
      assert.deepEqual(rel(h), gaps, 'full screen: nothing in the header moved');
      await shot('full');
      // Half screen works
      await halfBtn().click(); await settle(); assert.equal((await model()).mode, 'tiled', 'Half screen works');
      await halfBtn().click(); await settle();   // (from Full screen it went back to the split; again: the middle)
      const chat = await box('chat'), app = await box('app'); assert.ok(Math.abs(chat.width - app.width) <= 2, `half: equal ${chat.width}/${app.width}`);
      await noWider('half screen'); assert.deepEqual(rel(await appHead()), gaps, 'half screen: nothing moved');
      await shot('half');
      // ⌥F no longer flips the hidden wide state (one behaviour only: ⌥⇧F is Full screen)
      await p.keyboard.press('Alt+KeyF'); await settle();
      assert.equal(await p.evaluate(() => document.documentElement.hasAttribute('data-aad-wide')), false, '⌥F: no hidden wide toggle');
      // the app alone (chat closed): only Hide, no expand icon
      await p.evaluate(() => document.querySelector('.aad-ctop .aad-cx').click()); await settle();
      await noWider('app alone'); h = await appHead();
      assert.deepEqual(h.map(b => b.cls.includes('aad-px')), [true], 'app alone: only Hide ' + JSON.stringify(h));
      await shot('one-window');
      // Hide still works
      await p.locator('.aad-ptop .aad-px').click(); await settle();
      await p.waitForFunction(() => !document.documentElement.hasAttribute('data-aad-split')); 
      assert.deepEqual(errors, [], 'no page errors');
      await c.close();
    }
    report.ok = true;
  } catch (e) {
    report.ok = false; report.error = String(e.stack || e);
    if (p) await p.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    if (process.env.QA_EXPECT !== 'broken') { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.error(e); process.exitCode = 1; }
  } finally {
    await browser.close();
    if (process.env.QA_EXPECT === 'broken') { if (report.ok) { console.error('expected the old build to fail'); process.exitCode = 1; } else console.log('old build fails as expected:', report.error.split('\n')[0]); }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (report.ok) console.log('ok', out);
  }
})();
