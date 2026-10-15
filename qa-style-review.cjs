/* Real-shell Appearance v1 acceptance. Read-only against a running Wizard shell: every non-GET request is refused
 * inside this isolated browser context, except to disposable QA apps injected below. No box settings, apps or data
 * are written. The release reviewer must inspect the captured screenshots, not only these assertions.
 *
 * Env:
 *   QA_URL          (required) the shell entry, e.g. https://<box>.<tailnet>.ts.net/wizard-os-home/
 *   PLAYWRIGHT_PATH resolvable playwright module          STYLE_ROOT  this folder (default)
 *   QA_SHOTS        screenshot + receipt folder           QA_APPS     installed app ids (default topics,wizard-music,wizard-signal,wisdom)
 *   QA_DEVICE       Playwright device profile (default Pixel 7)
 *   QA_INJECT       JSON [{id,name,prefix,upstream|dir}]  disposable apps added to the registry for this context only:
 *                   `upstream` proxies to a local container (writes allowed: it is disposable); `dir` serves files (`index` names its entry page).
 * Imported from wizard-os integration/style-review-20261015 at f3f99a886eec5b5a457805a2f8771fc2d72c8444.
 * QA_CANDIDATE_HOST optionally overlays only the candidate host for pre-promotion QA.
 * Unset it and QA_INJECT for direct live verification; no appearance client replacement is performed. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = process.env.STYLE_ROOT || __dirname;
const url = process.env.QA_URL; if (!url) throw new Error('Set QA_URL to the shell entry URL.');
const shots = path.resolve(process.env.QA_SHOTS || 'style-qa-shots'); fs.mkdirSync(shots, { recursive: true });
const tokens = JSON.parse(fs.readFileSync(path.join(root, 'tokens.json')));
const client = fs.readFileSync(path.join(root, 'appearance-client.js'), 'utf8');
const inject = JSON.parse(process.env.QA_INJECT || '[]');
const apps = (process.env.QA_APPS ?? 'topics,wizard-music,wizard-signal,wisdom').split(',').filter(Boolean).concat(inject.map(a => a.id));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const transparent = 'rgba(0, 0, 0, 0)';
const checks = [], report = {}, issues = [], liveAssets = {}, assetReads = [], assetReadWarnings = [];
const desktop = process.env.QA_DEVICE === 'Desktop Chrome';
const mark = (name, ok, detail) => { if (!ok) throw new Error('FAILED: ' + name + (detail ? ' ' + JSON.stringify(detail) : '')); checks.push(name); };

(async () => {
  const browser = await pw.chromium.launch();
  try {
    // A real phone profile (touch + mobile UA): a bare narrow viewport is redirected to the desktop shell.
    const context = await browser.newContext({ ...pw.devices[process.env.QA_DEVICE || 'Pixel 7'], ignoreHTTPSErrors: true });
    context.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (response.status() === 200 && response.request().method() === 'GET' && /\/(?:skins\.(?:js|css)|appearance-host\.(?:js|css)|app-client\.js)$/.test(pathname)) {
        assetReads.push(response.body().then(body => {
          if (!body.length) return; // Ignore empty preload/navigation responses.
          const hash = require('node:crypto').createHash('sha256').update(body).digest('hex');
          (liveAssets[pathname] ||= []).push(hash);
        }).catch(error => { assetReadWarnings.push({asset:pathname,error:error.message}); }));
      }
    });
    await context.addInitScript(() => localStorage.setItem('wos.coached', 'true'));
    await context.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      const qa = inject.find(a => u.pathname.startsWith(a.prefix));
      if (qa && qa.upstream) {
        const target = qa.upstream.replace(/\/$/, '') + '/' + u.pathname.slice(qa.prefix.length) + u.search;
        const headers = { ...req.headers() }; delete headers.host;
        return route.fulfill({ response: await route.fetch({ url: target, headers }) });
      }
      if (qa && qa.dir) {
        const f = path.join(qa.dir, path.normalize(u.pathname.slice(qa.prefix.length) || qa.index || 'index.html'));
        if (!f.startsWith(qa.dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      }
      if (!['GET', 'HEAD'].includes(req.method())) return route.fulfill({ status: 403, body: 'Read-only QA' });
      // Candidate-only host overlay; leave unset for direct, uninjected live verification.
      if (process.env.QA_CANDIDATE_HOST && u.pathname.endsWith('/core/appearance-host.js'))
        return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.QA_CANDIDATE_HOST) });
      if (/\/wizard\/v1\/apps\/?$/.test(u.pathname) && inject.length) {
        const r = await route.fetch(); const body = await r.json();
        for (const a of inject) body.apps.push({ id: a.id, name: a.name, desc: 'Disposable style QA app', url: a.url || a.prefix, icon: '✓', colors: ['#b99bff', '#7fd8ff'], source: 'qa' });
        return route.fulfill({ response: r, json: body });
      }
      return route.continue();
    });

    // Exercise the shipped entry and visible controls before testing app appearance.
    const skinPage = await context.newPage();
    await skinPage.goto(url + '?view=skin', {waitUntil:'domcontentloaded'});
    await skinPage.waitForSelector('[data-skinpick="grove"]');
    for (const skin of Object.keys(tokens.skins)) {
      await skinPage.click(`[data-skinpick="${skin}"]`);
      await skinPage.waitForFunction(s => document.documentElement.dataset.skin === s, skin);
      mark(skin + ': visible Skin control applies selection', await skinPage.locator(`[data-skinpick="${skin}"]`).getAttribute('aria-pressed') === 'true');
    }
    await skinPage.screenshot({path:path.join(shots, 'skin-entry.png')});
    await Promise.all(assetReads);
    await skinPage.close();
    for (const app of apps) {
      const page = await context.newPage();
      const rec = report[app] = { client: null, views: {}, back: [] };
      await page.goto(url + '?open=' + encodeURIComponent(app), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(id => Object.values((window.__wos || window.__wux)?.wins || {}).some(w => w.appId === id), app, { timeout: 30000 });
      const winId = await page.evaluate(id => Object.entries((window.__wos || window.__wux).wins).filter(([, w]) => w.appId === id).pop()[0], app);
      let chatsId = null;
      if (desktop) chatsId = await page.evaluate(id => { const w = Object.values(window.__wux.wins).find(w => w.app === 'chats') || window.__wux.newWin({app:'chats'}); window.__wux.focusWin(id); return w.id; }, winId);
      const winSel = `.win[data-win="${winId}"]`;
      mark(app + ': expected shell profile', await page.evaluate(d => document.documentElement.dataset.shell === (d ? 'desktop' : 'phone'), desktop));
      const frame = await (await page.waitForSelector(winSel + ' iframe', { timeout: 30000 })).contentFrame();
      mark(app + ' cold canonical entry opens its frame', !!frame);
      await frame.waitForLoadState('load');
      // The shell marks the window themed only after the document acknowledged a context.
      await page.waitForFunction(sel => document.querySelector(sel)?.classList.contains('wz-themed'), winSel, { timeout: 20000 })
        .catch(() => { throw new Error(`FAILED: ${app} never acknowledged an appearance context (window not .wz-themed)`); });
      rec.client = await frame.evaluate(() => [...document.scripts].some(s => /wizard-appearance\.js|theme-client\.js|appearance-client\.js/.test(s.src)) ? 'candidate appearance client' : 'shell app-client.js');
      rec.path = await frame.evaluate(() => location.pathname);
      // Let the app finish its first content load so screenshots show real content, not a spinner.
      await frame.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await frame.evaluate(() => { window.__styleQAIdentity = {}; });
      const before = await frame.evaluate(() => ({ url: location.href, type: getComputedStyle(document.querySelector('h1,h2,main') || document.body).fontFamily }));
      const hasDraft = await frame.locator('.wz-input').count();
      if (hasDraft) await frame.locator('.wz-input').fill('Appearance review: keep this draft');
      const hasDemoSheet = await frame.locator('#open').count();
      if (hasDemoSheet) await frame.locator('#open').click();
      for (const skin of Object.keys(tokens.skins)) {
        // Device-local preference in this throwaway context; the box settings write is refused above.
        await page.evaluate(id => WosSkin.set(id), skin);
        for (const pres of ['window', 'immersive']) {
          const isFull = await page.evaluate(([sel,d]) => d ? window.__wux.ws[window.__wux.cur].mono : document.querySelector(sel).classList.contains('full'), [winSel,desktop]);
          // Enter through the visible window-bar button; leave through the shell's own API (full screen hides the bar).
          if (pres === 'immersive' && !isFull) await page.click(winSel + (desktop ? ' [data-wact="mono"]' : ' [data-wact="full"]'));
          if (pres === 'window' && isFull) { if (desktop) await page.evaluate(sel => document.querySelector(sel + ' [data-wact="mono"]').click(), winSel); else await page.evaluate(id => window.__wos.setFull(id, false), winId); }
          await page.waitForFunction(([sel, s, p]) => {
            const f = document.querySelector(sel + ' iframe'); const st = window.WizAppearance?.inspect().find(x => x.src === f.getAttribute('src'));
            const el = f.contentDocument?.documentElement; return st && st.acked && el?.dataset.skin === s;
          }, [winSel, skin, pres], { timeout: 10000 }).catch(() => { throw new Error(`FAILED: ${app} ${skin} ${pres} context not applied`); });
          await page.waitForTimeout(300);
          const actualPresentation = await frame.evaluate(() => document.documentElement.dataset.presentation);
          if (actualPresentation !== pres) issues.push({app,skin,expectedPresentation:pres,actualPresentation,owner:'wizard-ux appearance-host.js'});
          else mark(`${app} ${skin} ${pres}: presentation delivered`, true);
          await page.waitForTimeout(250);
          const o = await frame.evaluate(names => {
            const cs = getComputedStyle(document.documentElement);
            return { html: cs.backgroundColor, body: getComputedStyle(document.body).backgroundColor, scheme: cs.colorScheme, url: location.href,
              type: getComputedStyle(document.querySelector('h1,h2,main') || document.body).fontFamily, identity: !!window.__styleQAIdentity,
              vars: Object.fromEntries(names.map(k => [k, cs.getPropertyValue('--wz-' + k).trim()])) };
          }, Object.keys(tokens.skins[skin].tokens));
          const c = await page.evaluate(sel => {
            const win = document.querySelector(sel), f = win.querySelector('iframe'), chain = [];
            for (let el = f; el && el !== win; el = el.parentElement) chain.push({ el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''), bg: getComputedStyle(el).backgroundColor });
            const probe = document.createElement('div'); probe.style.background = 'var(--sk-win)'; win.appendChild(probe);
            const material = getComputedStyle(probe).backgroundColor; probe.remove();
            return { chain, win: getComputedStyle(win).backgroundColor, material, themed: win.classList.contains('wz-themed') };
          }, winSel);
          const tag = `${app} ${skin} ${pres}`;
          mark(tag + ': app canvas transparent', o.html === transparent && o.body === transparent, o);
          mark(tag + ': frame-to-window chain transparent', c.themed && c.chain.every(x => x.bg === transparent), c.chain);
          const expectedMaterial = desktop ? await page.evaluate(id => getComputedStyle(document.querySelector(`.win[data-win="${id}"]`)).backgroundColor, chatsId) : c.material;
          mark(tag + ': window paints the same material as Chats', c.win === expectedMaterial, { win: c.win, material: expectedMaterial });
          // Same colour, any notation: the shell sends computed rgba(), tokens.json records hex.
          const roles = ['text', 'text-secondary', 'accent', 'base', 'border'];
          const cmp = await frame.evaluate(([pairs]) => pairs.map(([a, b]) => { const r = v => { const e = document.createElement('i'); e.style.color = v; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; }; return [r(a), r(b)]; }),
            [roles.map(k => [o.vars[k], tokens.skins[skin].tokens[k]])]);
          mark(tag + ': exact ink, accent, base, border roles', cmp.every(([a, b]) => a === b), { got: o.vars, cmp });
          mark(tag + ': document retained (no reload, same URL and type)', o.identity && o.url === before.url && o.type === before.type);
          rec.views[skin + ':' + pres] = { window: c.win, material: c.material, ink: o.vars.text, accent: o.vars.accent, scheme: o.scheme };
          if (hasDraft) mark(tag + ': unsent form survives', await frame.locator('.wz-input').inputValue() === 'Appearance review: keep this draft');
          if (hasDemoSheet) {
            mark(tag + ': open sheet survives', await frame.locator('#sheet').evaluate(e=>e.open));
            await frame.locator('#close').click();
          }
          await page.waitForTimeout(3500); // Let shell fullscreen coaching clear before visual evidence.
          await page.screenshot({ path: path.join(shots, `${app}-${skin}-${pres}.png`) });
          if (hasDemoSheet) await frame.locator('#open').click();
        }
      }
      if (hasDemoSheet) await frame.locator('#close').click();
      if (desktop) await page.evaluate(sel => document.querySelector(sel + ' [data-wact="mono"]').click(), winSel); else await page.evaluate(id => window.__wos.setFull(id, false), winId);
      // Back: an open in-app sheet closes first (nested); the next Back is the shell's own step (root).
      const hasSheet = await frame.evaluate(() => { const d = document.querySelector('dialog'); if (d && !d.open && typeof window.__wizardCloseOverlay === 'function') { d.showModal(); return true; } return false; });
      if (hasSheet) {
        const r1 = await page.evaluate(() => window.__wosNativeBack ? window.__wosNativeBack() : window.__wux.escStep());
        const open = await frame.evaluate(() => document.querySelector('dialog').open);
        mark(app + ' nested Back closes the in-app sheet inside its window', !!r1 && !open && (await page.$(winSel)) !== null, { r1, open });
        rec.back.push('nested:' + r1);
        const r2 = await page.evaluate(() => window.__wosNativeBack ? window.__wosNativeBack() : window.__wux.escStep());
        mark(app + ' root Back passes to the shell', r2 !== 'hosted', { r2 });
        rec.back.push('root:' + r2);
        mark(app + ': root Back stays in Wizard', !page.isClosed() && page.url().startsWith(url.split('?')[0]));
        // Exercise browser Back too, not only the native adapter callback.
        await page.goBack(); await page.waitForTimeout(300);
        mark(app + ': browser Back stays in Wizard', !page.isClosed() && page.url().includes('/wizard-os-home/'));
      } else rec.back.push('first:' + await page.evaluate(() => window.__wosNativeBack ? window.__wosNativeBack() : window.__wux.escStep()));
      await Promise.all(assetReads);
      await page.close();
    }
    await Promise.all(assetReads);
    for (const key of Object.keys(liveAssets)) liveAssets[key] = [...new Set(liveAssets[key])];
    for (const warning of assetReadWarnings) if (!liveAssets[warning.asset]?.length) issues.push(warning);
    await context.close();
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(shots, 'receipt.json'), JSON.stringify({ host: require('node:os').hostname(), status: issues.length ? 'ISSUES' : 'PASS', issues, liveAssets, assetReadWarnings, browserOnlyInjection: inject.length > 0, entry: url + '?open=' + apps[0], device: process.env.QA_DEVICE || 'Pixel 7', count: checks.length, apps: report, checks, source: tokens.source.revision,
    scope: inject.length || process.env.QA_CANDIDATE_HOST ? 'candidate overlay; NOT live acceptance' : 'direct served app and host; no registry, asset or client injection; production writes blocked', hostOverlay: !!process.env.QA_CANDIDATE_HOST }, null, 2));
  console.log(`${checks.length} PASS checks; ${issues.length} issues`);
  if (issues.length) process.exitCode = 2;
})().catch(e => { console.error(e); process.exitCode = 1; });
