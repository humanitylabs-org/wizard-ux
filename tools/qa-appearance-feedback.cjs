// Real shell, isolated API fixture: no private reads or live writes reach qa-origin.
// PW=/srv/work/provider-signin-browser/node_modules/playwright node tools/qa-appearance-feedback.cjs <origin> <out>
const { chromium, devices } = require(process.env.PW || 'playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const BASE = process.argv[2], OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const checks = [], errors = [], blocked = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'obsidian']) {
      const ctx = await browser.newContext({ ...(shell === 'phone' ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } }), serviceWorkers: 'block' });
      let held = null;
      const skins = { skins: [{ id: 'qa-quiet', name: 'Quiet (QA fixture)', base: skin, tweaks: {} }], active: null };
      await ctx.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url());
        const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (u.origin !== new URL(BASE).origin) return r.abort();
        if (q.method() !== 'GET' && q.method() !== 'HEAD') {
          blocked.push({ shell, skin, method: q.method(), path: u.pathname });
          if (u.pathname === '/wizard/v1/skins/active' && q.method() === 'PUT') {
            await new Promise(resolve => { held = resolve; });
            return json({ error: 'QA refuses writes' }, 403);
          }
          return json({ error: 'QA refuses writes' }, 403);
        }
        if (u.pathname === '/wizard/v1/skins') return json(skins);
        if (u.pathname === '/wizard/v1/my-skin') return r.fulfill({ contentType: 'text/css', body: '' });
        // Only checked-out assets reach the read-only origin. Every dynamic/private API is fixture data.
        if (u.pathname.startsWith('/wizard-os-home/') && !/\/(store-install|(?:api|voice|models|usage|registry|config|status|files))(?:\/|$)/.test(u.pathname)) return r.continue();
        if (/\/events(?:\/|$)/.test(u.pathname)) return r.fulfill({ contentType: 'text/event-stream', body: ': QA empty stream\n\n' });
        if (/\/apps$/.test(u.pathname)) return json({ apps: [], slots: {} });
        if (/\/sessions$/.test(u.pathname)) return json({ data: [], has_more: false });
        return json({ agents: [], items: [], data: [], sessions: [], ready: false, configured: false });
      });
      await ctx.addInitScript(({ shell, skin }) => {
        for (const [k, v] of Object.entries({ 'wux.shell': shell, 'wos.skin': skin, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.voiceTipSeen': 'true' })) localStorage.setItem(k, v);
        navigator.sendBeacon = () => false;
      }, { shell, skin });
      const p = await ctx.newPage(); p.on('pageerror', e => errors.push({ shell, skin, error: String(e) }));
      const url = BASE + (shell === 'phone' ? '?shell=phone&view=settings' : 'desktop.html?view=settings');
      for (let retry = 0; ; retry++) { try { await p.goto(url, { waitUntil: 'load', timeout: 60000 }); break; } catch (e) { if (retry > 1 || !String(e).includes('ERR_NETWORK_CHANGED')) throw e; } }
      await p.waitForFunction(([skin]) => window.WosExperience?.state.owner && window.WosSkin?.current === skin && !WosExperience.state.busy, [skin], { timeout: 30000 });
      // Use the real shell's Settings surface, not a separately mounted test page.
      await p.evaluate(shell => { if (shell === 'desktop') __wux.openSettings('appearance'); else { __wos.openSheet('settings'); } }, shell);
      if (shell === 'phone') { await p.waitForTimeout(1500); await p.locator('#settingsBody').getByText('Appearance', { exact: true }).first().click(); await p.waitForTimeout(800); }
      const group = p.locator('.tw-group:visible').first(); await group.waitFor({ state: 'visible', timeout: 20000 });
      await p.waitForTimeout(1200);
      const text = await group.innerText();
      assert.ok(text.includes(skin === 'nebula' ? 'Wizard’s tweaks' : 'Miguel’s tweaks'));
      assert.ok(!text.includes(skin === 'nebula' ? 'Miguel’s tweaks' : 'Wizard’s tweaks'));
      assert.ok(!/James[’']s/.test(text)); assert.ok(text.includes('Built-in choices'));
      assert.equal(await p.locator('[data-tweakauthor]:visible').count(), 1);
      await group.scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(OUT, `${shell}-${skin}-tweaks.png`) });
      checks.push({ shell, skin, group: text });
      const tile = p.locator('[data-ownskin="qa-quiet"]:visible');
      await tile.scrollIntoViewIfNeeded();
      const sync = await tile.evaluate(el => { el.click(); return { busy: el.getAttribute('aria-busy'), disabled: el.disabled, pending: el.classList.contains('st-pending') }; });
      assert.deepEqual(sync, { busy: 'true', disabled: true, pending: true });
      await p.waitForFunction(() => document.querySelector('[data-ownskin="qa-quiet"][aria-busy="true"]'));
      for (let i = 0; !held && i < 100; i++) await sleep(25);
      assert.ok(held, 'PUT is held at browser route, never sent');
      const material = await tile.evaluate(el => { const a = getComputedStyle(el, '::after'), b = getComputedStyle(el, '::before'); return { overlay: b.backgroundColor, spinner: a.borderTopColor, opacity: getComputedStyle(el).opacity, animation: a.animationName }; });
      assert.equal(material.opacity, '1'); assert.equal(material.animation, 'st-busy-spin');
      assert.ok(!material.overlay.startsWith('rgba(') || material.overlay.endsWith(', 1)'), 'overlay fully opaque');
      await p.screenshot({ path: path.join(OUT, `${shell}-${skin}-pending.png`) });
      held(); await p.waitForFunction(() => !document.querySelector('[aria-busy="true"].st-pending'));
      assert.equal(await p.evaluate(() => WosSkin.current), skin);
      await p.locator('[role="alert"]').filter({ hasText: 'Could not save skin' }).first().waitFor();
      assert.equal(await p.evaluate(() => WosMySkin.active), null);
      checks.push({ shell, skin, sync, material, rollback: true, failureShown: true });
      await ctx.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checks, errors, blocked }, null, 2));
  }
  console.log(JSON.stringify({ checks: checks.length, screenshots: fs.readdirSync(OUT).filter(f => f.endsWith('.png')).length, errors, blocked }));
})().catch(e => { console.error(e); process.exitCode = 1; });
