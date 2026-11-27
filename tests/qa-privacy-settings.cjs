// Browser QA for wizard-ux#1801 (Settings › Privacy, on for everyone since wizard-agent-service#626): the REAL Agent Service
// (wizard-agent-service checkout at QA_AS, started by tests/qa-privacy-box.mjs with a stand-in main Hermes on Claude and
// a stand-in Tinfoil app) behind the real phone shell (web/index.html at 412 px; QA_SHELL=desktop: web/desktop.html at
// 1280 px) in Chromium. No switch: private mode is there on every box. Cases:
//   on        Privacy check reads Mail/Notes → Hermes → Anthropic; the picker's Private group's Set up private AI
//             opens the sheet at step 1 (Tinfoil sign-in, the app's own page); signing in there moves on by itself;
//             Create private agent; close after step 2 -> the row says Finish setting up -> reopening resumes at the
//             Privacy check with one private agent; Mail and Notes ticked -> Bring your context along (on) -> Start new
//             chats on private AI (on) -> Done lists Mail and Notes; the box agrees (default agent, apps, grant); the
//             Privacy check shows them on the private agent; Move to standard / Move to private per row; Why it
//             matters -> Ask my Wizard -> a new chat holding the question; turn off from the row -> apps back on the
//             standard agent, the private agent kept. Back closes the sheet (Settings stays), an outside tap closes it,
//             a live skin change repaints it, its panel is opaque.
//   QA_AS=<wizard-agent-service checkout> QA_PLAYWRIGHT=<playwright> node tests/qa-privacy-settings.cjs
//   QA_CASES=on (default) · QA_SHOTS=<dir>: before/after shots at 412 px · QA_WEB=<another web/>
const { spawn } = require('child_process'), path = require('path'), fs = require('fs');
const { chromium } = require('../tools/qa-playwright.cjs');
const DESKTOP = process.env.QA_SHELL === 'desktop', SHOTS = process.env.QA_SHOTS || '';
const CASES = (process.env.QA_CASES || 'on').split(',');
const fails = [], notes = [];
const fail = (k, m) => { fails.push(`${k}: ${m}`); console.log(`  ✗ ${k}: ${m}`); };
const pass = (k, m) => console.log(`  ✓ ${k}: ${m}`);
const check = (k, cond, m, extra) => (cond ? pass(k, m) : fail(k, m + (extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 600))));

function startBox() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'qa-privacy-box.mjs')], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; const m = out.match(/READY (\d+) (\S+)/); if (m) resolve({ child, base: `http://127.0.0.1:${m[1]}`, dir: m[2] }); });
    child.stderr.on('data', d => { if (process.env.QA_DEBUG) process.stderr.write(d); });
    child.on('exit', code => reject(new Error('box exited ' + code + ' ' + out)));
  });
}
const J = async (base, p, init) => { const r = await fetch(base + p, init); return { status: r.status, json: await r.json().catch(() => null) }; };

async function device(browser, base, skin = 'nebula') {
  const ctx = await browser.newContext(DESKTOP ? { viewport: { width: 1280, height: 820 } } : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(skin => { if (window !== window.top || sessionStorage.getItem('qa.seeded')) return; sessionStorage.setItem('qa.seeded', '1');
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.welcome.v1', 'done'); localStorage.setItem('wos.skin', skin);
      localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify({ version: 1, preset: 'none', off: {}, mix: {} })); } catch (e) {} }, skin);
  const page = await ctx.newPage();
  page.on('pageerror', e => notes.push(`pageerror: ${e.message}`));
  await page.goto(base + '/wizard-os-home/' + (DESKTOP ? 'desktop.html' : '?open=chats'));
  await page.waitForFunction(() => (window.__wos || window.__wux)?.chats && window.WosSettings, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}
const root = () => (DESKTOP ? '__wux' : '__wos');
async function openPrivacy(page) {
  await page.evaluate(r => window[r].openSettings('privacy'), root());
  await page.waitForTimeout(900);
  return page.evaluate(() => { const g = document.querySelector('[data-pm-group]'); return { page: !!g, text: (g?.closest('.st-page, [data-st-page], .st-body, #settingsBody') || g?.parentElement)?.innerText || '', index: [...document.querySelectorAll('[data-st-page]')].map(n => n.dataset.stPage) }; });
}
async function openPicker(page) {
  return page.evaluate(async r => {
    const api = window[r], w = Object.values(api.wins).find(x => x.app === 'chats' && !x.agent);
    api.chats.openNewDraft(w.id, ''); api.chats.renderChats(w);
    await new Promise(res => setTimeout(res, 300));
    const b = document.querySelector(`[data-chats="${w.id}"] [data-chmodel]`); b?.click();
    await new Promise(res => setTimeout(res, 500));
    const s = document.querySelector('.ch-mpop, .ch-msheet');
    return { wid: w.id, open: !!s, text: s?.innerText || '', setup: [...document.querySelectorAll('[data-mprivsetup]')].some(n => n.getClientRects().length) };
  }, root());
}
const screen = page => page.evaluate(() => window.WosPrivacy?.screen || '');
const waitScreen = (page, s, ms = 15000) => page.waitForFunction(s => window.WosPrivacy?.screen === s, s, { timeout: ms }).then(() => true, () => false);
const sheetText = page => page.evaluate(() => document.querySelector('.pm-card')?.innerText || '');
// No switch to turn on: the box answers on:true from the start.
async function turnOn(page, base) {
  for (let i = 0; i < 30; i++) { if ((await J(base, '/wizard/v1/private-mode')).json?.on) return true; await page.waitForTimeout(500); }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const shell = DESKTOP ? 'desktop' : 'phone';
  try {
    if (CASES.includes('on')) {
      console.log(`on (${shell})`);
      const box = await startBox();
      try {
        await J(box.base, '/wizard/v1/setup/seen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const { ctx, page } = await device(browser, box.base);
        check('on', await turnOn(page, box.base), 'the box offers private mode with no switch');
        await page.waitForFunction(() => window.WosPrivacy?.state?.on === true, null, { timeout: 10000 }).catch(() => {});
        // Privacy check before anything moves.
        let pv = await openPrivacy(page);
        check('on', pv.page, 'Settings › Privacy shows the Private AI group');
        check('on', /Private mode[\s\S]*Off/.test(pv.text), 'the Private mode row says Off', pv.text);
        check('on', /Mail → Hermes → Anthropic/.test(pv.text) && /Notes → Hermes → Anthropic/.test(pv.text), 'the Privacy check: Mail and Notes → Hermes → Anthropic', pv.text);
        check('on', !/Music/.test(pv.text), 'only apps that hold personal data', pv.text);
        check('on', /Set up private AI/.test(pv.text), 'it ends with Set up private AI while private mode is off');
        if (SHOTS) { const g = page.locator('[data-pm-checkgroup]'); await g.scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: path.join(SHOTS, `${shell}-settings-on.png`) }); }
        // The model picker's Private group opens the same sheet.
        await page.evaluate(r => { const a = window[r]; if (a.closeSheets) a.closeSheets(true); else a.closeSettings?.(); }, root());
        const pk = await openPicker(page);
        check('on', pk.setup, 'the model picker offers Set up private AI', pk.text);
        await page.locator('[data-mprivsetup]:visible').first().click();
        check('on', await waitScreen(page, 'signin'), 'it opens the sheet at step 1, Sign in to private AI', await screen(page));
        const frame = await page.locator('.pm-frame iframe').getAttribute('src').catch(() => '');
        check('on', /\/wizard-tinfoil\/\?connect=1/.test(frame || ''), 'step 1 is the Tinfoil app\'s own sign-in page', frame);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-sheet-signin.png`) });
        await page.frameLocator('.pm-frame iframe').locator('#in').click();
        check('on', await waitScreen(page, 'agent', 12000), 'signing in to Tinfoil moves on by itself to Create your private agent', await screen(page));
        await page.locator('.pm-card [data-pm-go="agent"]').click();
        check('on', await waitScreen(page, 'check'), 'Create private agent -> the Privacy check (step 3)');
        let st = (await J(box.base, '/wizard/v1/private-mode')).json;
        check('on', st?.mode === 'setting_up' && st?.next_step === 'apps' && st?.private_agent, 'the box has the private agent and waits at the apps step', st);
        // Leave after step 2, reopen from Settings.
        await page.locator('.pm-card [data-pm-close]').first().click();
        pv = await openPrivacy(page);
        check('on', /Finish setting up private AI/.test(pv.text), 'meanwhile the row says Finish setting up private AI', pv.text);
        await page.locator('[data-pm-row="finish"]').click();
        check('on', await waitScreen(page, 'check'), 'reopening resumes at step 3, the Privacy check', await screen(page));
        const agents = (await J(box.base, '/wizard/v1/agents')).json.agents;
        check('on', agents.filter(a => a.privacy === 'private').length === 1, 'exactly one private agent (nothing duplicated)', agents.map(a => a.id));
        let txt = await sheetText(page);
        check('on', /Mail\s+Claude can read your email today\. Move to private\./.test(txt) && /Notes\s+Claude can read your notes today\. Move to private\./.test(txt), 'Mail and Notes are listed with what Claude can read today', txt);
        const ticked = await page.evaluate(() => [...document.querySelectorAll('.pm-card [data-pm-tick][aria-checked="true"]')].map(n => n.dataset.pmTick));
        check('on', ticked.join() === 'wizard-mail,wizard-notes', 'personal-data apps are pre-ticked', ticked);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-sheet-check.png`) });
        // Back closes the sheet, never leaves the shell.
        await page.evaluate(() => window.WosBack.escape(new KeyboardEvent('keydown', { key: 'Escape' })));
        await page.waitForTimeout(400);
        check('on', !(await page.evaluate(() => window.WosPrivacy.isOpen)) && /wizard-os-home/.test(page.url()), 'Back closes the sheet and stays in Wizard', page.url());
        await openPrivacy(page);
        await page.locator('[data-pm-row="finish"]').click();
        await waitScreen(page, 'check');
        await page.locator('.pm-card [data-pm-go="apps"]').click();
        check('on', await waitScreen(page, 'context'), 'Move 2 apps -> Bring your context along');
        check('on', await page.locator('.pm-card [data-pm-grant][aria-checked="true"]').count() === 1, 'Bring your context along is on by default');
        await page.locator('.pm-card [data-pm-go="context"]').click();
        check('on', await waitScreen(page, 'default'), '-> Main chat');
        txt = await sheetText(page);
        check('on', /Start new chats on private AI/.test(txt) && /Private AI is a bit less capable than Claude for hard problems\. You can still pick Claude in any chat\./.test(txt), 'Start new chats on private AI, with the honest capability line', txt);
        // A live skin change repaints the open sheet; the panel is opaque.
        const before = await page.evaluate(() => getComputedStyle(document.querySelector('.pm-card')).backgroundColor);
        await page.evaluate(() => window.WosSkin.set('grove'));
        await page.waitForTimeout(700);
        const after = await page.evaluate(() => getComputedStyle(document.querySelector('.pm-card')).backgroundColor);
        check('on', before !== after, 'a live skin change repaints the sheet', { before, after });
        check('on', !/rgba\([^)]*,\s*0?\.\d+\)$/.test(after) && !/ \/ 0?\.\d+\)$/.test(after), 'the sheet\'s panel is opaque', after);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-sheet-default-grove.png`) });
        await page.evaluate(() => window.WosSkin.set('nebula'));
        await page.locator('.pm-card [data-pm-go="default"]').click();
        check('on', await waitScreen(page, 'done'), '-> Done');
        txt = await sheetText(page);
        check('on', /Moved to private AI: Mail, Notes\./.test(txt), 'Done lists Mail and Notes', txt);
        check('on', /What Claude already saw stays in your standard agent’s memory and chats, and in Anthropic’s records\./.test(txt), 'Done says plainly what Claude already saw stays', txt);
        check('on', await page.locator('.pm-card a[href^="https://claude.ai/"]').count() === 1, 'with a link to Anthropic\'s records');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-sheet-done.png`) });
        st = (await J(box.base, '/wizard/v1/private-mode')).json;
        check('on', st?.mode === 'on' && st.default_agent === st.private_agent && st.moved_apps.join() === 'wizard-mail,wizard-notes' && st.context?.granted, 'the box: private mode on, private agent default, Mail and Notes moved, context granted', st);
        await page.locator('.pm-card [data-pm-close]').first().click();
        pv = await openPrivacy(page);
        check('on', /Private mode[\s\S]*On/.test(pv.text), 'the row says On', pv.text);
        check('on', /Mail → Private → Tinfoil/.test(pv.text) && /Notes → Private → Tinfoil/.test(pv.text), 'the Privacy check shows Mail and Notes on the private agent', pv.text);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-settings-private.png`) });
        // One app back and forth from the Privacy check.
        await page.locator('[data-pm-move="back:wizard-notes"]').click();
        await page.waitForFunction(() => /Notes → Hermes → Anthropic/.test(document.querySelector('[data-pm-checkgroup]')?.innerText || ''), null, { timeout: 10000 }).catch(() => {});
        pv = await openPrivacy(page);
        check('on', /Notes → Hermes → Anthropic/.test(pv.text), 'Move to standard puts Notes back on Hermes', pv.text);
        await page.locator('[data-pm-move="move:wizard-notes"]').click();
        await page.waitForFunction(() => /Notes → Private → Tinfoil/.test(document.querySelector('[data-pm-checkgroup]')?.innerText || ''), null, { timeout: 10000 }).catch(() => {});
        pv = await openPrivacy(page);
        check('on', /Notes → Private → Tinfoil/.test(pv.text), 'Move to private moves it again', pv.text);
        // Why it matters -> Ask my Wizard.
        await page.locator('[data-pm-why]').click();
        check('on', await waitScreen(page, 'why'), 'Why it matters opens');
        txt = await sheetText(page);
        check('on', /sealed hardware/.test(txt) && !/aiwizards\.com|video/i.test(txt), 'three plain sentences, no video link yet', txt);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-sheet-why.png`) });
        // An outside tap closes the sheet.
        await page.mouse.click(DESKTOP ? 20 : 12, 20);
        await page.waitForTimeout(300);
        check('on', !(await page.evaluate(() => window.WosPrivacy.isOpen)), 'an outside tap closes the sheet');
        await openPrivacy(page);
        await page.locator('[data-pm-why]').click();
        await waitScreen(page, 'why');
        await page.locator('.pm-card [data-pm-ask]').click();
        await page.waitForTimeout(1200);
        const draft = await page.evaluate(() => [...document.querySelectorAll('.ch-compose textarea')].filter(t => t.getClientRects().length).map(t => t.value));
        check('on', draft.includes('Why would I want private AI?'), 'Ask my Wizard opens a new chat holding the question, unsent', draft);
        check('on', (await J(box.base, '/qa/state')).json.runs === 0, 'nothing was sent');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-ask.png`) });
        // The Welcome's private AI offer links to Why it matters while the switch is on.
        await page.evaluate(() => window.WosWelcome.open('private'));
        const why = await page.waitForSelector('.wl-card [data-wl="why"]', { timeout: 8000 }).then(() => true, () => false);
        check('on', why, 'the Welcome\'s private AI offer shows Why does this matter?');
        if (why) { await page.locator('.wl-card [data-wl="why"]').click(); check('on', await waitScreen(page, 'why'), 'it opens Why it matters over the Welcome'); await page.locator('.pm-card [data-pm-close]').first().click(); }
        await page.evaluate(() => window.WosWelcome.close?.());
        await page.waitForTimeout(300);
        // Turn private mode off from the row.
        pv = await openPrivacy(page);
        await page.locator('[data-pm-row="on"]').click();
        check('on', await waitScreen(page, 'off'), 'tapping the On row asks Turn off private mode?');
        await page.locator('.pm-card [data-pm-go="off"]').click();
        await page.waitForFunction(() => !window.WosPrivacy.isOpen, null, { timeout: 15000 }).catch(() => {});
        st = (await J(box.base, '/wizard/v1/private-mode')).json;
        check('on', st?.mode === 'off' && st.default_agent === 'hermes' && !st.moved_apps.length, 'the box: private mode off, standard agent default again', st);
        const kept = (await J(box.base, '/wizard/v1/agents')).json.agents.filter(a => a.privacy === 'private');
        check('on', kept.length === 1, 'the private agent is kept', kept.map(a => a.id));
        pv = await openPrivacy(page);
        check('on', /Mail → Hermes → Anthropic/.test(pv.text) && /Notes → Hermes → Anthropic/.test(pv.text), 'the Privacy check shows Mail and Notes back on the standard agent', pv.text);
        check('on', /Private mode[\s\S]*Off/.test(pv.text), 'the row says Off again', pv.text);
        await ctx.close();
      } finally { box.child.kill(); }
    }
  } catch (e) { fail('run', e.stack || e.message); }
  await browser.close();
  for (const n of [...new Set(notes)]) console.log('  note: ' + n);
  console.log(fails.length ? `FAIL ${fails.length}` : 'PASS');
  process.exit(fails.length ? 1 : 0);
})();
