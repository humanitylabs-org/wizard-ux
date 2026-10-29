#!/usr/bin/env node
/* App-level home-screen identity on each app's REAL page and path (Chromium, read-only).
 *   QA_OUT=<receipts> QA_ORIGIN=https://host:8444 QA_RESOLVE='MAP host ip' node qa-app-home-identity.cjs
 * Pre-deploy candidate mode: QA_WEB_ROOT=<candidate>/web QA_MANIFEST_ORIGIN=http://127.0.0.1:<port> serves only the
 * shell's own files (core/app-client.js, core/app-identity.js, install-icons/*) from the candidate and the
 * /wizard-os-home/install/at/ manifests from a candidate responder (packaging/app-install.py with
 * WIZARD_INSTALL_PORT, upstream = live registry). App pages, app assets and the registry stay live.
 * Not physical Safari/Android proof: Chromium manifest parsing and installability only. */
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:8796';
const out = process.env.QA_OUT;
if (!out) throw Error('Set QA_OUT to a private receipt directory');
fs.mkdirSync(out, { recursive: true });
const webRoot = process.env.QA_WEB_ROOT, manifestOrigin = process.env.QA_MANIFEST_ORIGIN;
const checks = [];
let failed = 0;
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); if (!pass) { failed++; console.log('FAIL', name, JSON.stringify(detail || '')); } };
// Apps whose page loads the shared SDK and has no manifest of its own: full identity expected.
const FULL = (process.env.QA_APPS || 'morning-report,wisdom,money,sniper,card-benefits,smart-home,wizard-calendar,notifications,wizard-search').split(',');
// Apps that ship their own manifest: theirs wins, ours is not added.
const OWN = (process.env.QA_OWN_APPS || 'wizard-music').split(',');

(async () => {
  const browser = await chromium.launch({ headless: true, args: process.env.QA_RESOLVE ? ['--host-resolver-rules=' + process.env.QA_RESOLVE] : [] });
  const context = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
    await ctx.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.fulfill({ status: 405, body: 'Read-only QA' });
      if (url.origin === origin && webRoot && /^\/wizard-os-home\/(core\/app-(client|identity)\.js|install-icons\/[a-z0-9-]+\.png)$/.test(url.pathname)) {
        const file = path.join(webRoot, url.pathname.replace('/wizard-os-home/', ''));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
        return route.fulfill({ path: file, headers: { 'content-type': file.endsWith('.png') ? 'image/png' : 'application/javascript' } });
      }
      if (url.origin === origin && manifestOrigin && url.pathname.startsWith('/wizard-os-home/install/at/')) {
        const res = await fetch(manifestOrigin + url.pathname + url.search, { headers: { Host: url.host } });
        return route.fulfill({ status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/plain' }, body: Buffer.from(await res.arrayBuffer()) });
      }
      return route.continue();
    });
    return ctx;
  };
  const ctx = await context();
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
  // Registry via the browser (honours QA_RESOLVE), never Node's resolver.
  await page.goto(origin + '/wizard/v1/apps');
  const apps = JSON.parse(await page.evaluate(() => document.body.innerText)).apps;
  const byId = Object.fromEntries(apps.map(a => [a.id, a]));
  const receipts = {};
  async function inspect(p, url) {
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('meta[name="apple-mobile-web-app-title"]') || document.querySelector('link[rel~="manifest"]:not([data-wizard-home])'), null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(500);
    const dom = await p.evaluate(() => ({
      title: document.title,
      manifests: [...document.querySelectorAll('link[rel~="manifest"]')].map(l => ({ href: l.href, ours: l.dataset.wizardHome !== undefined })),
      touch: [...document.querySelectorAll('link[rel~="apple-touch-icon"]')].map(l => l.href),
      appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content || null,
      capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content || null,
    }));
    const cdp = await p.context().newCDPSession(p);
    const manifest = await cdp.send('Page.getAppManifest').catch(e => ({ error: String(e) }));
    const installability = await cdp.send('Page.getInstallabilityErrors').catch(e => ({ error: String(e) }));
    await cdp.detach();
    let parsed = null; try { parsed = JSON.parse(manifest.data || 'null'); } catch (_) {}
    return { dom, manifestUrl: manifest.url, manifestErrors: manifest.errors, parsed, installability };
  }
  async function iconOK(p, src) {
    // In-page fetch: goes through Chromium (and QA_RESOLVE / candidate routes), same origin as the app page.
    return p.evaluate(async src => {
      const r = await fetch(src, { cache: 'no-store' }); const b = new Uint8Array(await r.arrayBuffer());
      const u32 = o => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      return { status: r.status, type: r.headers.get('content-type'), png: String.fromCharCode(b[1], b[2], b[3]) === 'PNG', size: b.length >= 24 ? [u32(16), u32(20)] : null };
    }, new URL(src, origin).href);
  }
  for (const id of FULL) {
    const app = byId[id];
    if (!app?.url) { check(id + ' registered with a path', false, app); continue; }
    const root = new URL(app.url, origin);
    const r = await inspect(page, root.href); receipts[id] = r;
    const ourLink = r.dom.manifests.find(m => m.ours);
    check(id + ' manifest link added (same origin, registry route)', ourLink && new URL(ourLink.href).origin === new URL(origin).origin && new URL(ourLink.href).pathname === '/wizard-os-home/install/at/' + root.pathname.split('/')[1] + '.webmanifest' && r.dom.manifests.length === 1, r.dom.manifests);
    check(id + ' apple-mobile-web-app-title = registry name', r.dom.appleTitle === app.name, { got: r.dom.appleTitle, want: app.name });
    check(id + ' apple-mobile-web-app-capable', r.dom.capable === 'yes');
    check(id + ' apple-touch-icon is the 180px house icon', r.dom.touch.length === 1 && /\/wizard-os-home\/install-icons\/[a-z0-9-]+-180\.png$/.test(r.dom.touch[0]), r.dom.touch);
    const m = r.parsed || {};
    check(id + ' Chromium parsed manifest without errors', r.parsed && !(r.manifestErrors || []).length, r.manifestErrors);
    check(id + ' name/short_name = registry name', m.name === app.name && m.short_name === app.name, { name: m.name, want: app.name });
    check(id + ' start_url/id/scope = app root', m.start_url === root.pathname + root.search && m.scope === root.pathname && m.id === root.pathname, { start_url: m.start_url, scope: m.scope, id: m.id });
    check(id + ' display standalone', m.display === 'standalone');
    const sizes = Object.fromEntries((m.icons || []).map(i => [i.sizes, i.src]));
    check(id + ' icons 192/512/180', sizes['192x192'] && sizes['512x512'] && sizes['180x180'], sizes);
    for (const [s, src] of Object.entries(sizes)) {
      const ic = await iconOK(page, src); const n = Number(s.split('x')[0]);
      check(`${id} icon ${s} 200 image/png ${n}px`, ic.status === 200 && ic.type === 'image/png' && ic.png && ic.size?.[0] === n && ic.size?.[1] === n, { src, ...ic });
    }
    check(id + ' Chromium installability errors empty', Array.isArray(r.installability.installabilityErrors) && r.installability.installabilityErrors.length === 0, r.installability);
  }
  // A deep URL (a specific report) still yields the app-root identity.
  {
    const deep = new URL('/morning-report/?date=2026-10-20', origin).href;
    const r = await inspect(page, deep); receipts['morning-report-deep'] = r;
    check('deep report URL: start_url still the app root', r.parsed?.start_url === '/morning-report/' && r.parsed?.scope === '/morning-report/' && r.parsed?.name === 'Morning Report', r.parsed);
    check('deep report URL: title meta is the app name, not the report title', r.dom.appleTitle === 'Morning Report', { appleTitle: r.dom.appleTitle, documentTitle: r.dom.title });
    check('deep report URL: installability clean', r.installability.installabilityErrors?.length === 0, r.installability);
  }
  // Apps with their own manifest keep it: ours is not added, missing apple tags are only filled in.
  for (const id of OWN) {
    const app = byId[id]; if (!app?.url) continue;
    const r = await inspect(page, new URL(app.url, origin).href); receipts[id] = r;
    check(id + ' own manifest kept, none added', r.dom.manifests.length === 1 && !r.dom.manifests[0].ours, r.dom.manifests);
    check(id + ' apple title filled from registry', r.dom.appleTitle === app.name, r.dom.appleTitle);
    check(id + ' at most one apple-touch-icon', r.dom.touch.length === 1, r.dom.touch);
  }
  // iPhone home-screen launch of a saved deep URL lands on the app root once; Chrome-like standalone does not.
  for (const [kind, ios] of [['ios-standalone', true], ['browser-tab', false]]) {
    const c = await context({ userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : undefined });
    await c.addInitScript(ios => { if (ios) Object.defineProperty(navigator, 'standalone', { value: true }); }, ios);
    const p = await c.newPage();
    await p.goto(new URL('/morning-report/?date=2026-10-20', origin).href);
    await p.waitForTimeout(2500);
    const landed = new URL(p.url());
    check(kind + (ios ? ' deep saved URL relaunches at app root' : ' deep URL left alone'), ios ? landed.pathname + landed.search === '/morning-report/' : landed.search === '?date=2026-10-20', p.url());
    if (ios) {
      await p.goto(new URL('/morning-report/?date=2026-10-19', origin).href); await p.waitForTimeout(1500);
      check('ios-standalone later in-app deep link not redirected (once per launch)', new URL(p.url()).search === '?date=2026-10-19', p.url());
    }
    await c.close();
  }
  // Unregistered segment: responder refuses, client adds nothing.
  {
    const status = await page.evaluate(async u => (await fetch(u)).status, origin + '/wizard-os-home/install/at/not-a-registered-app.webmanifest');
    check('unregistered path manifest 404', status === 404, status);
  }
  // Inside the shell (framed) nothing is added: the app's identity belongs to its own page only.
  {
    const r = await page.evaluate(async src => { const f = document.createElement('iframe'); f.src = src; document.body.append(f); await new Promise(res => f.onload = res); await new Promise(res => setTimeout(res, 1500)); return f.contentDocument.querySelectorAll('[data-wizard-home]').length; }, new URL('/morning-report/', origin).href);
    check('framed app page adds no home-screen tags', r === 0, r);
  }
  fs.writeFileSync(path.join(out, 'app-home-identity.json'), JSON.stringify({ origin, candidate: !!webRoot, checks, receipts }, null, 2));
  console.log(`${checks.length - failed}/${checks.length} checks passed${webRoot ? ' (candidate overlay)' : ''}`);
  await browser.close();
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
