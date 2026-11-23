'use strict';
// Forward to Wizard from an app opened from its own home-screen icon (wizard-ux issue 1745). Real Chromium at phone
// size, no native bridge, synthetic box (nothing read from or written to a real Wizard).
// A home-screen app runs the one-app page (index.html?app-session=<id>: the PWA's /wizard-os-home/install/<id>/ frames
// it, Android pins open it). A stand-in Messenger page uses the real app-client.js and calls WizardApp.share.wizard on a
// tap, like Messenger's Forward to Wizard. Fixed: the shell's Send to Wizard sheet opens over the app, and Send saves the
// message through the real Chats outbox, which starts a Wizard chat (POST /wizard/hermes/v1/runs carries the words and
// the uploaded picture). Checked on the one-app page (text only, with a picture, a tap before the Chats host has
// arrived) and in the full phone shell.
// QA_EXPECT=broken (QA_WEB=<main worktree>/web) asserts main answers 'unsupported' on the one-app page and opens no sheet.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://forward.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'share-wizard-evidence');
const EXPECT = process.env.QA_EXPECT || 'fixed';
const MESSENGER = { id: 'messenger', name: 'Messenger', url: '/messenger/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
// Messenger's own receipt handling (static/unified.js messageSelection send()), so the shots show what an owner sees.
const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Messenger</title>
<body style="margin:0;font:16px system-ui;background:#101318;color:#eef">
<header style="display:flex;gap:8px;align-items:center;padding:12px 14px;background:#1b2130"><button>Cancel</button><strong style="flex:1">2 selected</strong>
<button id="fwd" style="font:600 15px system-ui;padding:8px 12px;border-radius:18px;border:0;background:#8fb4ff">Forward to Wizard</button></header>
<p style="margin:14px;padding:10px;border-radius:12px;background:#2a3550">✓ Ann: are we still on for Friday?</p>
<p style="margin:14px;padding:10px;border-radius:12px;background:#2a3550">✓ Bob: yes, 7pm at the usual place</p>
<div id="toast" style="position:fixed;left:16px;right:16px;bottom:24px;padding:12px;border-radius:12px;background:#333a;display:none"></div>
<script src="/wizard-os-home/core/app-client.js"></script><script>
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0));
window.withPicture = false;
const toast = t => { const el = document.getElementById('toast'); el.textContent = t; el.style.display = 'block'; };
document.getElementById('fwd').onclick = async () => {
  window.outcome = 'pending';
  try {
    const files = window.withPicture ? [new File([PNG], 'Ann photo.png', { type: 'image/png' })] : [];
    const receipt = await WizardApp.share.wizard({ files, text: 'Ann: are we still on for Friday?\\n\\nBob: yes, 7pm at the usual place', title: 'Forwarded from Messenger' });
    window.outcome = receipt;
    toast(receipt === 'sent' ? 'Sent to Wizard' : receipt === 'cancelled' ? 'Share cancelled · selection kept' : 'Sharing unavailable · selection kept');
  } catch (e) { window.outcome = 'threw:' + e.message; toast(e.message); }
};
WizardApp.ready?.();
</script></body>`;
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const run of [
      { name: 'one-app-text', url: 'index.html?app-session=messenger' },
      { name: 'one-app-picture', url: 'index.html?app-session=messenger', picture: true },
      { name: 'one-app-early-tap', url: 'index.html?app-session=messenger', early: true },
      { name: 'full-shell-text', url: 'index.html', shell: true },
    ]) {
      if (EXPECT === 'broken' && run.shell) continue;
      const context = await browser.newContext({ viewport: { width: 412, height: 892 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      const posts = [], errors = [];
      await context.routeWebSocket('**/*', w => w.close());
      await context.addInitScript(app => {
        if (window !== top) return;
        localStorage.setItem('wux.apps.v1', JSON.stringify(app));
        for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
      }, [MESSENGER]);
      await context.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
        if (u.origin !== origin) return r.abort();
        if (p.startsWith(MESSENGER.url)) return r.fulfill({ body: PAGE, contentType: 'text/html' });
        if (!['GET', 'HEAD'].includes(method)) {
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/files/upload') { posts.push({ p, name: q.headers()['x-wizard-filename'] }); return r.fulfill({ json: { file: { id: 'upload-1', filename: q.headers()['x-wizard-filename'], mime: 'image/png', bytes: 68 } } }); }
          if (p === '/wizard/hermes/api/sessions') { posts.push({ p }); return r.fulfill({ json: { ok: true } }); }
          if (p === '/wizard/hermes/v1/runs') { posts.push({ p, body: q.postData() || '' }); return r.fulfill({ json: { run_id: 'run-1', status: 'started' } }); }
          return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
        }
        if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
        if (p.startsWith(prefix)) {
          const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
          if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
          if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
          return r.fulfill({ status: 404, body: 'No synthetic static asset' });
        }
        if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [MESSENGER] } });
        if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running' }] } });
        if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
        if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
        return r.fulfill({ json: ownerRead(p) });
      });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      // The one-app page never fires load (pin-doc.js stops the rest of index.html).
      await page.goto(origin + prefix + run.url, { waitUntil: run.shell ? 'load' : 'commit' });
      if (run.shell) {
        await page.waitForFunction(() => !!window.__wos?.openApp, null, { timeout: 20000 }); await nap(2500);
        await page.evaluate(() => { document.getElementById('wosWelcome')?.remove(); (window.WizOpenApp || window.__wos.openApp)('messenger'); });
      }
      const app = page.frameLocator('iframe[src*="/messenger/"], iframe.appframe').first();
      await app.locator('#fwd').waitFor({ timeout: 20000 });
      const frame = page.frames().find(f => f.url().includes('/messenger/'));
      if (!run.early) await nap(1500);
      if (run.picture) await frame.evaluate(() => { window.withPicture = true; });
      console.error('run', run.name);
      const early = run.early ? await page.evaluate(() => !window.__wos?.chats) : null;
      await app.locator('#fwd').tap();
      const sheet = page.locator('.wz-share [data-sharesend]');
      const opened = await sheet.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
      const row = { run: run.name, early, opened };
      if (EXPECT === 'broken') {
        await frame.waitForFunction(() => window.outcome && window.outcome !== 'pending', null, { timeout: 8000 });
        row.outcome = await frame.evaluate(() => window.outcome);
        await page.screenshot({ path: path.join(out, `${run.name}-broken.png`) });
        report.push(row);
        assert.equal(opened, false, `${run.name}: main opens no Send to Wizard sheet`);
        assert.equal(row.outcome, 'unsupported', `${run.name}: main answers unsupported`);
        await context.close(); continue;
      }
      assert.equal(opened, true, `${run.name}: the Send to Wizard sheet opens`);
      await page.waitForFunction(() => !document.querySelector('.wz-share [data-sharesend]')?.disabled, null, { timeout: 8000 });
      const box = await page.locator('.wz-share .dv-sheet').boundingBox();
      assert.ok(box && box.width >= 400 && box.height > 300, `${run.name}: the sheet is on screen over the app (${JSON.stringify(box)})`);
      assert.match(await page.locator('.wz-share .dv-head small').innerText(), /Forwarded from Messenger/);
      assert.match(await page.locator('.wz-share .dv-quote').innerText(), /Ann: are we still on for Friday\?/);
      if (run.picture) assert.equal(await page.locator('.wz-share .ch-att, .wz-share [data-attkey]').count() > 0, true, 'the picture is listed in the sheet');
      await page.screenshot({ path: path.join(out, `${run.name}-sheet.png`) });
      await sheet.tap();
      await page.locator('.wz-share').waitFor({ state: 'detached', timeout: 8000 });
      await frame.waitForFunction(() => window.outcome && window.outcome !== 'pending', null, { timeout: 8000 });
      row.outcome = await frame.evaluate(() => window.outcome);
      for (let i = 0; i < 60 && !posts.some(x => x.p === '/wizard/hermes/v1/runs'); i++) await nap(250);
      const sent = posts.find(x => x.p === '/wizard/hermes/v1/runs');
      row.posts = posts.map(x => x.p);
      await page.screenshot({ path: path.join(out, `${run.name}-sent.png`) });
      report.push(row);
      assert.equal(row.outcome, 'sent', `${run.name}: Messenger gets 'sent'`);
      assert.ok(sent, `${run.name}: the message is delivered to a Wizard chat (POST /wizard/hermes/v1/runs)`);
      assert.match(sent.body, /Ann: are we still on for Friday\?/, `${run.name}: the forwarded words are in the chat message`);
      assert.match(sent.body, /Bob: yes, 7pm at the usual place/);
      if (run.picture) {
        assert.ok(posts.some(x => x.p === '/wizard/files/upload' && x.name === 'Ann photo.png'), 'the picture was uploaded');
        assert.match(sent.body, /upload-1/, 'the uploaded picture rides with the message');
      }
      if (run.name.startsWith('one-app')) assert.equal(await frame.evaluate(() => !!document.getElementById('fwd')), true, 'the app frame stays in place');
      assert.deepEqual(errors, [], `${run.name}: no page errors`);
      await context.close();
    }
    console.log(JSON.stringify({ expect: EXPECT, web, report }, null, 1));
    console.log('PASS', EXPECT);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
