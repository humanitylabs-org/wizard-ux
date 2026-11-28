'use strict';
// wizard-ux issue 1965 in a real browser (on for everyone; switch wizard/new-chat-chips removed): a new, empty chat shows a row of quick-link chips
// right above the message box, in this order: Catch me up, What's waiting on me, Plan my day. One tap sends that chip's
// prompt as the owner's message at once (no draft, no confirm), and the chips are gone once the chat has a message. A chat
// that already has messages never shows them, and a device that saved the old switch as off shows them too. Checked on the phone (412 px) and
// the AI apps desktop, in two skins. Synthetic transport only (no box is reached; writes are answered in memory).
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the baseline instead: no chips in a new chat.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://new-chat-chips.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'new-chat-chips-evidence');
const broken = process.env.QA_EXPECT === 'broken', SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
const SHELLS = (process.env.QA_SHELLS || 'phone,desktop').split(',');
const OLD_SWITCH = 'wizard/new-chat-chips'; // removed; a saved choice for it must change nothing
const CHIPS = [['Catch me up', 'catch me up'], ['What’s waiting on me', "What's waiting on me?"], ['Plan my day', 'Plan my day']];
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const ROWS = [{ id: 'qa-old', title: 'Weekend plans', at: now - 6e5 }].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }));
const report = [];

async function setup(browser, skin, phone, staleOff) {
  const context = await browser.newContext(phone
    ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' }
    : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ skin, phone, mix }) => {
    if (window !== top) return;
    if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
    const shell = phone ? { 'wos.shell': 'phone', 'wux.shell': 'phone' } : { 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps' };
    for (const [k, v] of Object.entries({ ...shell, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, 'wos.channel.v1': 'latest',
      'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
  }, { skin, phone, mix: staleOff ? { [OLD_SWITCH]: false } : {} });
  const prefs = { migrations: { 'launcher-seed-v1': true } }, posts = [];
  await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
    if (u.origin !== origin) return r.abort();
    if (!['GET', 'HEAD'].includes(method)) {
      let body = null; try { body = q.postDataJSON(); } catch (_) { body = q.postData(); }
      posts.push({ method, p, body });
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
      if (/\/sessions$/.test(p) || /\/chat/.test(p) || /\/runs?$/.test(p)) return r.fulfill({ json: { ok: true, id: 'qa-new', session_id: 'qa-new', sessionId: 'qa-new', run_id: 'run-1', runId: 'run-1' } });
      return r.fulfill({ json: { ok: true } });
    }
    if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
    if (p.startsWith(prefix)) {
      const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
      if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
      return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
    }
    if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
    if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
    const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
    if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
      return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Done.', timestamp: now / 1000 - 590 }] } : { session: s } }); }
    return r.fulfill({ json: ownerRead(p) });
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
  await page.waitForFunction(() => (window.__wos || window.__wux) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  await nap(800);
  return { context, page, errors, posts };
}

const vis = (page, sel) => page.locator(sel).filter({ visible: true }).first();
async function openNew(page, phone) {
  if (phone) { await page.evaluate(() => __wos.openSheet('inbox')); await nap(500); await vis(page, '.ch-fab').click(); }
  else { await page.locator('body').click({ position: { x: 900, y: 450 } }).catch(() => {}); await vis(page, '.aad-new').click(); }
  await nap(700);
  await vis(page, '.ch-compose textarea').waitFor({ timeout: 10000 });
}
// The chips shown right now, and where they sit against the visible message box.
const chips = page => page.evaluate(() => {
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const row = [...document.querySelectorAll('.ch-quick')].find(shown);
  const box = [...document.querySelectorAll('.ch-compose')].find(f => shown(f) && !f.closest('.ch-chan-compose'));
  if (!row) return { n: 0, labels: [] };
  const r = row.getBoundingClientRect(), b = box?.getBoundingClientRect();
  return { n: row.querySelectorAll('button').length, labels: [...row.querySelectorAll('button')].map(x => x.textContent.trim()), prompts: [...row.querySelectorAll('button')].map(x => x.dataset.chquick),
    aboveBox: !!b && r.bottom <= b.top + 1 && b.top - r.bottom < 40, minH: Math.min(...[...row.querySelectorAll('button')].map(x => x.getBoundingClientRect().height)) };
});
const sends = posts => posts.filter(x => x.body && typeof x.body === 'object' && JSON.stringify(x.body).match(/catch me up|waiting on me|Plan my day/i));

(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) for (const phone of SHELLS.map(s => s === 'phone')) for (const staleOff of broken ? [false] : [false, true]) {
      const stem = `${phone ? 'phone' : 'ai-apps'}-${skin}${staleOff ? '-saved-off' : ''}${broken ? '-before' : ''}`, entry = { stem }; report.push(entry);
      const { context, page, errors, posts } = await setup(browser, skin, phone, staleOff);
      try {
        await openNew(page, phone);
        entry.empty = await chips(page);
        await page.screenshot({ path: path.join(out, stem + '-1-new-chat.png') });
        if (broken) { assert.equal(entry.empty.n, 0, `${stem}: no chips`); entry.pass = true; continue; }
        assert.deepEqual(entry.empty.labels, CHIPS.map(c => c[0]), `${stem}: three chips in order`);
        assert.ok(entry.empty.aboveBox, `${stem}: chips sit right above the message box`);
        if (phone) assert.ok(entry.empty.minH >= 36, `${stem}: chips are big enough to tap`);
        // Typing hides them (a tap would send the chip, not the words); clearing brings them back.
        const ta = vis(page, '.ch-compose textarea');
        await ta.fill('half a thought'); await ta.dispatchEvent('input'); await nap(200);
        entry.typing = (await chips(page)).n;
        assert.equal(entry.typing, 0, `${stem}: hidden while the box has words`);
        await ta.fill(''); await ta.dispatchEvent('input'); await nap(200);
        assert.equal((await chips(page)).n, 3, `${stem}: back once the box is empty`);
        // Each chip in its own new chat: one tap sends its prompt as the owner's message, nothing left in the box.
        entry.taps = [];
        for (const [i, [label, prompt]] of CHIPS.entries()) {
          if (i) await openNew(page, phone);
          const before = sends(posts).length;
          await vis(page, `.ch-quick button:nth-child(${i + 1})`).click();
          await nap(900);
          const sent = sends(posts).slice(before), left = await vis(page, '.ch-compose textarea').inputValue().catch(() => '');
          const bubble = await page.evaluate(p => [...document.querySelectorAll('.msg.u .bub')].some(b => b.getClientRects().length && b.textContent.trim() === p), prompt);
          const after = await chips(page);
          entry.taps.push({ label, sent: sent.map(x => x.p), bubble, left, chipsAfter: after.n });
          if (i === 0) await page.screenshot({ path: path.join(out, stem + '-2-after-tap.png') });
          assert.ok(sent.length >= 1 && sent.some(x => JSON.stringify(x.body).includes(JSON.stringify(prompt).slice(1, -1))), `${stem}: ${label} sent "${prompt}" (${JSON.stringify(sent)})`);
          assert.equal(left, '', `${stem}: ${label} left nothing in the box`);
          assert.equal(after.n, 0, `${stem}: chips gone once the chat has a message`);
        }
        // A chat that already has messages never shows them.
        if (phone) { await page.evaluate(() => __wos.openSheet('inbox')); await nap(400); }
        await vis(page, '[data-chopen="qa-old"], [data-sid="qa-old"], .ch-row:has-text("Weekend plans"), :text("Weekend plans")').click(); await nap(900);
        entry.oldChat = (await chips(page)).n;
        assert.equal(entry.oldChat, 0, `${stem}: an old chat never shows chips`);
        assert.deepEqual(errors, [], `${stem}: no page errors`);
        entry.pass = true;
      } finally { entry.errors = errors; await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, `report${broken ? '-before' : ''}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})().catch(e => { console.error(e); process.exit(1); });
