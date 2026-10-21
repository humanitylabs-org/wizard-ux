// Read-only, isolated My skin script acceptance. Run against: node tools/qa-origin.cjs PORT WORKTREE/web
// NODE_PATH may supply Playwright on a remote QA host. No live service or owner data is used.
const pw = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { createHash } = require('node:crypto');
const ORIGIN = process.argv[2] || 'http://127.0.0.1:9392/wizard-os-home/';
const SHOTS = process.env.QA_SHOTS || path.join(os.homedir(), '.hermes/cache/scratch/my-skin-script');
fs.mkdirSync(SHOTS, { recursive: true });
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const hash = s => createHash('sha256').update(s).digest('hex');
const script = version => `// café 🌙\r\nglobalThis.__mySkinModule = ${JSON.stringify(version)};\r\nexport default api => { globalThis.__mySkinSentinel = ${JSON.stringify(version)}; api.on('render', () => {}); return () => { delete globalThis.__mySkinSentinel; }; };\r\n`;
let pass = 0, fail = 0;
function ok(value, name, detail = '') { value ? pass++ : fail++; console.log(value ? 'PASS' : 'FAIL', name, detail); }

async function run(browser, mode) {
  const phone = mode === 'phone', ctx = await browser.newContext(phone
    ? { viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: PHONE_UA }
    : { viewport: { width: 1440, height: 900 } });
  const writes = [], errors = [], reads = [];
  let code = null;
  await ctx.route('**/*', async route => {
    const q = route.request(), u = new URL(q.url());
    if (q.method() !== 'GET') { writes.push(q.method() + ' ' + u.pathname); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"QA refuses writes"}' }); }
    if (u.pathname.startsWith('/wizard/v1/my-skin')) {
      reads.push(u.pathname + u.search);
      if (u.pathname.endsWith('/script')) return code === null ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'application/javascript; charset=utf-8', headers: { 'X-Wizard-Sha256': hash(code) }, body: code });
      if (u.searchParams.get('format') === 'json') return route.fulfill({ json: { path: 'Skins/My skin/skin.css', empty: false, script: { exists: code !== null, sha256: code === null ? null : hash(code), bytes: code === null ? 0 : Buffer.byteLength(code) } } });
      return route.fulfill({ contentType: 'text/css', body: 'html[data-skin] { --my-skin-qa: 1; }' });
    }
    if (/\/(data|summaries)\.js$/.test(u.pathname)) return route.fulfill({ contentType: 'application/javascript', body: '// Empty QA data: shell defaults are intentional.' });
    if (u.pathname === '/wizard/hermes/api/sessions') return route.fulfill({ json: { sessions: [], total: 0, has_more: false } });
    if (u.pathname === '/wizard/thread-seen') return route.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
    if (u.pathname.startsWith('/wizard/') || u.pathname.startsWith('/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"isolated QA fixture"}' });
    return route.continue();
  });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  async function load(url = ORIGIN) { await p.goto(url, { waitUntil: 'load' }); await p.waitForFunction(() => (window.WosMySkin?.state.loaded || window.WosMySkin?.state.off) && window.WosSkinHost?.personalState.ready); await p.waitForTimeout(400); }
  async function look() { await p.evaluate(() => WizCore.deeplink.route(location.pathname + '?view=skin')); await p.waitForTimeout(250); }
  const visible = sel => p.locator(sel + ':visible');
  async function tap(sel) {
    const el = visible(sel).first(); await el.scrollIntoViewIfNeeded();
    if (phone) await el.tap(); else await el.click();
    await p.waitForTimeout(250);
  }
  const sentinel = () => p.evaluate(() => ({ module: globalThis.__mySkinModule || null, setup: globalThis.__mySkinSentinel || null, approved: localStorage.getItem('wos.myskin.js.ok') }));
  try {
    await load(); await look();
    ok(await visible('[data-myskin="on"]').count() === 0 && await visible('[data-myskin-script]').count() === 0, `${mode}: no script → no Turn on row`);
    code = script('v1'); await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => WosMySkin.state.script.valid); await look();
    let s = await sentinel();
    ok(!s.module && !s.setup && await visible('[data-myskin="on"]').count() === 1, `${mode}: unapproved script never executes; Turn on visible`);
    await p.evaluate(() => document.querySelector('[data-myskin="on"]').click());
    s = await sentinel(); ok(!s.module && !s.approved, `${mode}: synthetic click cannot approve`);
    for (const skin of ['nebula', 'obsidian-light']) {
      if (skin === 'obsidian-light') {
        await tap('[data-skinfamily="mizel"]'); await p.locator('.mz-intro').waitFor({ state: 'detached' });
        await tap('[data-skinpick="obsidian-light"]');
      }
      await p.locator('.mz-intro').waitFor({ state: 'detached' }); // wait for the real package intro, never screenshot it
      ok(await p.evaluate(id => document.documentElement.dataset.skin === id && document.querySelector('[data-skinpick][aria-pressed="true"]')?.dataset.skinpick === id, skin), `${mode}: ${skin} is actually worn and selected in Look`);
      await visible('[data-myskin="on"]').first().scrollIntoViewIfNeeded();
      const metrics = await visible('[data-myskin="on"]').first().evaluate(e => { const b = e.getBoundingClientRect(); return { width: b.width, height: b.height, color: getComputedStyle(e).color, ink: getComputedStyle(e).getPropertyValue('--ink').trim() }; });
      ok(metrics.height >= 44 && metrics.width >= 44, `${mode}: ${skin} approval touch target ≥44 px`, JSON.stringify(metrics));
      await p.screenshot({ path: path.join(SHOTS, `${mode}-${skin}.png`) });
    }
    await tap('[data-myskin="on"]'); await p.waitForFunction(() => globalThis.__mySkinSentinel === 'v1');
    s = await sentinel();
    ok(s.module === 'v1' && s.setup === 'v1' && s.approved === hash(code), `${mode}: real owner tap executes verified version and stores its hash`);
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => globalThis.__mySkinSentinel === 'v1'); await look();
    ok((await sentinel()).approved === hash(code), `${mode}: same approved bytes persist across reload`);
    const before = reads.filter(x => x.endsWith('/script')).length;
    await p.evaluate(() => WosSkinHost.preview('nebula')); await p.waitForTimeout(100);
    ok(reads.filter(x => x.endsWith('/script')).length === before && (await sentinel()).setup === 'v1', `${mode}: picker preview neither fetches nor restarts My skin`);
    await tap('[data-myskin="off"]'); s = await sentinel();
    ok(!s.setup && !s.approved && !(await p.evaluate(() => WosSkinHost.personalState.active)), `${mode}: Turn off revokes consent and tears down hooks`);
    await tap('[data-myskin="on"]'); await p.waitForFunction(() => globalThis.__mySkinSentinel === 'v1');
    code = script('v2'); await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => WosMySkin.state.script.valid); await look();
    s = await sentinel();
    ok(!s.module && !s.setup && !s.approved && await visible('[data-myskin="on"]').count() === 1, `${mode}: changed bytes are off until tapped again`);
    await tap('[data-myskin="on"]'); await p.waitForFunction(() => globalThis.__mySkinSentinel === 'v2');
    ok((await sentinel()).approved === hash(code), `${mode}: new version requires and accepts a fresh real tap`);
    const offReads = reads.length;
    await load(ORIGIN + '?myskin=off'); await look(); s = await sentinel();
    ok(!s.module && !s.setup && reads.length === offReads && !(await p.locator('#wosMySkin').count()), `${mode}: ?myskin=off skips CSS, JS and requests`);
    code = `export default api => { globalThis.__mySkinSentinel = 'broken'; api.on('render', () => { throw new Error('QA broken hook'); }); return () => { globalThis.__mySkinSentinel = 'unloaded'; }; };`;
    await load(); await p.waitForFunction(() => WosMySkin.state.script.valid); await look(); await tap('[data-myskin="on"]');
    await p.waitForFunction(() => globalThis.__mySkinSentinel === 'broken');
    const guarded = await p.evaluate(() => { for (let i = 0; i < 3; i++) WosSkinHost.rendered('thread', document.body); return { ...WosSkinHost.personalState, sentinel: globalThis.__mySkinSentinel, toast: document.body.innerText.includes('Skins/My skin/skin.js') }; });
    ok(!guarded.active && guarded.disabled && guarded.handlers === 0 && guarded.listeners === 0 && guarded.sentinel === 'unloaded' && guarded.toast, `${mode}: third error unloads hooks and toasts the filename`, JSON.stringify(guarded));
    ok(writes.length === 0, `${mode}: zero writes`, JSON.stringify(writes));
    ok(errors.length === 0, `${mode}: no page errors`, errors.join(' | '));
  } finally { await ctx.close(); }
}
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  try { for (const mode of ['phone', 'desktop']) await run(browser, mode); } catch (e) { fail++; console.log('FAIL crashed', e.stack || String(e)); }
  finally { await browser.close(); }
  console.log(`\n${pass} pass, ${fail} fail · screenshots ${SHOTS}`); process.exitCode = fail ? 1 : 0;
})();
