'use strict';
// wizard-ux issue 1725 in a real browser: the owner's chat bubble stands apart from the window it sits on. Opens one
// thread (an owner message + an agent reply) in the desktop shell (Classic and AI apps views, 1440x900) and the phone
// shell (412x915) for each skin in QA_SKINS, reads the painted colours from Chromium and measures the owner bubble
// against what shows around it (the agent reply's surface) and the bubble text against the bubble.
// QA_WEB=<main>/web QA_EXPECT=broken checks the bug on main; QA_OUT=<dir> keeps the screenshots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://owner-bubble.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'owner-bubble-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const AGENTS = [{ id: 'hermes', label: 'Archimedes', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
const ROW = { id: 'qa-t1', title: 'Weekend plans', runtime: 'direct', status: 'completed', updated_at: iso(now - 6e5), updatedAt: iso(now - 6e5), last_active: (now - 6e5) / 1000, message_count: 2, messageCount: 2, archived: false, preview: 'Here is a plan.' };
const MSGS = [{ role: 'user', content: 'Can you plan a walk for Saturday morning?', timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Here is a plan: start at the lake at nine and walk the ridge.', timestamp: now / 1000 - 590 }];
const SKINS = (process.env.QA_SKINS || 'landscapes-light,landscapes,obsidian-light,nebula').split(',');
const SHELLS = (process.env.QA_SHELLS || 'desktop-classic,desktop-ai-apps,phone').split(',');
// sRGB contrast over an opaque base.
const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`, entry = { stem, errors: [] }; report.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block',
        ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ phone, skin, view }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': phone ? 'phone' : 'desktop', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            ...(view ? { 'wos.desktop-view.v1': view } : {}) })) localStorage.setItem(k, v);
        }, { phone, skin, view: shell === 'desktop-classic' ? 'classic' : shell === 'desktop-ai-apps' ? 'ai-apps' : null });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [ROW], has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) return decodeURIComponent(m[1]) !== ROW.id ? r.fulfill({ status: 404, json: {} }) : r.fulfill({ json: m[2] ? { messages: MSGS } : { session: ROW } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active, null, { timeout: 30000 });
        await page.waitForFunction(() => window.WizLive?.ok, null, { timeout: 20000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.evaluate(([phone, sid]) => phone ? __wos.openWizardThread(sid) : __wux.openThread(sid), [phone, ROW.id]);
        await page.waitForFunction(() => [...document.querySelectorAll('.msg.u .bub')].some(b => b.getClientRects().length && b.textContent.includes('Saturday')), null, { timeout: 20000 });
        await page.evaluate(() => document.fonts.ready); await nap(1200);
        // Pixel truth: sample the screenshot inside the owner bubble and inside the agent reply's surface (beside it).
        const u = await page.locator('.msg.u .bub').filter({ visible: true }).first().boundingBox();
        const a = await page.locator('.msg.a .bub').filter({ visible: true }).first().boundingBox();
        const shotPath = path.join(out, `${stem}.png`); await page.screenshot({ path: shotPath });
        const cdp = await context.newCDPSession(page);
        const px = async (x, y) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: 1, height: 1, scale: 1 } }); return data; };
        const sample = await page.evaluate(async ([pu, pa]) => {
          const dec = async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); };
          return { owner: await dec(pu), reply: await dec(pa) };
        }, [await px(u.x + 3, u.y + u.height / 2), await px(a.x + a.width - 3, a.y + 2)]);
        // Ink: the bubble text colour over the bubble.
        const ink = await page.locator('.msg.u .bub').filter({ visible: true }).first().evaluate(b => getComputedStyle(b).color);
        const rgb = ink.match(/[\d.]+/g).map(Number), alpha = rgb[3] ?? 1, text = rgb.slice(0, 3).map((v, i) => Math.round(v * alpha + sample.owner[i] * (1 - alpha)));
        Object.assign(entry, { owner: sample.owner, reply: sample.reply, surface: +contrast(sample.owner, sample.reply).toFixed(2), text: +contrast(text, sample.owner).toFixed(2), shot: shotPath });
        if (!phone && skin === 'landscapes-light' && broken) assert.ok(entry.surface < 1.4, 'main: the bug shows ' + JSON.stringify(entry));
        else { assert.ok(entry.surface >= 1.4, 'owner bubble stands apart ' + JSON.stringify(entry)); assert.ok(entry.text >= 4.5, 'AA text ' + JSON.stringify(entry)); }
        entry.pass = true;
      } catch (e) { entry.fail = String(e.message || e).slice(0, 400); } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
  for (const r of report) console.log(r.stem, r.pass ? 'pass' : 'FAIL', 'surface', r.surface, 'text', r.text, 'owner', r.owner, 'reply', r.reply, r.fail || '');
  if (report.some(r => !r.pass)) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
