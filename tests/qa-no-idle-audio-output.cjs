'use strict';
// wizard-ux issue 1723 in a real browser: opening and tapping around Wizard must not hold an audio output open.
// A running AudioContext is an output stream (a multipoint Bluetooth speaker switches to the phone that streams, even
// silence), so: the phone shell loads and takes 30 s of taps with no running AudioContext; the assist surface takes
// taps with none either; its chime() opens one and lets go within 1 s of the tone ending; sound.muted opens none.
// QA_WEB=<main>/web QA_ASSIST=<main>/android/app/src/main/assets/assist QA_EXPECT=broken shows the bug on main.
// QA_TAP_MS shortens the 30 s tapping (default 30000).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://idle-audio.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web');
const assist = process.env.QA_ASSIST || path.join(repo, 'android/app/src/main/assets/assist');
const broken = process.env.QA_EXPECT === 'broken', tapMs = Number(process.env.QA_TAP_MS || 30000);
const nap = ms => new Promise(r => setTimeout(r, ms));

// Counts every AudioContext the page makes and whether it is running (an open output) right now.
function spy() {
  const Real = window.AudioContext || window.webkitAudioContext; if (!Real) return;
  const made = window.__audioMade = [];
  class Spy extends Real { constructor(...a) { super(...a); made.push(this); } }
  window.AudioContext = Spy; if (window.webkitAudioContext) window.webkitAudioContext = Spy;
  window.__audioOpen = () => made.filter(c => c.state === 'running').length;
}
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';

async function shellCase(browser) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: UA });
  try {
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(spy);
    await context.addInitScript(() => {
      if (window !== top) return;
      for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done' })) localStorage.setItem(k, v);
    });
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname;
      if (u.origin !== origin) return r.abort();
      if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ json: { ok: true } });
      if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
      if (p.startsWith(prefix)) {
        const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
        if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
        return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
      }
      if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
      if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: [{ id: 'hermes', label: 'Archimedes', harness: 'hermes', is_default: true, status: 'running' }] } });
      if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + prefix + 'index.html?phone');
    await page.waitForFunction(() => window.__wos && window.WizardMotion, null, { timeout: 20000 });
    await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
    const spots = [[206, 300], [100, 600], [300, 450], [206, 820], [60, 120], [350, 700]];
    const end = Date.now() + tapMs; let taps = 0, most = 0;
    while (Date.now() < end) {
      const [x, y] = spots[taps % spots.length];
      await page.touchscreen.tap(x, y).catch(() => {}); await page.mouse.click(x, y).catch(() => {}); taps++;
      await nap(400); most = Math.max(most, await page.evaluate(() => window.__audioOpen()));
    }
    const made = await page.evaluate(() => window.__audioMade.length);
    return { taps, made, most, errors };
  } finally { await context.close(); }
}

async function assistCase(browser) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, userAgent: UA });
  try {
    await context.addInitScript(spy);
    const page = await context.newPage();
    await page.goto('file://' + path.join(assist, 'surface.html'));
    await page.waitForFunction(() => window.WizardMotion);
    for (const [x, y] of [[206, 300], [100, 600], [300, 450]]) { await page.mouse.click(x, y); await nap(150); }
    const afterTaps = await page.evaluate(() => ({ made: window.__audioMade.length, open: window.__audioOpen() }));
    // A muted chime makes nothing.
    const muted = await page.evaluate(() => { const S = WizardMotion.sound, before = window.__audioMade.length; S.muted = true; WizardMotion.chime('sent'); S.muted = false; return window.__audioMade.length - before; });
    // A chime plays (an open, running context), then lets go within 1 s of its tone ending.
    await page.mouse.click(206, 300);
    const chimed = await page.evaluate(async () => { WizardMotion.chime([523, .3, .07]); await new Promise(r => setTimeout(r, 60)); return window.__audioOpen(); });
    await nap(300 + 1000);
    const afterTone = await page.evaluate(() => window.__audioOpen());
    // Two chimes in a row share the open output and still let go after the last one.
    const twice = await page.evaluate(async () => { WizardMotion.chime([660, .3, .08]); await new Promise(r => setTimeout(r, 200)); WizardMotion.chime([880, .3, .05]); await new Promise(r => setTimeout(r, 200)); return window.__audioOpen(); });
    await nap(400 + 1000);
    const afterTwice = await page.evaluate(() => window.__audioOpen());
    return { afterTaps, muted, chimed, afterTone, twice, afterTwice };
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const shell = await shellCase(browser), surface = await assistCase(browser);
    console.log(JSON.stringify({ shell, surface }));
    if (broken) {
      assert.ok(shell.most > 0, 'main: tapping the shell opens an audio output');
      assert.ok(surface.afterTaps.open > 0, 'main: tapping the assist surface opens an audio output');
      assert.ok(surface.afterTone > 0, 'main: the output stays open after a chime');
      console.log('broken as expected on main'); return;
    }
    assert.ok(shell.taps >= 10, 'tapped the shell');
    assert.equal(shell.made, 0, 'the phone shell makes no AudioContext while opened and tapped');
    assert.equal(shell.most, 0, 'no audio output is open while the shell is tapped');
    assert.equal(surface.afterTaps.made, 0, 'taps on the assist surface make no AudioContext');
    assert.equal(surface.muted, 0, 'a muted chime makes no AudioContext');
    assert.equal(surface.chimed, 1, 'a chime opens one running output');
    assert.equal(surface.afterTone, 0, 'the output is let go within 1 s of the tone ending');
    assert.equal(surface.twice, 1, 'chimes close together share one output');
    assert.equal(surface.afterTwice, 0, 'and let go after the last one');
    console.log('ok: no idle audio output');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
