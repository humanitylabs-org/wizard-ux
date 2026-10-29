// Launch skin model acceptance (23 Oct 2026): a fresh profile wears Nebula; the owner's first agent-requested change
// becomes My skin, leads Settings › Look on two skins, survives reload; Back in Settings › Look never exits.
// My skin is served by the Agent Service's own my-skin.mjs over a throwaway Files root, and the "agent" edits
// Skins/My skin/skin.css there exactly as its Files tools would. Every other write is refused.
// Run: node tools/qa-origin.cjs 9393 <tree>/web, then node qa-launch-my-skin.cjs http://127.0.0.1:9393/wizard-os-home/
// Env: QA_MY_SKIN_MODULE=<agent service>/server/my-skin.mjs (default: the live release), QA_SHOTS=<dir>.
const pw = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ORIGIN = process.argv[2] || 'http://127.0.0.1:9393/wizard-os-home/';
const SHOTS = process.env.QA_SHOTS || path.join(os.homedir(), '.hermes/cache/scratch/launch-my-skin');
const MODULE = process.env.QA_MY_SKIN_MODULE || path.join(fs.realpathSync(path.join(os.homedir(), '.local/share/wizard-mobile-server/current')), 'server/my-skin.mjs');
fs.mkdirSync(SHOTS, { recursive: true });
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
// The change an owner asks for ("make the Look heading pink"), written the way the agent contract says: My skin only.
const AGENT_CSS = '/* My skin: asked for in chat */\nhtml[data-skin] .st-group[data-stgroup="look"] h4 { color: rgb(255, 92, 207); }\n';
let pass = 0, fail = 0;
function ok(value, name, detail = '') { value ? pass++ : fail++; console.log(value ? 'PASS' : 'FAIL', name, detail ? String(detail).slice(0, 300) : ''); }

async function run(browser, mode, my) {
  const phone = mode === 'phone', ctx = await browser.newContext(phone
    ? { viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: PHONE_UA }
    : { viewport: { width: 1440, height: 900 } });
  const writes = [], errors = [];
  await ctx.route('**/*', async route => {
    const q = route.request(), u = new URL(q.url());
    if (u.pathname.startsWith('/wizard/v1/my-skin')) {
      if (q.method() !== 'GET') { writes.push(q.method() + ' ' + u.pathname); return route.fulfill({ status: 403, json: { error: 'QA refuses writes' } }); }
      if (u.pathname.endsWith('/script')) return route.fulfill({ status: 404, body: '' });
      if (u.searchParams.get('format') === 'json') return route.fulfill({ json: my.info() });
      return route.fulfill({ contentType: 'text/css; charset=utf-8', body: my.css() });
    }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { writes.push(q.method() + ' ' + u.pathname); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"QA refuses writes"}' }); }
    if (/\/(data|summaries)\.js$/.test(u.pathname)) return route.fulfill({ contentType: 'application/javascript', body: '// Empty QA data.' });
    if (u.pathname === '/wizard/hermes/api/sessions') return route.fulfill({ json: { data: [], sessions: [], total: 0, has_more: false } });
    if (u.pathname === '/wizard/thread-seen') return route.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
    if (u.pathname === '/wizard/v1/setup') return route.fulfill({ json: { first_run: false } });
    return route.continue();
  });
  // Fresh profile: nothing but the tour flag (so the tour doesn't cover Look). No wos.skin, no My skin cache.
  await ctx.addInitScript(() => { if (location.protocol !== 'http:') return; if (!sessionStorage.getItem('qa.boot')) { localStorage.clear(); sessionStorage.setItem('qa.boot', '1'); } localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  const load = async () => { await p.waitForFunction(() => window.WosSkin && window.WosMySkin?.state.loaded, null, { timeout: 20000 }); await p.waitForTimeout(500); };
  const look = async () => { await p.evaluate(() => WizCore.deeplink.route(location.pathname + '?view=skin')); await p.locator('[data-myskin-row]:visible').first().waitFor({ timeout: 8000 }); await p.waitForTimeout(300); };
  const tap = async sel => { const el = p.locator(sel + ':visible').first(); await el.scrollIntoViewIfNeeded(); if (phone) await el.tap(); else await el.click(); await p.waitForTimeout(350); };
  const row = () => p.evaluate(() => { const r = document.querySelector('[data-myskin-row]'); if (!r) return null; const g = r.closest('[data-stgroup="look"]'); const kids = [...g.children]; return { worn: r.dataset.worn, sub: r.querySelector('[data-myskinsub]')?.textContent || '', reset: !!r.querySelector('[data-myskin="reset"]'), first: kids.indexOf(r) < kids.indexOf(g.querySelector('.sk-row')), h4: getComputedStyle(g.querySelector('h4')).color, attr: document.documentElement.hasAttribute('data-my-skin') }; });
  try {
    await p.goto(ORIGIN, { waitUntil: 'load' }); await load();
    const fresh = await p.evaluate(() => ({ cur: WosSkin.current, chosen: WosSkin.chosen, skin: document.documentElement.dataset.skin || '' }));
    ok(fresh.cur === 'nebula' && !fresh.chosen, `${mode}: fresh profile wears Nebula with no saved choice`, JSON.stringify(fresh));
    await look();
    let r = await row();
    ok(r && r.first && r.worn === 'false' && /Everything you see is customizable/.test(r.sub) && !r.reset, `${mode}: Look leads with My skin, empty, inviting one change, no Reset`, JSON.stringify(r));
    await p.screenshot({ path: path.join(SHOTS, `${mode}-1-fresh-look.png`) });

    // The agent fulfils "make the Look heading pink" by editing Skins/My skin/skin.css (its Files tools).
    fs.writeFileSync(path.join(my.root, 'Skins/My skin/skin.css'), AGENT_CSS);
    await p.evaluate(() => WosMySkin.refresh()); await p.waitForTimeout(400);
    r = await row();
    ok(r && r.worn === 'true' && r.attr && /Wearing it · your changes on top of Wizard · Nebula/.test(r.sub) && r.reset && r.h4 === 'rgb(255, 92, 207)', `${mode}: the agent's change is now My skin, worn over Nebula`, JSON.stringify(r));
    await p.screenshot({ path: path.join(SHOTS, `${mode}-2-my-skin-nebula.png`) });

    await p.reload({ waitUntil: 'load' });
    const early = await p.evaluate(() => document.documentElement.hasAttribute('data-my-skin'));
    await load(); await look(); r = await row();
    ok(early && r.worn === 'true' && r.h4 === 'rgb(255, 92, 207)' && (await p.evaluate(() => WosSkin.current)) === 'nebula', `${mode}: reload lands on My skin (cached first paint, then the box's file)`, JSON.stringify({ early, ...r }));

    // Second skin through the real picker: My skin stays on top, Look says so.
    for (const [fam, id] of [['wizard', 'grove'], ['novairecito', 'sepia']]) {
      if (await p.locator(`[data-skinpick="${id}"]:visible`).count() === 0) { await tap(`[data-skinfamily="${fam}"]`); await p.locator('.mz-intro').waitFor({ state: 'detached' }).catch(() => {}); }
      await tap(`[data-skinpick="${id}"]`); await p.waitForTimeout(600); await p.locator('.mz-intro').waitFor({ state: 'detached' }).catch(() => {});
      r = await row();
      const worn = await p.evaluate(() => ({ skin: document.documentElement.dataset.skin, pressed: document.querySelector('[data-skinpick][aria-pressed="true"]')?.dataset.skinpick }));
      ok(worn.skin === id && worn.pressed === id && r.worn === 'true' && new RegExp(`on top of .*${id === 'grove' ? 'Grove' : 'Sepia'}`).test(r.sub) && r.h4 === 'rgb(255, 92, 207)', `${mode}: ${id} worn, My skin still on top and named`, JSON.stringify({ ...worn, ...r }));
      await p.locator('[data-myskin-row]:visible').first().scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(SHOTS, `${mode}-3-my-skin-${id}.png`) });
    }

    // Back from Settings › Look closes one layer and stays in Wizard (Home's own exit warning is a separate contract).
    const startUrl = new URL(p.url()).pathname;
    const openBefore = await p.locator('[data-myskin-row]:visible').count();
    const state = () => p.evaluate(() => ({ path: location.pathname, alive: !!window.WosSkin, myskin: document.documentElement.hasAttribute('data-my-skin'), log: (window.__wuxLog || []).slice(-1)[0] || '', look: [...document.querySelectorAll('[data-myskin-row]')].some(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden') }));
    let after, presses = 0;
    do { await p.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {}); await p.waitForTimeout(600); presses++; after = await state(); }
    while (after.look && after.path === startUrl && presses < 3); // desktop steps Settings one page at a time
    ok(openBefore && after.path === startUrl && after.alive && after.myskin && !after.look, `${mode}: Back peels Settings › Look one layer per press and stays in Wizard with My skin on`, JSON.stringify({ presses, ...after }));
    await p.screenshot({ path: path.join(SHOTS, `${mode}-4-after-back.png`) });

    // Onboarding says it: the tour's end card and the Help sheet both carry the one-change invitation (phone shell owns the tour).
    if (phone) {
      const tour = await p.evaluate(async () => {
        WosTour.start(); await new Promise(r => setTimeout(r, 400)); WosTour._go(WosTour.DONE || 4); await new Promise(r => setTimeout(r, 500));
        const end = { copy: document.querySelector('.tr-copy b')?.textContent || '', alt: document.querySelector('.tr-copy .tr-alt')?.textContent || '' };
        WosTour.finish?.(); await new Promise(r => setTimeout(r, 300));
        WosTour.openHelp(); await new Promise(r => setTimeout(r, 500));
        const help = document.body.innerText.includes('Everything you see is customizable. Ask your Wizard for one change');
        WosTour.closeHelp(); return { ...end, help };
      });
      ok(/^Everything you see is customizable\. Try asking your Wizard for one change\.$/.test(tour.copy) && /say “help”/.test(tour.alt) && tour.help, `${mode}: tour end card and Help sheet invite one change`, JSON.stringify(tour));
      await p.screenshot({ path: path.join(SHOTS, `${mode}-5-help.png`) });
    }
    ok(!writes.length, `${mode}: zero writes (agent runs, sessions, My skin)`, writes.join(', '));
    ok(!errors.length, `${mode}: no page errors`, errors.join(' | '));
  } finally { await ctx.close(); }
}

(async () => {
  const { createMySkin } = await import(MODULE);
  const browser = await pw.chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  try {
    for (const mode of ['phone', 'desktop']) {
      const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'qa-my-skin-'));
      fs.mkdirSync(path.join(root, 'Skins/My skin'), { recursive: true }); const my = createMySkin({ root }); my.reset(); my.root = root; // a new box: the empty template, as the service makes it
      await run(browser, mode, my);
      fs.rmSync(root, { recursive: true, force: true });
    }
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed · shots ${SHOTS}`);
  process.exit(fail ? 1 : 0);
})();
