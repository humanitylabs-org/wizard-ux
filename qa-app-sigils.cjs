// QA: app sigils. Every launcher app wears a sigil (one silhouette, one bite) in its own colour, on both shells.
// Usage: QA_WEB_DIR=$PWD node qa-app-sigils.cjs [origin]   (default origin: the Agent Service on :8923, real reads)
// Every write is refused. The app list is the live one plus two stubbed links that prove the fallbacks:
//   qa-owned  → launcher.json names a glyph ("eye") and a colour, so that glyph + colour win
//   qa-plain  → no sigil, so it shows its initial on a colour picked from its id
const { chromium } = (() => { try { return require('playwright'); } catch (e) { try { return require('playwright-core'); } catch (e2) { return require('/home/developer/node_modules/playwright'); } } })();
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || 'http://127.0.0.1:8923/wizard-os-home/';
const W = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const EXTRA = [
  { id: 'qa-owned', name: 'QA Owned', url: '/qa-owned/', icon: 'eye', colors: ['#ff3366'], desc: 'stub', source: 'launcher.json' },
  { id: 'qa-plain', name: 'Plainapp', url: '/qa-plain/', icon: '★', colors: [], desc: 'stub', source: 'launcher.json' },
];
const MOBILE = { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' };

async function ctxFor(b, mobile) {
  const ctx = await b.newContext(mobile ? MOBILE : { viewport: { width: 1440, height: 900 } });
  const writes = [];
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', '1'); } catch (e) {} });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { writes.push(u.pathname); return r.fulfill({ status: 403, body: 'qa: writes refused' }); }
    if (u.pathname === '/wizard/v1/apps') {
      const res = await r.fetch(); const j = await res.json().catch(() => ({ apps: [] }));
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...j, apps: [...(j.apps || []), ...EXTRA] }) });
    }
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || (mobile ? 'index.html' : 'desktop.html'), p = path.join(W, 'web', f);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : undefined;
        return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(p) });
      }
    }
    return r.continue();
  });
  return { ctx, writes };
}

(async () => {
  const b = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});

  // ---------- phone ----------
  {
    const { ctx, writes } = await ctxFor(b, true);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(ORIGIN + '?view=apps', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelectorAll('#launcherBody .lapp').length > 8, null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const r = await p.evaluate(() => {
      const tiles = [...document.querySelectorAll('#launcherBody .lgroup')].filter(g => /wizard apps/i.test(g.querySelector('h4')?.textContent || ''))
        .flatMap(g => [...g.querySelectorAll('.lapp')]);
      return {
        loaded: !!window.WizSigil,
        tiles: tiles.map(t => {
          const ic = t.querySelector('.ic'), gi = ic?.querySelector('.sgi'), cs = gi && getComputedStyle(gi);
          return { id: t.dataset.app, sgt: !!ic?.classList.contains('sgt'), glyph: [...(gi?.classList || [])].find(c => c.startsWith('sg-')) || '',
            letter: gi?.classList.contains('sgl') ? gi.textContent : '', c: ic?.style.getPropertyValue('--c').trim(),
            mask: cs ? (cs.maskImage || cs.webkitMaskImage || '') : '', w: ic?.getBoundingClientRect().width, h: gi?.getBoundingClientRect().height,
            emoji: /\p{Extended_Pictographic}/u.test(ic?.textContent || '') };
        }),
      };
    });
    ok(r.loaded, 'phone: WizSigil loaded');
    const T = Object.fromEntries(r.tiles.map(t => [t.id, t]));
    ok(r.tiles.length >= 10, `phone: Wizard apps group has tiles (${r.tiles.length})`);
    ok(r.tiles.every(t => t.sgt), 'phone: every Wizard app tile is a sigil tile', JSON.stringify(r.tiles.filter(t => !t.sgt).map(t => t.id)));
    ok(r.tiles.every(t => !t.emoji), 'phone: no emoji left on any app tile', JSON.stringify(r.tiles.filter(t => t.emoji).map(t => t.id)));
    const house = r.tiles.filter(t => !t.id.startsWith('qa-'));
    ok(house.every(t => t.glyph && /^url\("?data:image\/svg\+xml/.test(t.mask)), 'phone: every house app draws a glyph through an SVG mask', JSON.stringify(house.filter(t => !t.glyph).map(t => t.id)));
    ok(house.every(t => t.h > 30), 'phone: glyphs are drawn at tile size (>30px)', JSON.stringify(house.map(t => [t.id, t.h])));
    const cols = house.map(t => t.c.toLowerCase());
    ok(new Set(cols).size === cols.length, `phone: each app has its own colour (${new Set(cols).size}/${cols.length})`, JSON.stringify(house.map(t => [t.id, t.c])));
    for (const [id, g] of [['wizard', 'sg-chats'], ['wizard-signal', 'sg-signal'], ['wisdom', 'sg-wisdom'], ['shopping', 'sg-bag'], ['mizel', 'sg-mic'], ['files', 'sg-files']])
      if (T[id]) ok(T[id].glyph === g, `phone: ${id} wears ${g}`, T[id].glyph);
    ok(T['qa-owned'] && T['qa-owned'].glyph === 'sg-eye' && T['qa-owned'].c.toLowerCase() === '#ff3366', 'phone: launcher.json glyph + colour override wins', JSON.stringify(T['qa-owned']));
    ok(T['qa-plain'] && T['qa-plain'].letter === 'P' && /^#[0-9a-f]{6}$/i.test(T['qa-plain'].c), 'phone: app with no sigil shows its initial on its own colour', JSON.stringify(T['qa-plain']));
    // Views keep their sigils too.
    const views = await p.evaluate(() => [...document.querySelectorAll('#launcherBody .lapp[data-app^="v-"] .sgi')].map(e => e.className));
    ok(views.every(c => /sg-(day|week|month|inbox)/.test(c)), `phone: views wear sigils (${views.length})`, JSON.stringify(views));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'phone-launcher.png') });
    // Search rows: app hits, web/image search and the command row are sigils.
    await p.fill('#search', 'wis'); await p.waitForTimeout(400);
    const rows = await p.evaluate(() => [...document.querySelectorAll('#launcherBody .lrow .ic')].map(e => ({ sgt: e.classList.contains('sgt'), emo: e.classList.contains('emo'), g: e.querySelector('.sgi')?.className || '' })));
    ok(rows.filter(x => !x.emo).length >= 2 && rows.filter(x => !x.emo).every(x => x.sgt), 'phone: search rows (apps, search, command) are sigils', JSON.stringify(rows));
    ok(rows.some(x => /sg-bolt/.test(x.g)), 'phone: command row wears the bolt');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'phone-search.png') });
    // Opening an app: its window title bar wears the same sigil.
    await p.fill('#search', ''); await p.waitForTimeout(300);
    await p.click('#launcherBody .lapp[data-app="wisdom"]').catch(() => {});
    await p.waitForTimeout(1500);
    const bar = await p.evaluate(() => { const w = [...document.querySelectorAll('.win .wic')].find(e => e.getBoundingClientRect().width && e.querySelector('.sg-wisdom')); return !!w; });
    ok(bar, 'phone: an opened app window shows its sigil in the title bar');
    // Back closes the app window's layer and the shell stays up.
    await p.goBack().catch(() => {}); await p.waitForTimeout(600);
    ok(await p.evaluate(() => !!document.querySelector('#launcher')), 'phone: Back keeps Wizard open');
    ok(errs.length === 0, 'phone: no page errors', errs.join(' | '));
    ok(writes.length === 0, 'phone: zero writes', writes.join(','));
    await ctx.close();
  }

  // ---------- desktop ----------
  {
    const { ctx, writes } = await ctxFor(b, false);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(ORIGIN + 'desktop.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);
    await p.keyboard.press('Control+k'); await p.waitForTimeout(600);
    const pal = await p.evaluate(() => [...document.querySelectorAll('.pal-it')].filter(e => !e.querySelector('.ic')?.textContent.match(/✦/)).map(e => ({ nm: e.querySelector('.nm')?.firstChild?.textContent, sgt: !!e.querySelector('.ic.sgt') })));
    const apps = pal.filter(x => x.sgt);
    ok(apps.length >= 4, `desktop: palette app rows are sigils (${apps.length})`, JSON.stringify(pal.slice(0, 8)));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'desktop-palette.png') });
    await p.keyboard.press('Escape');
    const winbar = await p.evaluate(() => document.querySelectorAll('.wbar .ic.sgt').length);
    ok(winbar >= 1, `desktop: window title bars wear sigils (${winbar})`);
    ok(errs.length === 0, 'desktop: no page errors', errs.join(' | '));
    ok(writes.length === 0, 'desktop: zero writes', writes.join(','));
    await ctx.close();
  }

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
