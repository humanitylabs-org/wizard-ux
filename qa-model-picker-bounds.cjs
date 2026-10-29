'use strict';
// James: "How am I supposed to pick a model here" (tall draft hid the model rows).
// Full shared shell, deterministic catalogue, NO real agents or network writes.
// QA_TREE points at baseline/candidate; this script stays identical for A/B.
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname;
const OUT = process.env.QA_OUT || path.join(process.env.TMPDIR || '/tmp', 'model-picker-bounds');
fs.mkdirSync(OUT, { recursive: true });
const CATALOGUE = { model: 'claude-opus-5-5', provider: 'anthropic', providers: [
  { slug: 'anthropic', authenticated: true, is_current: true, models: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-5'] },
  { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-terra', 'gpt-6-luna', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'] }
] };
const AGENTS = { agents: [
  { id: 'hermes', label: 'Hermes', is_default: true, harness: 'hermes', privacy: 'standard', status: 'running' },
  { id: 'private', label: 'Private', harness: 'hermes', privacy: 'private', status: 'running', model: { provider: 'tinfoil', model: 'glm-5-3', allowed_models: ['glm-5-3', 'kimi-k3'], fallback: false } }
] };
let pass = 0, fail = 0, blockedWrites = 0, foreignRequests = 0;
function ok(v, n, d) { v ? pass++ : fail++; console.log(`${v ? 'PASS' : 'FAIL'} ${n}${v || d === undefined ? '' : ' ' + JSON.stringify(d)}`); }
async function boot(browser, c) {
  const desktop = c.mode === 'desktop';
  const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, serviceWorkers: 'block',
    ...(desktop ? {} : { isMobile: true, hasTouch: true, deviceScaleFactor: 1,
      userAgent: `Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36${c.mode === 'native' ? ' WizardOS-DocScroll' : ''}` }) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    const json = x => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.hostname !== 'wizard.test') { foreignRequests++; return r.abort(); }
    if (!['GET', 'HEAD'].includes(q.method())) { blockedWrites++; return json({}); }
    if (u.pathname === '/wizard/hermes/api/model/options') return json(CATALOGUE);
    if (u.pathname === '/wizard/v1/agents') return json(AGENTS);
    if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: 1, threads: {} } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json({ data: [], has_more: false });
    if (u.pathname.startsWith('/wizard/') || u.pathname.startsWith('/wizard-claude/') || u.pathname.startsWith('/wizard-tinfoil/')) return json({});
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (!m) return r.fulfill({ status: 404, body: '' });
    const rel = m[1] || 'index.html', file = path.join(TREE, 'web', rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return r.fulfill({ status: 404, body: '' });
    const types = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };
    return r.fulfill({ status: 200, contentType: types[path.extname(file)] || 'application/javascript', body: fs.readFileSync(file) });
  });
  await ctx.addInitScript(skin => {
    localStorage.setItem('wos.skin', skin); localStorage.setItem('wos.coached', 'true');
    localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1');
  }, c.skin);
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`https://wizard.test/wizard-os-home/${desktop ? 'desktop.html' : ''}`, { waitUntil: 'load' });
  const root = desktop ? '__wux' : '__wos';
  await p.waitForFunction(root => window[root]?.chats, root);
  if (!desktop) await p.evaluate(() => __wos.openApp(WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')));
  await p.waitForFunction(root => Object.values(window[root].wins).some(w => w.app === 'chats'), root);
  await p.evaluate(root => {
    const a = window[root], w = Object.values(a.wins).find(w => w.app === 'chats');
    a.chats.openNewDraft(w.id, '');
    window.qaWid = w.id;
  }, root);
  await p.waitForFunction(() => WosModels.ready && WosAgents.ready);
  await p.locator(`[data-chats="${await p.evaluate(() => qaWid)}"] .ch-compose textarea`).waitFor({ state: 'visible' });
  return { ctx, p, errs, root };
}
async function geometry(p) {
  return p.evaluate(() => {
    const pop = document.querySelector('.ch-mpop'), card = pop?.querySelector('.ch-sheet-b');
    if (!card) return { missing: true };
    const r = card.getBoundingClientRect(), composer = document.querySelector('.ch-compose').getBoundingClientRect();
    const head = document.querySelector('.ch-head').getBoundingClientRect(), vv = visualViewport;
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
      composerTop: composer.top, headBottom: head.bottom, viewportBottom: vv.offsetTop + vv.height,
      viewportTop: vv.offsetTop, viewportRight: vv.offsetLeft + vv.width,
      background: getComputedStyle(card).backgroundColor, image: getComputedStyle(card).backgroundImage };
  });
}
async function bounds(p, label) {
  const g = await geometry(p);
  ok(!g.missing && g.height > 40 && g.top >= Math.max(g.headBottom, g.viewportTop) - 1 && g.bottom <= Math.min(g.composerTop, g.viewportBottom) - 3 && g.left >= 0 && g.right <= g.viewportRight + 1,
    `${label}: popup wholly visible above composer`, g);
  ok(!g.missing && !/^rgba\(.*?,\s*0(?:\.\d+)?\)$/.test(g.background) && g.background !== 'transparent', `${label}: opaque skin panel`, g);
}
async function exercise(browser, c) {
  const label = `${c.mode}-${c.width}-${c.skin}-${c.short ? 'short' : 'long'}`;
  const { ctx, p, errs, root } = await boot(browser, c);
  try {
    const draft = c.short ? 'Keep this draft.' : ('One more thing. I want to be able to choose a model while this draft stays exactly as written.\n').repeat(16);
    const ta = p.locator('.ch-compose textarea').first();
    await ta.fill(draft);
    await p.locator('[data-chmodel]').first().click();
    await p.locator('.ch-mpop').waitFor();
    await p.waitForTimeout(200); // popup entry animation only
    await bounds(p, label);
    ok(await p.evaluate(() => document.documentElement.classList.contains('wos-doc-scroll')) === (c.mode === 'native'), `${label}: expected native/overflow scroll mode`);
    const more = p.locator('.ch-mpop [data-mall]');
    await more.scrollIntoViewIfNeeded();
    await more.click();
    await p.waitForTimeout(200);
    await bounds(p, `${label} expanded`);
    const rows = p.locator('.ch-mpop [data-mpick]'), count = await rows.count();
    ok(count >= 10, `${label}: expanded catalogue and private models present`, count);
    for (let i = 0; i < count; i++) {
      await rows.nth(i).scrollIntoViewIfNeeded();
      const hit = await rows.nth(i).evaluate(el => {
        const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { name: el.textContent.trim(), hit: !!top && el.contains(top), top: r.top, bottom: r.bottom };
      });
      ok(hit.hit, `${label}: model ${i + 1}/${count} reachable and hit-tested`, hit);
    }
    await p.screenshot({ path: path.join(OUT, `${label}-expanded.png`) });
    // Resize while OPEN: keyboard-equivalent constrained visible viewport; do not reopen to repair it.
    if (!c.short && c.mode !== 'desktop') {
      await p.setViewportSize({ width: c.width, height: 440 });
      await p.waitForTimeout(250);
      await bounds(p, `${label} keyboard-height`);
      for (let i = 0; i < count; i++) {
        await rows.nth(i).scrollIntoViewIfNeeded();
        ok(await rows.nth(i).evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && el.contains(hit); }), `${label}: keyboard model ${i + 1}/${count} hit-tested`);
      }
      await p.screenshot({ path: path.join(OUT, `${label}-keyboard.png`) });
    }
    const astra = p.locator('.ch-mpop [data-mpick]').filter({ hasText: /^Astra$/ }).first();
    await astra.scrollIntoViewIfNeeded(); await astra.click();
    await p.waitForFunction(root => {
      const a = window[root]; return a.chats.ch(qaWid).newModel?.model === 'gpt-6-astra';
    }, root);
    ok(await ta.inputValue() === draft, `${label}: draft survives actual model selection`);
    ok(/Astra/.test(await p.locator('[data-chmodel]').first().textContent()), `${label}: selected model label updates`);
    await p.locator('[data-chmodel]').first().click();
    await p.locator('.ch-mpop').waitFor(); await p.waitForTimeout(200);
    const overlay = await p.locator('.ch-mpop').boundingBox();
    await p.mouse.click(overlay.x + 5, overlay.y + 30);
    ok(await p.locator('.ch-mpop').count() === 0, `${label}: outside tap dismisses`);
    await p.locator('[data-chmodel]').first().click();
    await p.locator('.ch-mpop').waitFor();
    await p.evaluate(() => window.__wosNativeBack ? window.__wosNativeBack() : document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    ok(await p.locator('.ch-mpop').count() === 0, `${label}: Back/Escape dismisses`);
    ok(await ta.inputValue() === draft, `${label}: dismissals preserve draft`);
    ok(errs.length === 0, `${label}: no page errors`, errs);
  } finally { await ctx.close(); }
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--no-sandbox'] });
  try {
    const cases = [
      { mode: 'native', width: 360, height: 780, skin: 'nebula' },
      { mode: 'native', width: 412, height: 892, skin: 'nebula' },
      { mode: 'phone', width: 360, height: 780, skin: 'nebula' },
      { mode: 'phone', width: 412, height: 892, skin: 'nebula', short: true },
      { mode: 'native', width: 412, height: 892, skin: 'sepia' },
      { mode: 'desktop', width: 1365, height: 900, skin: 'nebula' }
    ];
    for (const c of cases) { try { await exercise(browser, c); } catch (e) { ok(false, `${c.mode}-${c.width}-${c.skin}: completed`, String(e)); } }
  } finally { await browser.close(); }
  ok(foreignRequests === 0, 'no request to any real origin', foreignRequests);
  console.log(JSON.stringify({ pass, fail, blockedWrites, realAgentWrites: 0, foreignRequests, tree: TREE, out: OUT }));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
