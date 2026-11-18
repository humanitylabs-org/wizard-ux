// Scratch: Welcome Connect your AI screens, private first on/off, two skins, phone + desktop, in the real shell.
const path = require('path'), fs = require('fs');
const REPO = process.env.QA_REPO;
const { chromium } = require(process.env.QA_PLAYWRIGHT);
const fx = require(path.join(REPO, 'tools/qa-proof-fixture.cjs'));
const WEB = path.join(REPO, 'web'), OUT = process.env.QA_OUT; fs.mkdirSync(OUT, { recursive: true });
const SIGNIN = name => `<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px system-ui;background:#fbfaf7;color:#1d1b22;padding:18px"><h3 style="margin:0 0 8px">Sign in to ${name}</h3><p>The ${name} app's own sign-in page.</p><button style="font:inherit;padding:8px 14px;border-radius:9px;border:0;background:#333;color:#fff">Sign in</button></body>`;
async function run({ shell, skin, on }) {
  const b = await chromium.launch();
  const phone = shell === 'phone';
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const state = { privateAgent: null, providers: [] };
  await ctx.addInitScript(([skin, phone]) => { if (window !== top) return; if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.voiceTipSeen': 'true', 'wos.skin': skin })) localStorage.setItem(k, v);
    if (phone) { localStorage.setItem('wos.shell', 'phone'); localStorage.setItem('wux.shell', 'phone'); } }, [skin, phone]);
  const apps = ['wizard-tinfoil', 'wizard-claude', 'wizard-chatgpt'].map(id => ({ ...fx.app(id), kind: 'wizard', type: 'view' }));
  await ctx.route(fx.ORIGIN + '/**', r => {
    const u = new URL(r.request().url()), p = u.pathname;
    const json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/wizard/v1/setup') return json({ first_run: true });
    if (p === '/wizard/v1/private-first') return json({ schema: 'wizard.private-first/1', on, standard_agent: 'main', private_agent: state.privateAgent, standard_on: true });
    if (p === '/wizard/hermes/api/model/options') return json({ provider: '', model: '', providers: state.providers });
    if (p === '/wizard/v1/apps') return json({ apps });
    if (/^\/wizard-(tinfoil|claude|chatgpt)\/$/.test(p)) return r.fulfill({ contentType: 'text/html', body: SIGNIN(p.includes('tinfoil') ? 'Tinfoil' : p.includes('claude') ? 'Claude' : 'ChatGPT') });
    if (p.startsWith('/wizard-os-home/')) return fx.staticResponse(r, WEB, p.slice('/wizard-os-home/'.length));
    return r.fulfill(fx.response(p + u.search, r.request().method()));
  });
  const pg = await ctx.newPage();
  await pg.goto(fx.ORIGIN + '/wizard-os-home/' + (phone ? 'index.html?phone' : 'desktop.html'));
  await pg.waitForSelector('#wosWelcome .wl-card h2', { timeout: 30000 });
  // Skip the name step if shown.
  if (await pg.$('[data-wl="skip-name"]')) await pg.click('[data-wl="skip-name"]');
  await pg.waitForFunction(() => /Connect your AI/.test(document.querySelector('#wosWelcome .wl-card')?.textContent || ''));
  await pg.waitForTimeout(600);
  const tag = `${shell}-${skin}-${on ? 'on' : 'off'}`;
  const shot = async n => pg.locator('#wosWelcome .wl-card').screenshot({ path: path.join(OUT, `${tag}-${n}.png`) });
  const order = await pg.$$eval('#wosWelcome [data-wl="provider"]', b => b.map(x => x.dataset.app));
  await shot('1-connect');
  const first = order[0];
  await pg.click(`#wosWelcome [data-app="${first}"]`);
  await pg.waitForSelector('#wosWelcome .wl-frame iframe'); await pg.waitForTimeout(800);
  await shot('2-signin');
  let steps = { order };
  if (on) {
    state.privateAgent = 'private-1';
    await pg.waitForFunction(() => /private agent is ready/.test(document.querySelector('#wosWelcome .wl-card')?.textContent || ''), null, { timeout: 20000 });
    await pg.waitForTimeout(300); await shot('3-second-agent');
    await pg.click('#wosWelcome [data-app="wizard-claude"]');
    await pg.waitForSelector('#wosWelcome .wl-frame iframe'); await pg.waitForTimeout(800);
    await shot('4-claude-signin');
    steps.claudeStatus = await pg.textContent('#wosWelcome .wl-status');
    await pg.click('#wosWelcome [data-wl="back"]');
    await pg.click('#wosWelcome [data-wl="next"]');
  } else {
    state.providers = [{ slug: 'anthropic', authenticated: true }];
  }
  await pg.waitForFunction(() => /Pick a skin/.test(document.querySelector('#wosWelcome .wl-card')?.textContent || ''), null, { timeout: 20000 });
  await pg.waitForTimeout(300); await shot('5-done');
  await b.close();
  return { tag, ...steps };
}
(async () => {
  const res = [];
  for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) for (const on of [false, true]) {
    try { res.push(await run({ shell, skin, on })); } catch (e) { res.push({ shell, skin, on, error: String(e).slice(0, 300) }); }
  }
  console.log(JSON.stringify(res, null, 1));
})();
