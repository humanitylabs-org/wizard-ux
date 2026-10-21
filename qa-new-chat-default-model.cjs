// QA: a fresh New chat discards a stale per-draft model override and uses the
// current Hermes default, while an explicit choice in that new chat still rides
// with its first create + run request. Runs on phone and desktop; all writes are
// intercepted in the browser and never reach Wizard.
// Usage: node tools/qa-origin.cjs 9475 <worktree>/web &
//        QA_OUT=<dir> node qa-new-chat-default-model.cjs [url]
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const fs = require('fs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9475/wizard-os-home/';
const OUT = process.env.QA_OUT || (process.env.TMPDIR || '/tmp') + '/qa-new-chat-default-model';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (value, name, detail = '') => {
  if (value) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)); }
};
const ASTRA = { model: 'gpt-6-astra', provider: 'openai-codex' };
const writes = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100); }
  return fn();
}
async function fence(ctx, shell) {
  await ctx.route('**/*', async route => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    const url = new URL(req.url());
    const body = req.postData() || '';
    writes.push({ shell, method: req.method(), path: url.pathname, body });
    const json = (status, value) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (/\/api\/sessions$/.test(url.pathname)) {
      let sent = {}; try { sent = JSON.parse(body); } catch (e) {}
      return json(200, { session: { id: sent.id || `qa-${shell}-new-chat` } });
    }
    if (/\/v1\/runs$/.test(url.pathname)) return json(202, { run_id: `qa-${shell}-run`, status: 'queued' });
    if (url.pathname === '/wizard/thread-seen') {
      let sent = {}; try { sent = JSON.parse(body); } catch (e) {}
      return json(200, { state: sent.state || { initializedAt: Date.now(), threads: {} } });
    }
    return json(200, {});
  });
}
function bodies(shell, rx) {
  return writes.filter(w => w.shell === shell && rx.test(w.path)).map(w => { try { return JSON.parse(w.body); } catch (e) { return {}; } });
}
async function exercise(browser, shell) {
  const desktop = shell === 'desktop';
  const ctx = await browser.newContext(desktop
    ? { viewport: { width: 1365, height: 850 } }
    : { viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await fence(ctx, shell);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await page.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await page.goto(new URL(desktop ? 'desktop.html' : '?open=chats', URL_).href, { waitUntil: 'domcontentloaded' });
  const root = desktop ? '__wux' : '__wos';
  await page.waitForFunction(root => window[root]?.chats, root, { timeout: 30000 });
  await page.evaluate(root => {
    const api = window[root], w = Object.values(api.wins).find(x => x.app === 'chats');
    api.chats.openNewDraft(w.id, '');
  }, root);
  await page.waitForFunction(() => window.WosModels?.ready, null, { timeout: 30000 });
  const state = await page.evaluate(({ root, astra }) => {
    const api = window[root], w = Object.values(api.wins).find(x => x.app === 'chats');
    const c = api.chats.ch(w.id);
    c.newModel = astra;
    api.chats.renderChats(w);
    const stale = document.querySelector(`[data-chats="${w.id}"] [data-chmodel]`)?.textContent.trim() || '';
    api.chats.openNewDraft(w.id, '');
    const expected = WosModels.defaultOption();
    const chip = document.querySelector(`[data-chats="${w.id}"] [data-chmodel]`)?.textContent.trim() || '';
    return { wid: w.id, stale, chip, expected: { model: expected.value, provider: expected.provider, short: WosModels.short(expected.value, expected.provider) }, override: api.chats.ch(w.id).newModel };
  }, { root, astra: ASTRA });
  ok(/^Astra/.test(state.stale), `${shell}: seeded stale draft override is visible before New chat`, state);
  ok(state.override === null && state.chip.startsWith(state.expected.short), `${shell}: New chat resets to the current Hermes default label`, state);
  ok(/^Opus/.test(state.chip), `${shell}: live configured new-chat default is Opus`, state.chip);
  await page.screenshot({ path: `${OUT}/${shell}-new-chat-opus.png`, fullPage: false });

  // An explicit per-chat choice still wins for this chat and rides with first send.
  await page.evaluate(({ root, wid, astra }) => {
    const api = window[root], w = api.wins[wid], c = api.chats.ch(wid);
    c.newModel = astra; api.chats.renderChats(w);
  }, { root, wid: state.wid, astra: ASTRA });
  const selected = await page.locator(`[data-chats="${state.wid}"] [data-chmodel]`).textContent();
  ok(/^Astra/.test((selected || '').trim()), `${shell}: explicit per-chat Astra choice remains visible`, selected);
  const text = `QA ${shell} explicit model request`;
  await page.locator(`[data-chats="${state.wid}"] .ch-compose textarea`).fill(text);
  await page.locator(`[data-chats="${state.wid}"] .ch-compose button[type="submit"]`).click();
  const sent = await until(() => {
    const session = bodies(shell, /\/api\/sessions$/).find(x => x.model === ASTRA.model);
    const run = bodies(shell, /\/v1\/runs$/).find(x => x.input === text);
    return session && run ? { session, run } : null;
  });
  ok(sent && sent.session.provider === ASTRA.provider && sent.run.model === ASTRA.model && sent.run.provider === ASTRA.provider,
    `${shell}: explicit choice reaches both session creation and outgoing run`, sent || bodies(shell, /\/(api\/sessions|v1\/runs)$/));
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--no-sandbox'] });
  try { await exercise(browser, 'phone'); await exercise(browser, 'desktop'); }
  finally { await browser.close(); }
  console.log(`\n${pass} pass, ${fail} fail · ${writes.length} intercepted writes`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
