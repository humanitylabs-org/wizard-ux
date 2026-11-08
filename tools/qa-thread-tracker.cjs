/* Thread tracker browser QA (tweak wizard/thread-tracker). Run on forum via wizard_heavy_submit; never against owner data.
 * A synthetic Wizard (unroutable origin, in-memory service) is served from this checkout; every write is intercepted and
 * recorded, nothing leaves the process. Covers phone + desktop AI-apps layout on two skins.
 *   node tools/qa-thread-tracker.cjs <outdir> [skins=nebula,grove]
 * Prints PASS/FAIL lines; exit 1 on any FAIL. Screenshots land in <outdir>. */
'use strict';
const { chromium } = require('./qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path');
const fx = require('./qa-proof-fixture.cjs');
const OUT = path.resolve(process.argv[2] || '/tmp/qa-thread-tracker'); fs.mkdirSync(OUT, { recursive: true });
const SKINS = (process.argv[3] || 'nebula,grove').split(',');
const WEB = path.resolve(__dirname, '../web');
const ORIGIN = fx.ORIGIN, ID = 'wizard/thread-tracker';
let pass = 0, fail = 0;
const check = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 300) : '')); };

/* ---------- the synthetic service ---------- */
const NOW = Math.floor(Date.now() / 1000);
const mkRows = () => {
  const rows = []; let id = 100;
  // 80 exchanges: the asks anchored in the first ones are older than the 60-turn window the chat opens with.
  for (let i = 1; i <= 80; i++) {
    rows.push({ id: id++, role: 'user', content: `Question number ${i}`, timestamp: NOW - 100000 + i * 100 });
    rows.push({ id: id++, role: 'assistant', content: `Answer number ${i}. ${'Some detail. '.repeat(3)}`, timestamp: NOW - 100000 + i * 100 + 50 });
  }
  return rows;
};
function service() {
  const rows = mkRows(), by = n => rows.find(r => r.content.startsWith(`Answer number ${n}.`));
  const s = {
    writes: [], rows, seen: new Set(),
    items: [
      { id: 'voice-notes', title: 'Voice notes stuck at the bottom', state: 'needs_you', try: true, message_id: String(by(3).id), at: by(3).timestamp * 1000, created_at: 1793500000000 - 7200000, updated_at: by(3).timestamp * 1000 },
      { id: 'tap-lag', title: 'Tap lag on the Chats list', state: 'needs_you', message_id: String(by(78).id), at: by(78).timestamp * 1000, created_at: 1793500000000 - 7200000, updated_at: by(78).timestamp * 1000 },
      { id: 'export', title: 'Export my notes', state: 'running', message_id: String(by(79).id), at: by(79).timestamp * 1000, created_at: 1793500000000 - 7200000, updated_at: by(79).timestamp * 1000 },
      { id: 'dark-mode', title: 'Dark mode contrast', state: 'running', message_id: String(by(80).id), at: by(80).timestamp * 1000, created_at: 1793500000000 - 7200000, updated_at: by(80).timestamp * 1000 },
      { id: 'backup', title: 'Nightly backup check', state: 'done', message_id: String(by(77).id), at: by(77).timestamp * 1000, created_at: 1793500000000 - 7200000, updated_at: by(77).timestamp * 1000 },
      { id: 'icons', title: 'New app icons', state: 'done', message_id: String(by(10).id), at: by(10).timestamp * 1000, created_at: 1793500000000 - 7200000, updated_at: by(10).timestamp * 1000 },
      { id: 'old-fix', title: 'Fixed the clock', state: 'done', message_id: String(by(5).id), at: by(5).timestamp * 1000, created_at: 1793500000000 - 7200000, updated_at: by(5).timestamp * 1000 },
    ],
  };
  s.view = () => s.items.map(i => ({ ...i, seen: s.seen.has(i.id) }));
  s.counts = () => { const c = { needs_you: 0, running: 0, done_unseen: 0, blocked: 0, acknowledged: 0, total: 0 };
    for (const i of s.view()) { c.total++; if (i.state === 'done') i.seen ? c.acknowledged++ : c.done_unseen++; else if (i.state === 'needs_you') (i.try && i.seen) ? c.acknowledged++ : c.needs_you++; else if (i.state === 'blocked') c.blocked++; else c.running++; }
    return c; };
  s.seen.add('old-fix');
  return s;
}
let WORKING = false; // true: the main thread has a live run, so a reply is steered into it
const session = (id, title, n) => ({ ...fx.row, id, title: id === 'tt-main' ? 'Wizard polish round — a deliberately long thread title that must truncate before the status dots and timestamp' : title, message_count: n, last_active: NOW, wizard_last_assistant_at: NOW, wizard_last_user_at: NOW - 30,
  ...(!WORKING && id === 'tt-main' ? { wizard_attention: { state: 'needs_you', ask: 'Review this polish round' }, wizard_background: 'helper' } : {}),
  ...(WORKING && id === 'tt-main' ? { status: 'running', wizard_run_id: 'run-live-1', wizard_status: 'running' } : {}) });

async function mount(browser, svc, { shell, skin, tweaks, storage, docScroll = false }) {
  const phone = shell === 'phone';
  const ctx = await browser.newContext({ viewport: phone ? { width: 412, height: 860 } : { width: 1360, height: 860 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, serviceWorkers: 'block',
    userAgent: phone ? 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' + (docScroll ? ' WizardOS-DocScroll' : '') : undefined });
  const errors = []; ctx.errors = errors;
  await ctx.addInitScript(({ skin, mix, keep }) => {
    if (window !== top) return;
    if (!sessionStorage.getItem('qa.seeded')) {
      sessionStorage.setItem('qa.seeded', '1');
      for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.tour.v1': 'true', 'wos.skin': skin })) localStorage.setItem(k, v);
      if (!keep) localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify({ version: 1, mix }));
    }
  }, { skin, mix: Object.fromEntries(tweaks.map(t => [t, true])), keep: !!storage });
  await ctx.route('**/*', async route => {
    const q = route.request(), url = new URL(q.url()), m = q.method(), p = url.pathname;
    if (url.origin !== ORIGIN) return route.abort();
    (svc.reqs ||= []).push(m + ' ' + p);
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.startsWith('/wizard-os-home/') && !p.startsWith('/wizard-os-home/store-')) {
      const rel = p.slice('/wizard-os-home/'.length) || (shell === 'desktop' ? 'desktop.html' : 'index.html');
      const file = path.resolve(WEB, decodeURIComponent(rel));
      if (file.startsWith(WEB + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        if (process.env.QA_SERVED_BASE && !['data.js', 'summaries.js', 'ux-changes.json'].includes(rel)) {
          const r = await fetch(process.env.QA_SERVED_BASE + '/wizard-os-home/' + rel, { headers: { 'Cache-Control': 'no-cache' }, redirect: 'error' });
          const bytes = Buffer.from(await r.arrayBuffer());
          if (r.status !== 200 || !bytes.equals(fs.readFileSync(file))) throw new Error(`Served static mismatch: ${rel} (${r.status})`);
          return route.fulfill({ status: 200, body: bytes, contentType: /\.js$/.test(rel) ? 'text/javascript' : /\.css$/.test(rel) ? 'text/css' : /\.html$/.test(rel) ? 'text/html' : undefined });
        }
        return route.fulfill({ path: file });
      }
    }
    if (p === '/wizard/v1/thread-items/counts') return json({ threads: { 'hermes/tt-main': svc.counts() } });
    if (p === '/wizard/v1/thread-items/seen' && m === 'POST') {
      const b = JSON.parse(q.postData() || '{}'); svc.writes.push({ m, p, b });
      svc.beforeSeen?.();
      if (!svc.legacySeen && Array.isArray(b.items)) {
        const results = b.items.map(({id,updated_at}) => {
          const matches = svc.items.find(i => i.id === id)?.updated_at === updated_at;
          if (matches) svc.seen.add(id);
          return {id,status:matches?'acknowledged':'stale'};
        });
        return json({ thread: b.thread, items: svc.view(), counts: svc.counts(), results });
      }
      for (const id of b.ids || []) svc.seen.add(id);
      return json({ thread: b.thread, items: svc.view(), counts: svc.counts() });
    }
    if (p === '/wizard/v1/thread-items') return json({ thread: url.searchParams.get('thread'), items: url.searchParams.get('thread') === 'tt-main' ? svc.view() : [], counts: svc.counts() });
    if (p === '/wizard/hermes/api/sessions' && m === 'GET') return json({ data: svc.sessionRows ? svc.sessionRows() : [session('tt-main', 'Wizard polish round', svc.rows.length), session('tt-other', 'Plain old thread', 2)], has_more: false });
    const one = p.match(/^\/wizard\/hermes\/api\/sessions\/(tt-[a-z]+)(\/messages)?$/);
    if (one && m === 'GET') {
      if (!one[2]) return json({ session: session(one[1], one[1] === 'tt-main' ? 'Wizard polish round' : 'Plain old thread', one[1] === 'tt-main' ? svc.rows.length : 2) });
      const rows = one[1] === 'tt-main' ? svc.rows : svc.rows.slice(0, 2);
      const offset = +url.searchParams.get('offset') || 0, limit = +url.searchParams.get('limit') || 100;
      return json({ data: rows.slice(offset, offset + limit), has_more: offset + limit < rows.length });
    }
    if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
      let body = q.postData() || ''; svc.writes.push({ m, p, body });
      if (/\/v1\/runs$/.test(p)) return json({ run_id: 'run-1', status: 'started' }, 202);
      if (/\/steer$/.test(p)) return json({ ok: true, status: 'steered' });
      if (p === '/wizard/thread-seen') return json(fx.read('/wizard/thread-seen'));
      return json({ ok: true });
    }
    const r = fx.response(p + url.search, m);
    if (r.status === 451) { const bare = fx.response(p, m); if (bare.status !== 451) return route.fulfill({ status: bare.status, contentType: bare.contentType, body: bare.body }); }
    return route.fulfill({ status: r.status, contentType: r.contentType, body: r.body });
  });
  const page = await ctx.newPage(); global.LASTPAGE = page;
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const base = ORIGIN + '/wizard-os-home/' + (phone ? '' : 'desktop.html');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.__wos || window.__wux), null, { timeout: 25000 });
  // The real switch (Settings › Tweaks calls the same function); the choice caches on the device and syncs through the box.
  if (tweaks.length) {
    await page.waitForFunction(() => window.WosExperience && !window.WosExperience.state.busy, null, { timeout: 25000 });
    for (const id of tweaks) {
      await page.evaluate(async id => { if (!(window.WosExperience.state.active || []).includes(id)) await window.WosExperience.toggle(id); }, id);
      await page.waitForFunction(() => !window.WosExperience.state.busy, null, { timeout: 25000 });
    }
  }
  return { ctx, page, base };
}

const tt = page => page.evaluate(() => ({ on: window.WosThreadTracker?.on?.(), tweaks: document.documentElement.dataset.tweaks || '' }));
async function openThread(page, id) {
  await page.evaluate(sid => (window.__wux ? window.__wux.openThread(sid) : window.__wos.openWizardThread(sid)), id);
  await page.waitForSelector('.ch-thread .msg', { timeout: 20000 });
}
const strip = page => page.locator('[data-tt-strip]').first();
const msgText = (page, mid) => page.evaluate(m => document.querySelector(`.msg[data-mid="${m}"]`)?.textContent.trim().slice(0, 60) || null, mid);
const isVisibleInScroller = (page, sel) => page.evaluate(s => { const n = document.querySelector(s); if (!n) return false; const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 2; }, sel);

module.exports = { mount, service };

if (require.main === module) (async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    /* ---- 1. fresh profile: off, and offered in Settings ---- */
    {
      const svc = service(); const { ctx, page } = await mount(browser, svc, { shell: 'phone', skin: 'nebula', tweaks: [] });
      await page.waitForTimeout(2500);
      await page.waitForFunction(() => window.WosExperience && !window.WosExperience.state.busy, null, { timeout: 20000 }).catch(() => {});
      const st = await page.evaluate((id) => ({ listed: (window.WosExperience.state.tweaks || []).some(t => t.id === id), active: (window.WosExperience.state.active || []).includes(id) }), ID);
      check('fresh profile: tweak is listed in Settings › Tweaks', st.listed, st);
      check('fresh profile: tweak is OFF', !st.active && !(await tt(page)).on);
      await openThread(page, 'tt-main'); await page.waitForTimeout(800);
      check('off: no strip, no Reply, no message ids', (await page.locator('[data-tt-strip], [data-mquote], [data-mid]').count()) === 0);
      check('off: nothing asked of the tracker API', !(svc.reqs || []).some(r => /thread-items/.test(r)), (svc.reqs || []).filter(r => /thread-items/.test(r)));
      await page.screenshot({ path: path.join(OUT, 'off-phone.png') });
      check('off: no page errors', ctx.errors.length === 0, ctx.errors); await ctx.close();
    }
    /* ---- late Look: the thread is already open before the host mounts the tweak ---- */
    if (!process.env.QA_STATE_ONLY) for (const skin of SKINS) for (const shell of ['phone', 'desktop']) {
      const tag = `late/${shell}/${skin}`, svc = service();
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [] });
      await page.waitForFunction(() => window.WosExperience && !window.WosExperience.state.busy);
      if (shell === 'desktop') await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
      await openThread(page, 'tt-main');
      check(`${tag}: thread starts open with tracker off`, !(await tt(page)).on && await page.locator('.ch-thread .msg').count() > 0 && await strip(page).count() === 0);
      // Desktop uses the exact Look-sync adoption path (no tweak-choice event); phone uses the Settings toggle.
      await page.evaluate(async ({ id, shell }) => {
        const x = window.WosExperience;
        if (shell === 'desktop') await x.adopt({ ...x.mix, [id]: true }, x.views);
        else await x.toggle(id);
      }, { id: ID, shell });
      const appeared = await page.waitForSelector('[data-tt-strip] .tt-h', { timeout: 5000 }).then(() => true, () => false);
      check(`${tag}: enabling hydrates the strip without reopening`, appeared, (svc.reqs || []).filter(r => /thread-items/.test(r)));
      check(`${tag}: Reply appears on the already-open messages`, await page.locator('[data-mquote]').count() > 0);
      if (appeared) {
        await page.locator('.ch-compose textarea').fill('Keep my draft');
        await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-late-on.png`) });
        await strip(page).locator('.tt-h').click();
        check(`${tag}: dropdown paints before the next frame without an API roundtrip`, await strip(page).locator('.tt-panel').isVisible());
      }
      await page.evaluate(async id => { const x = window.WosExperience; await x.adopt({ ...x.mix, [id]: false }, x.views); }, ID);
      await page.waitForFunction(() => !window.WosThreadTracker.on());
      await page.waitForFunction(() => !document.querySelector('[data-tt-strip], [data-mquote], [data-tt-dots]'), null, { timeout: 5000 }).catch(() => {});
      check(`${tag}: disabling removes strip, Reply and dots without reload`, await page.locator('[data-tt-strip], [data-mquote], [data-tt-dots]').count() === 0 && !(await page.evaluate(() => window.WosThreadTracker.isOpen())));
      if (appeared) check(`${tag}: draft survives the Look change`, await page.locator('.ch-compose textarea').inputValue() === 'Keep my draft');
      await page.evaluate(async id => { const x = window.WosExperience; await x.adopt({ ...x.mix, [id]: true }, x.views); }, ID);
      if (shell === 'phone') await page.locator('[data-chback]').first().click();
      const dots = await page.waitForSelector('[data-tt-dots="hermes/tt-main"]', { timeout: 5000 }).then(() => true, () => false);
      check(`${tag}: Chats list dots appear without reopening the thread`, dots);
      check(`${tag}: no agent runs or steers`, !svc.writes.some(w => /\/v1\/runs|\/steer$/.test(w.p)));
      check(`${tag}: no page errors`, ctx.errors.length === 0, ctx.errors);
      await ctx.close();
    }
    /* ---- reply synthesis: old per-ask API counts deliberately retained for rolling-upgrade proof ---- */
    if (!process.env.QA_STATE_ONLY) for (const skin of SKINS) for (const shell of ['phone', 'desktop']) {
      const tag = `grouped/${shell}/${skin}`, svc = service(); svc.legacySeen = true;
      const anchor = svc.items.find(i => i.id === 'tap-lag');
      svc.items = [
        { ...anchor, id: 'nightly', title: 'Nightly maintenance helper', state: 'needs_you', try: true },
        { ...anchor, id: 'messenger', title: 'Messenger sign-in code', state: 'done' },
        { ...anchor, id: 'old', title: 'Nightly checks', state: 'done' },
      ];
      svc.seen = new Set(['old']);
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [ID] });
      if (shell === 'desktop') await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
      await page.waitForFunction(() => /1 need you/.test(window.WosThreadTracker.dots('tt-main')) && !/finished, not seen/.test(window.WosThreadTracker.dots('tt-main')));
      check(`${tag}: unopened Chats dots count replies even with old backend counts`, await page.evaluate(() => { const d = window.WosThreadTracker.dots('tt-main'); return /1 need you/.test(d) && !/finished, not seen|<b>/.test(d); }));
      await openThread(page, 'tt-main'); await page.waitForSelector('[data-tt-strip] .tt-h');
      check(`${tag}: three asks on one reply count as 1 ask`, /^1 open/.test(await strip(page).locator('.tt-h').innerText()));
      await strip(page).locator('.tt-h').click();
      check(`${tag}: one synthesized row with member count`, await strip(page).locator('.tt-row').count() === 1 && /Nightly maintenance helper · Messenger sign-in code · Nightly checks/.test(await strip(page).innerText()) && /3 asks in one reply · Review this polish round/.test(await strip(page).innerText()));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => document.getAnimations().every(a => a.effect?.getComputedTiming().iterations === Infinity || a.playState !== 'running'));
      const geometry = await page.evaluate(() => { const s = document.querySelector('[data-tt-strip] .tt-panel'), n = s?.querySelector('.tt-t'), r = s?.getBoundingClientRect(); return { skin: document.documentElement.dataset.skin, shell: document.documentElement.dataset.shell, ellipsis: n && getComputedStyle(n).textOverflow, whiteSpace: n && getComputedStyle(n).whiteSpace, visible: r && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && s.contains(document.elementFromPoint(r.left + 8, r.top + 8)) }; });
      check(`${tag}: settled single-line ellipsis, visible on the correct skin and shell`, geometry?.visible && geometry.ellipsis === 'ellipsis' && geometry.whiteSpace === 'nowrap' && geometry.skin === skin && geometry.shell === shell, geometry);
      await page.screenshot({ path: path.join(OUT, `grouped-${shell}-${skin}.png`) });
      // Open the synthesized reply rather than any separate issue, then use the group's single Seen action.
      await strip(page).locator('.tt-row .tt-ti').click();
      await page.waitForSelector(`.msg[data-mid="${anchor.message_id}"].tt-flash`);
      check(`${tag}: group Open jumps to its one reply`, await page.locator(`.msg[data-mid="${anchor.message_id}"].tt-flash`).count() === 1);
      await strip(page).locator('.tt-h').click();
      await strip(page).locator('[data-tt-dismiss]').click();
      check(`${tag}: group Dismiss clears all local dots immediately`, await page.evaluate(() => window.WosThreadTracker.dots('tt-main') === ''));
      await page.waitForFunction(() => !document.querySelector('[data-tt-strip]'));
      check(`${tag}: last addressable Seen removes the entire strip`, await strip(page).count() === 0);
      check(`${tag}: Seen sends every member id and service readback agrees`, svc.writes.some(w => w.p.endsWith('/thread-items/seen') && JSON.stringify([...w.b.ids].sort()) === JSON.stringify(['messenger', 'nightly', 'old'])) && svc.view().every(i => i.seen));
      // Move one ask to a newer reply, as the canonical per-id ledger does. Only its new update becomes unseen.
      svc.items[0] = { ...svc.items[0], message_id: svc.items[0].message_id + '-new', updated_at: Date.now(), state: 'blocked' };
      svc.seen.delete('nightly');
      await page.evaluate(() => window.WosThreadTracker.loadCounts(true));
      await page.waitForFunction(() => /^1 open/.test(document.querySelector('[data-tt-strip] .tt-h')?.innerText));
      await strip(page).locator('.tt-h').click();
      await strip(page).locator('[data-tt-ack]').click();
      check(`${tag}: asks on two current replies produce two rows`, await strip(page).locator('.tt-row').count() === 2);
      check(`${tag}: newer update resurfaces only its reply dot`, await page.evaluate(() => /1 stuck/.test(window.WosThreadTracker.dots('tt-main')) && !/need you|finished, not seen/.test(window.WosThreadTracker.dots('tt-main'))));
      await page.screenshot({ path: path.join(OUT, `grouped-two-${shell}-${skin}.png`) });
      check(`${tag}: no runs, steers or page errors`, !svc.writes.some(w => /\/v1\/runs|\/steer$/.test(w.p)) && ctx.errors.length === 0, ctx.errors);
      await ctx.unrouteAll({ behavior: 'wait' }); await ctx.close();
    }
    /* ---- visibility: only acknowledged history has no strip or reserved space ---- */
    for (const skin of SKINS) for (const shell of ['phone', 'desktop']) {
      const tag = `hide/${shell}/${skin}`, svc = service(), anchor = svc.items.find(i => i.id === 'tap-lag');
      svc.items = [{ ...anchor, state: 'done' }]; svc.seen = new Set([anchor.id]);
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [ID] });
      if (shell === 'desktop') await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
      await openThread(page, 'tt-main'); await page.waitForTimeout(700);
      check(`${tag}: all acknowledged has no strip`, await strip(page).count() === 0);
      await page.screenshot({ path: path.join(OUT, `hide-acknowledged-${shell}-${skin}.png`) });
      await page.evaluate(() => {
        window.addEventListener('wos:thread-tracker', () => {
          window.__hideReply = document.querySelector('.ch-msgs .msg.a');
          window.__hideComposer = document.querySelector('.ch-compose textarea');
        }, true); // Capture each event's pre-paint nodes, not nodes from earlier background polls.
        window.__hideFrames = [];
        window.addEventListener('wos:thread-tracker', () => window.__hideFrames.push({
          strip: !!document.querySelector('[data-tt-strip]'), expected: !!window.WosThreadTracker.stripHtml('tt-main'),
          replySame: window.__hideReply === document.querySelector('.ch-msgs .msg.a'),
          composerSame: window.__hideComposer === document.querySelector('.ch-compose textarea')
        }));
      });
      const update = async state => {
        svc.items = [{ ...anchor, state, updated_at: Date.now(), try: true }]; svc.seen.clear();
        await page.waitForTimeout(2600); await page.evaluate(() => window.WosThreadTracker.loadCounts(true));
        await page.waitForFunction(state => window.WosThreadTracker.dots('tt-main').includes(state), state === 'running' ? 'running' : state === 'done' ? 'finished, not seen' : 'need you');
      };
      await update('running');
      check(`${tag}: running-only shows strip and retains running dots`, await strip(page).count() === 1 && await page.evaluate(() => /running/.test(window.WosThreadTracker.dots('tt-main'))));
      await strip(page).locator('.tt-h').click();
      check(`${tag}: running-only dropdown stays open with a Working row`, await strip(page).locator('.tt-panel').isVisible() && /Working/.test(await strip(page).innerText()) && await strip(page).locator('.tt-row.run').count() === 1);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => document.getAnimations().every(a => a.effect?.getComputedTiming().iterations === Infinity || a.playState !== 'running'));
      await page.screenshot({ path: path.join(OUT, `running-only-${shell}-${skin}.png`) });
      await strip(page).locator('.tt-h').click();
      await update('done');
      check(`${tag}: one unseen green shows strip`, await strip(page).count() === 1);
      await strip(page).locator('.tt-h').click(); await strip(page).locator('[data-tt-seen]').click();
      check(`${tag}: last Seen removes strip before next frame`, await strip(page).count() === 0);
      await update('needs_you');
      await strip(page).locator('.tt-h').click(); await strip(page).locator('[data-tt-dismiss]').click();
      check(`${tag}: last Dismiss removes strip before next frame`, await strip(page).count() === 0);
      for (const state of ['done', 'needs_you']) {
        svc.items = [{ ...anchor, state, try: true, updated_at: Date.now() }, { ...anchor, id: 'still-running', state: 'running', message_id: anchor.message_id + '-running' }]; svc.seen.clear();
        await page.waitForTimeout(2600); await page.evaluate(() => window.WosThreadTracker.loadCounts(true));
        await page.waitForFunction(() => /^2 open/.test(document.querySelector('[data-tt-strip] .tt-h')?.innerText));
        await strip(page).locator('.tt-h').click(); await strip(page).locator(state === 'needs_you' ? '[data-tt-dismiss]' : '[data-tt-seen]').click();
        check(`${tag}: last ${state} acknowledgement keeps running strip and open dropdown`, await strip(page).count() === 1 && await strip(page).locator('.tt-panel').isVisible() && await strip(page).locator('.tt-row.run').count() === 1 && await page.evaluate(() => /running/.test(window.WosThreadTracker.dots('tt-main')) && !/need you|finished, not seen/.test(window.WosThreadTracker.dots('tt-main'))));
        if (state === 'needs_you') await page.screenshot({ path: path.join(OUT, `running-after-seen-${shell}-${skin}.png`) });
        await strip(page).locator('.tt-h').click();
      }
      const frames = await page.evaluate(() => window.__hideFrames);
      check(`${tag}: every update paints presence synchronously without replacing messages or composer`, frames.length >= 4 && frames.every(f => f.strip === f.expected && f.replySame && f.composerSame), frames);
      check(`${tag}: no runs, steers or page errors`, !svc.writes.some(w => /\/v1\/runs|\/steer$/.test(w.p)) && ctx.errors.length === 0, ctx.errors);
      await page.screenshot({ path: path.join(OUT, `running-collapsed-${shell}-${skin}.png`) });
      svc.items = [{ ...anchor, state: 'needs_you' }, ...['ack-a','ack-b','ack-c'].map(id => ({...anchor, id, message_id:id, state:'done'}))];
      svc.seen = new Set(['ack-a','ack-b','ack-c']);
      await page.waitForTimeout(2600); await page.evaluate(() => window.WosThreadTracker.loadCounts(true));
      await page.waitForFunction(() => document.querySelector('.tt-tot')?.textContent === '1 open');
      await strip(page).locator('.tt-h').click();
      check(`${tag}: 1 amber plus 3 acknowledged reads 1 open and keeps history footer`, await strip(page).locator('.tt-tot').innerText() === '1 open' && await strip(page).locator('.tt-more').innerText() === '3 acknowledged · show');
      await page.screenshot({ path: path.join(OUT, `running-open-count-${shell}-${skin}.png`) });
      await ctx.close();
    }
    /* ---- amber Dismiss: exact versions, Ready's existing Done action, newer asks return ---- */
    for (const skin of SKINS) for (const shell of ['phone','desktop']) {
      const tag=`dismiss/${shell}/${skin}`,svc=service(),anchor=svc.items[1];
      svc.items=[{...anchor,id:'a',state:'needs_you',ask:'Reply resend to send it'}];svc.seen.clear();
      const {ctx,page}=await mount(browser,svc,{shell,skin,tweaks:[ID]});
      if(shell==='desktop')await page.evaluate(()=>window.WosExperience.chooseDesktopView('ai-apps'));
      await openThread(page,'tt-main');await page.waitForSelector('[data-tt-strip]');await strip(page).locator('.tt-h').click();
      check(`${tag}: second line names the action`,/Reply resend to send it/.test(await strip(page).locator('.tt-s').innerText()));
      await page.screenshot({path:path.join(OUT,`dismiss-before-${shell}-${skin}.png`)});
      svc.beforeSeen=()=>{svc.items=svc.items.map(i=>({...i,ask:'Approve the newer send',updated_at:Date.now()}));};
      await strip(page).locator('[data-tt-dismiss]').click();
      await page.waitForFunction(()=>/need you/.test(window.WosThreadTracker.dots('tt-main')));
      await page.waitForFunction(()=>window.WizLive.session('tt-main')?.archived!==true);
      check(`${tag}: stale stays unseen and Ready Done rolls back`,!svc.view()[0].seen&&!svc.writes.some(w=>w.m==='PATCH'));
      svc.beforeSeen=null;
      const frame=await page.evaluate(()=>{document.querySelector('[data-tt-dismiss]').click();return {cleared:window.WosThreadTracker.stripHtml('tt-main')==='',readyCleared:window.WizLive.session('tt-main')?.archived===true};});
      check(`${tag}: last amber and Ready clear in the tap frame`,frame.cleared&&frame.readyCleared,frame);
      await page.waitForFunction(()=>!window.WizLive.busy('tt-main'));
      check(`${tag}: Done persists only after matching per-id Seen`,svc.view()[0].seen&&svc.writes.some(w=>w.p.endsWith('/thread-items/seen')&&w.b.items?.[0].id==='a')&&svc.writes.some(w=>w.m==='PATCH'&&/tt-main/.test(w.p)));
      svc.items=svc.items.map(i=>({...i,ask:'Try the changed reply',updated_at:Date.now()+1}));svc.seen.clear();
      await page.waitForTimeout(2600);await page.evaluate(()=>window.WosThreadTracker.loadCounts(true));
      await page.waitForFunction(()=>/need you/.test(window.WosThreadTracker.dots('tt-main')));
      check(`${tag}: newer ask returns unseen`,!svc.view()[0].seen&&await strip(page).count()===1);
      await strip(page).locator('.tt-h').click();await page.screenshot({path:path.join(OUT,`dismiss-newer-${shell}-${skin}.png`)});
      check(`${tag}: no page errors`,ctx.errors.length===0,ctx.errors);await ctx.close();
    }
    /* ---- the owner's reply answers older amber and red asks (James, 6 Nov): no red, count drops, a re-tag returns ---- */
    for (const skin of SKINS) for (const shell of ['phone', 'desktop']) {
      const tag = `answered/${shell}/${skin}`, svc = service(), anchor = svc.items[1], at = anchor.at;
      svc.items = [{ ...anchor, id: 'airlock-marker-screenshots', title: 'Marker screenshots', state: 'blocked', message_id: 'm-air', ask: '' },
        { ...anchor, id: 'airlock-redact-marker', title: 'Redact the marker', state: 'needs_you', message_id: 'm-air', ask: 'Reply redact to retry' }];
      svc.seen.clear();
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [ID] });
      if (shell === 'desktop') await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
      await openThread(page, 'tt-main'); await page.waitForSelector('[data-tt-strip]');
      check(`${tag}: before the reply the strip reads 1 open with a red count`, /^1 open/.test(await strip(page).locator('.tt-h').innerText()) && await strip(page).locator('.tt-h .tt-dot.bad').count() === 1);
      await strip(page).locator('.tt-h').click(); await page.screenshot({ path: path.join(OUT, `answered-before-${shell}-${skin}.png`) });
      await page.locator('.ch-compose textarea').fill('Reply redact: yes please retry');
      const frame = await page.evaluate(() => { document.querySelector('[data-chform]').requestSubmit(); const h = window.WosThreadTracker.stripHtml('tt-main'), d = window.WosThreadTracker.dots('tt-main');
        return { red: /tt-dot bad|tt-dot you/.test(h) || /stuck|need you/.test(d), open: /\d+ open/.test(h), working: /Working on your reply/.test(h), spinner: /tt-dot run/.test(h) }; });
      check(`${tag}: in the send frame no red or amber, the count drops, a spinner shows`, !frame.red && !frame.open && frame.working && frame.spinner, frame);
      for (let n = 0; n < 50 && !svc.writes.some(w => /\/v1\/runs$|\/steer$/.test(w.p)); n++) await page.waitForTimeout(100);
      await page.waitForTimeout(400);
      check(`${tag}: answered asks are never acknowledged in the box`, !svc.writes.some(w => w.p.endsWith('/thread-items/seen')) && svc.seen.size === 0, svc.writes.map(w => w.p));
      await page.screenshot({ path: path.join(OUT, `answered-working-${shell}-${skin}.png`) });
      // The agent's next reply re-lists the red ask: a new server version on a new reply.
      svc.items = svc.items.map(i => i.id === 'airlock-marker-screenshots' ? { ...i, message_id: 'm-next', updated_at: Date.now() + 5, ask: 'Reply screenshots to continue' } : i);
      await page.waitForTimeout(2600); await page.evaluate(() => window.WosThreadTracker.loadCounts(true));
      await page.waitForFunction(() => /stuck/.test(window.WosThreadTracker.dots('tt-main')));
      if (!(await page.locator('[data-tt-strip]').count())) await openThread(page, 'tt-main'); // phone send-and-go left the thread
      await page.waitForSelector('[data-tt-strip] .tt-h', { timeout: 8000 }).catch(() => {});
      const back = await page.evaluate(() => ({ html: window.WosThreadTracker.stripHtml('tt-main').slice(0, 600), dots: window.WosThreadTracker.dots('tt-main'), st: window.WizLive.session('tt-main')?.status }));
      check(`${tag}: the agent's re-tag brings the ask back; the untouched one stays answered`, /^1 open/.test((await strip(page).locator('.tt-h').innerText({ timeout: 3000 }).catch(() => ''))) && await strip(page).locator('.tt-h .tt-dot.bad').count() === 1, back);
      await strip(page).locator('.tt-h').click(); await page.screenshot({ path: path.join(OUT, `answered-retag-${shell}-${skin}.png`) });
      check(`${tag}: no page errors`, ctx.errors.length === 0, ctx.errors); await ctx.close();
    }
    /* ---- running work keeps the strip (James's live repro: Shell split 12 running + 1 unseen done, Thread tracker 6 running) ---- */
    for (const skin of SKINS) for (const shell of ['phone', 'desktop']) for (const shape of ['mixed', 'running-only']) {
      const tag = `running-strip/${shape}/${shell}/${skin}`, svc = service(), anchor = svc.items[1];
      const mk = (id, state, mid, extra = {}) => ({ ...anchor, id, title: id, state, message_id: mid, ...extra });
      let expected;
      if (shape === 'mixed') {
        // One reply mixes 4 running members with 1 unseen finished member; 8 more running replies; 5 finished and seen.
        svc.items = [...[1, 2, 3, 4].map(n => mk(`split-run-${n}`, 'running', 'r-0')), mk('split-done', 'done', 'r-0'),
          ...Array.from({ length: 8 }, (_, n) => mk(`split-run-${n + 5}`, 'running', `r-${n + 1}`)),
          ...Array.from({ length: 5 }, (_, n) => mk(`split-old-${n}`, 'done', `d-${n}`))];
        svc.seen = new Set(svc.items.filter(i => i.id.startsWith('split-old')).map(i => i.id)); expected = 9;
      } else {
        svc.items = [...Array.from({ length: 6 }, (_, n) => mk(`tracker-run-${n}`, 'running', `r-${n}`)), ...Array.from({ length: 9 }, (_, n) => mk(`tracker-old-${n}`, 'done', `d-${n}`))];
        svc.seen = new Set(svc.items.filter(i => i.id.startsWith('tracker-old')).map(i => i.id)); expected = 6;
      }
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [ID] });
      if (shell === 'desktop') await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
      await openThread(page, 'tt-main'); await page.waitForSelector('[data-tt-strip]');
      check(`${tag}: the strip shows, with ${expected} open`, new RegExp(`^${expected} open`).test(await strip(page).locator('.tt-h').innerText()), await strip(page).locator('.tt-h').innerText());
      await strip(page).locator('.tt-h').click(); await page.screenshot({ path: path.join(OUT, `running-strip-${shape}-${shell}-${skin}.png`) });
      check(`${tag}: no page errors`, ctx.errors.length === 0, ctx.errors); await ctx.close();
    }
    if (process.env.QA_ONLY_NEW) { console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0); }
    /* ---- explicit owner sends acknowledge old green before phone send-and-go ---- */
    for (const skin of SKINS) for (const shell of ['phone', 'desktop']) for (const working of [false, true]) {
      WORKING = working;
      const tag = `send-seen/${shell}/${skin}/${working ? 'steer' : 'send'}`, svc = service();
      svc.items = svc.items.filter(i => ['voice-notes','icons','tap-lag','export','dark-mode'].includes(i.id)).map(i => ({...i,state:['voice-notes','icons'].includes(i.id)?'done':i.id==='tap-lag'?'needs_you':i.id==='export'?'blocked':'running',try:false})); svc.seen.clear();
      const {ctx,page}=await mount(browser,svc,{shell,skin,tweaks:[ID]});
      if(shell==='desktop')await page.evaluate(()=>window.WosExperience.chooseDesktopView('ai-apps'));
      await openThread(page,'tt-main'); await page.waitForSelector('[data-tt-strip]');
      if(!working){
        await page.locator('.ch-compose textarea').fill('Synthetic failed save keeps my unread green rows');
        const refused=await page.evaluate(async()=>{
          const ob=window.WosOutbox,original=ob.enqueue;ob.enqueue=()=>Promise.reject(Error('Synthetic storage refusal'));
          try{document.querySelector('[data-chform]').requestSubmit();await new Promise(r=>setTimeout(r,0));return {green:/finished, not seen/.test(window.WosThreadTracker.dots('tt-main')),draft:document.querySelector('.ch-compose textarea')?.value};}finally{ob.enqueue=original;}
        });
        check(`${tag}: failed durable save restores green without synchronizing Seen`,refused.green && !svc.writes.some(w=>w.p.endsWith('/thread-items/seen')),refused);
        await page.screenshot({path:path.join(OUT,`running-save-refused-${shell}-${skin}.png`)});
      }
      await page.locator('.ch-compose textarea').fill('Synthetic follow-up after reading the earlier replies');
      const immediate=await page.evaluate(()=>{document.querySelector('[data-chform]').requestSubmit();const d=window.WosThreadTracker.dots('tt-main');return {green:/finished, not seen/.test(d),amber:/need you/.test(d),red:/stuck/.test(d),running:/running/.test(d)};});
      check(`${tag}: green clears and the reply answers amber and red in the send frame; running stays`, !immediate.green && !immediate.amber && !immediate.red && immediate.running,immediate);
      for(let n=0;n<50&&!svc.writes.some(w=>/\/v1\/runs$|\/steer$/.test(w.p));n++)await page.waitForTimeout(100);
      check(`${tag}: shared Seen path sends both older green ids and no action-needed ids`,svc.writes.some(w=>w.p.endsWith('/thread-items/seen')&&JSON.stringify([...w.b.ids].sort())===JSON.stringify(['icons','voice-notes'])));
      check(`${tag}: actual ${working?'steer':'send'} is intercepted`,svc.writes.some(w=>working?/\/steer$/.test(w.p):/\/v1\/runs$/.test(w.p)));
      check(`${tag}: no page errors`,ctx.errors.length===0,ctx.errors);
      await page.screenshot({path:path.join(OUT,`running-send-seen-${shell}-${skin}-${working?'steer':'send'}.png`)});
      await ctx.unrouteAll({behavior:'wait'});await ctx.close();
    }
    WORKING=false;
    /* ---- sender clock never admits a completion after the send ---- */
    for (const skin of SKINS) for (const shell of ['phone', 'desktop']) for (const skew of [-60000, 0, 60000]) {
      const svc = service(), at = Date.now(), anchor = svc.items[0];
      svc.items = [{ ...anchor, id: 'old', state: 'done', message_id: 'old', at: at - 10000, updated_at: at - 10000 },
        { ...anchor, id: 'job', state: 'running', message_id: 'job', at: at - 10000, updated_at: at - 10000 }]; svc.seen.clear();
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [ID] });
      await page.evaluate(skew => { const now = Date.now.bind(Date); Date.now = () => now() + skew; Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); }, skew);
      if (shell === 'desktop') await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
      await openThread(page, 'tt-main'); await page.waitForSelector('[data-tt-strip]');
      await page.evaluate(() => { window.__sendLease = window.WosThreadTracker.beforeSend('tt-main', '', Date.now(), { defer: true }); });
      svc.items = svc.items.map(i => i.id === 'job' ? { ...i, state: 'done', updated_at: at + 10000 } : i);
      await page.evaluate(() => window.__sendLease.commit());
      await page.waitForFunction(() => /finished, not seen/.test(window.WosThreadTracker.dots('tt-main')));
      const seen = svc.writes.filter(w => w.p.endsWith('/thread-items/seen'));
      check(`clock/${shell}/${skin}/${skew}: only pinned old version acknowledged; later completion stays unseen`, seen.length === 1 && JSON.stringify(seen[0].b.ids) === '["old"]' && !svc.seen.has('job') && ctx.errors.length === 0, seen);
      await ctx.unrouteAll({ behavior: 'wait' }); await ctx.close();
    }
    /* ---- visible reply dwell and measured tracker inset ---- */
    if (!process.env.QA_STATE_ONLY) for (const skin of SKINS) for (const profile of ['phone', 'phone-doc', 'desktop']) {
      const shell = profile === 'desktop' ? 'desktop' : 'phone', svc = service();
      const latest = svc.rows.at(-1), anchor = svc.items[0];
      latest.content = 'First line of the latest reply must be fully visible.\n\n' + 'Detailed explanation with enough text to exceed a phone viewport.\n\n'.repeat(60);
      svc.items = ['green-a', 'green-b'].map(id => ({ ...anchor, id, title: 'Finished work', state: 'done', message_id: String(latest.id), at: latest.timestamp * 1000, updated_at: latest.timestamp * 1000 }));
      svc.seen.clear();
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [ID], docScroll: profile === 'phone-doc' });
      if (shell === 'desktop') await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
      // Freeze only the synthetic visibility guard while inspecting the initial strip/panel;
      // screenshot latency must not consume the green dwell before the assertion starts.
      await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
      await openThread(page, 'tt-main'); await page.waitForSelector('[data-tt-strip] .tt-h');
      await page.waitForTimeout(500);
      const geometry = () => page.evaluate(mid => {
        const n = document.querySelector(`.msg[data-mid="${mid}"]`), s = document.querySelector('[data-tt-strip]'), r = n.getBoundingClientRect(), b = s.getBoundingClientRect();
        return { top: r.top, stripBottom: b.bottom, shell: document.documentElement.dataset.shell, skin: document.documentElement.dataset.skin, doc: document.documentElement.classList.contains('wos-doc-scroll'), visible: r.top >= b.bottom + 6 && r.top < innerHeight - 80 };
      }, String(latest.id));
      const g = await geometry();
      check(`autoseen/${profile}/${skin}: latest reply first line below actual strip`, g.visible && g.shell === shell && g.skin === skin && g.doc === (profile === 'phone-doc'), g);
      await page.screenshot({ path: path.join(OUT, `autoseen-open-${profile}-${skin}.png`) });
      await strip(page).locator('.tt-h').click();
      const seam = await page.evaluate(() => { const h = document.querySelector('.tt-h').getBoundingClientRect(), p = document.querySelector('.tt-panel').getBoundingClientRect(), c = getComputedStyle(document.querySelector('.tt-panel')); return { gap: p.top - h.bottom, radius: c.borderTopLeftRadius, base: c.backgroundColor, image: c.backgroundImage }; });
      check(`autoseen/${profile}/${skin}: expanded panel continuous and opaque`, seam.gap <= 0 && seam.gap >= -2 && seam.radius === '0px' && !/rgba\([^)]*, 0\)/.test(seam.base), seam);
      await page.screenshot({ path: path.join(OUT, `autoseen-panel-${profile}-${skin}.png`) });
      await strip(page).locator('.tt-h').click();
      await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => window.WosThreadTracker.dots('tt-main') === '', null, { timeout: 6000 });
      check(`autoseen/${profile}/${skin}: green group acknowledged and Chats dots cleared`, svc.view().every(i => i.seen) && svc.writes.some(w => w.b?.ids?.length === 2));
      const cleared = await page.evaluate(mid => {
        const n = document.querySelector(`.msg[data-mid="${mid}"]`), nb = n.closest('.ch-msgs');
        const base = document.documentElement.classList.contains('wos-doc-scroll') ? nb.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect().bottom : nb.getBoundingClientRect().top;
        return { top: n.getBoundingClientRect().top, base, gap: n.getBoundingClientRect().top - base, strip: !!document.querySelector('[data-tt-strip]') };
      }, String(latest.id));
      check(`autoseen/${profile}/${skin}: last green removes strip and recomputes eye-line without a header overlap or gap`, !cleared.strip && Math.abs(cleared.gap - 8) <= 2, cleared);
      await page.screenshot({ path: path.join(OUT, `hide-autoseen-${profile}-${skin}.png`) });
      // A later green update must not be consumed by opening the dropdown.
      await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
      svc.items = svc.items.map(i => ({ ...i, updated_at: i.updated_at + 1000 })); svc.seen.clear();
      await page.waitForTimeout(2600); await page.evaluate(() => window.WosThreadTracker.load('tt-main'));
      await strip(page).locator('.tt-h').click();
      await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForTimeout(1400);
      check(`autoseen/${profile}/${skin}: opening dropdown is not seeing`, svc.view().every(i => !i.seen));
      await strip(page).locator('.tt-h').click();
      // Browser visibility is controlled on this synthetic document; never change an owner document.
      await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
      await page.waitForTimeout(1400);
      check(`autoseen/${profile}/${skin}: hidden document never clears`, svc.view().every(i => !i.seen));
      await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => window.WosThreadTracker.dots('tt-main') === '', null, { timeout: 5000 });
      check(`autoseen/${profile}/${skin}: visible later update re-arms`, svc.view().every(i => i.seen));
      // Amber remains an action even when anchored to the exact same visible reply.
      svc.items = svc.items.map(i => ({ ...i, state: 'needs_you', try: true, updated_at: i.updated_at + 1000 })); svc.seen.clear();
      await page.waitForTimeout(2600); await page.evaluate(() => window.WosThreadTracker.load('tt-main')); await page.waitForTimeout(1600);
      check(`autoseen/${profile}/${skin}: amber stays for manual action`, svc.view().every(i => !i.seen) && await page.evaluate(() => /need you/.test(window.WosThreadTracker.dots('tt-main'))));
      await strip(page).locator('.tt-h').click(); await strip(page).locator('[data-tt-row] .tt-t').first().click(); await page.waitForTimeout(900);
      check(`autoseen/${profile}/${skin}: tracker jump target fully below strip`, (await geometry()).visible);
      check(`autoseen/${profile}/${skin}: no real sends or page errors`, !svc.writes.some(w => /\/v1\/runs|\/steer$/.test(w.p)) && ctx.errors.length === 0, ctx.errors);
      // The ledger can arrive before the final streamed bubble gets its stable message anchor.
      await page.evaluate(mid => {
        Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
        if(document.documentElement.dataset.shell==='phone'){Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});Object.defineProperty(navigator,'userAgent',{configurable:true,value:navigator.userAgent+' WizardNative'});}
        window.__lateReply=document.querySelector(`.msg[data-mid="${mid}"]`); window.__lateReply.remove();
      },String(latest.id));
      svc.items=[{...anchor,state:'done',message_id:String(latest.id),at:latest.timestamp*1000,updated_at:Date.now()}];svc.seen.clear();
      await page.waitForTimeout(2600);await page.evaluate(()=>window.WosThreadTracker.loadCounts(true));
      await page.waitForFunction(()=>/finished, not seen/.test(window.WosThreadTracker.dots('tt-main')));
      await page.evaluate(()=>{const nb=document.querySelector('.ch-msgs'),n=window.__lateReply;nb.append(n);const top=window.WosThreadTracker.viewportTop(nb,nb.getBoundingClientRect().top),delta=n.getBoundingClientRect().top-top-16;if(document.documentElement.classList.contains('wos-doc-scroll'))window.scrollBy(0,delta);else nb.scrollTop+=delta;Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
      await page.waitForFunction(()=>!/finished, not seen/.test(window.WosThreadTracker.dots('tt-main')));
      check(`autoseen/${profile}/${skin}: late streamed anchor re-arms without a render, including phone hasFocus false`,svc.view().every(i=>i.seen));
      // A small tail of an ordinary reply is not evidence of reading it.
      await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}));
      svc.items=[{...anchor,state:'done',message_id:String(latest.id),at:latest.timestamp*1000,updated_at:Date.now()+1}];svc.seen.clear();
      await page.waitForTimeout(2600);await page.evaluate(()=>window.WosThreadTracker.loadCounts(true));
      await page.waitForFunction(()=>/finished, not seen/.test(window.WosThreadTracker.dots('tt-main')));
      await page.waitForTimeout(700); // let the already queued ledger bubble render settle while hidden
      // Keep the geometry fixture stable through the app's queued bubble repaint.
      // Inline node styles alone disappear when the pending ledger render replaces it.
      const shortStyle=await page.addStyleTag({content:`.ch-msgs .msg[data-mid="${latest.id}"]{height:300px!important;min-height:300px!important;max-height:300px!important;box-sizing:border-box!important;overflow:hidden!important}`});
      const shortTail=await page.evaluate(mid=>{
        // The real reader restores its opening position after a bubble repaint.
        // Keep this negative oracle at exactly 50px through that restoration;
        // do not change product geometry or pause the product's dwell watcher.
        const pin=()=>{
          const nb=document.querySelector('.ch-msgs'),n=nb?.querySelector(`.msg[data-mid="${mid}"]`);if(!n)return;
          let spacer=nb.querySelector('[data-short-tail-spacer]');
          if(!spacer){spacer=document.createElement('div');spacer.dataset.shortTailSpacer='';spacer.style.height='1200px';spacer.style.flexShrink='0';nb.append(spacer);}
          const top=window.WosThreadTracker.viewportTop(nb,nb.getBoundingClientRect().top),delta=n.getBoundingClientRect().bottom-(top+50);
          if(document.documentElement.classList.contains('wos-doc-scroll'))window.scrollBy(0,delta);else nb.scrollTop+=delta;
        };
        const loop=()=>{pin();window.__shortTailFrame=requestAnimationFrame(loop);};loop();
        const nb=document.querySelector('.ch-msgs'),n=nb.querySelector(`.msg[data-mid="${mid}"]`),r=n.getBoundingClientRect(),b=nb.getBoundingClientRect(),top=window.WosThreadTracker.viewportTop(nb,b.top);
        return {height:r.height,visible:Math.min(r.bottom,b.bottom,innerHeight)-Math.max(r.top,top)};
      },String(latest.id));
      const writesBeforeShort=svc.writes.filter(w=>w.p.endsWith('/thread-items/seen')).length;
      const shortSamples=[];
      await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
      for(let sample=0;sample<7;sample++){await page.waitForTimeout(200);shortSamples.push(await page.evaluate(mid=>{const n=document.querySelector(`.msg[data-mid="${mid}"]`),nb=n.closest('.ch-msgs'),r=n.getBoundingClientRect(),b=nb.getBoundingClientRect(),top=window.WosThreadTracker.viewportTop(nb,b.top);return {height:r.height,visible:Math.min(r.bottom,b.bottom,innerHeight)-Math.max(r.top,top),top:r.top,viewport:Math.min(b.bottom,innerHeight)-top,dots:window.WosThreadTracker.dots('tt-main')};},String(latest.id)));}
      check(`autoseen/${profile}/${skin}: 300px reply with 50px tail is not read`,shortSamples.every(s=>s.height===300 && Math.abs(s.visible-50)<=2) && svc.view().every(i=>!i.seen) && svc.writes.filter(w=>w.p.endsWith('/thread-items/seen')).length===writesBeforeShort,{shortTail,shortSamples,seen:svc.view(),writesBeforeShort,writesAfter:svc.writes.filter(w=>w.p.endsWith('/thread-items/seen'))});
      fs.writeFileSync(path.join(OUT,`short-tail-${profile}-${skin}.json`),JSON.stringify({shortTail,shortSamples,seen:svc.view(),writesBeforeShort,writesAfter:svc.writes.filter(w=>w.p.endsWith('/thread-items/seen'))},null,2));
      await page.screenshot({path:path.join(OUT,`running-short-unread-${profile}-${skin}.png`)});
      // Keep just the tail of a genuinely viewport-tall reply on screen for a full second.
      await page.evaluate(()=>{cancelAnimationFrame(window.__shortTailFrame);Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});});
      await shortStyle.evaluate(n=>n.remove());
      svc.items=[{...anchor,state:'done',message_id:String(latest.id),at:latest.timestamp*1000,updated_at:Date.now()+1}];svc.seen.clear();
      await page.waitForTimeout(2600);await page.evaluate(()=>window.WosThreadTracker.loadCounts(true));
      await page.waitForFunction(()=>/finished, not seen/.test(window.WosThreadTracker.dots('tt-main')));
      // The reload that follows the count change must land first: Seen carries the loaded server version, and a version the
      // client has not loaded yet is correctly refused as stale.
      await page.waitForTimeout(1500);
      const tail=await page.evaluate(mid=>{
        const nb=document.querySelector('.ch-msgs'),n=nb.querySelector(`.msg[data-mid="${mid}"]`);
        n.style.height='4000px';n.style.minHeight='4000px';n.style.display='flex';n.style.flexDirection='column';n.style.justifyContent='flex-end';n.textContent='The end of a long reply, read before the next message.';
        const spacer=document.createElement('div');spacer.style.height='1200px';spacer.style.flexShrink='0';nb.append(spacer);
        const top=window.WosThreadTracker.viewportTop(nb,nb.getBoundingClientRect().top),delta=n.getBoundingClientRect().bottom-(top+110);
        if(document.documentElement.classList.contains('wos-doc-scroll'))window.scrollBy(0,delta);else nb.scrollTop+=delta;
        const r=n.getBoundingClientRect(),b=nb.getBoundingClientRect();return {height:r.height,visible:Math.min(r.bottom,b.bottom,innerHeight)-Math.max(r.top,top),viewport:Math.min(b.bottom,innerHeight)-top};
      },String(latest.id));
      await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
      await page.waitForFunction(()=>!/finished, not seen/.test(window.WosThreadTracker.dots('tt-main')));
      // A stale refusal merges the fresh versions and re-arms; the box reaches read within a few dwell cycles.
      for(let n=0;n<60&&!svc.view().every(i=>i.seen);n++)await page.waitForTimeout(250);
      check(`autoseen/${profile}/${skin}: reading long tail acknowledges below old 40-percent threshold`,tail.height>tail.viewport && tail.visible>=40 && tail.visible<.4*tail.viewport && svc.view().every(i=>i.seen),{tail,view:svc.view().map(i=>[i.id,i.seen,i.updated_at]),seenWrites:svc.writes.filter(w=>w.p.endsWith('/thread-items/seen')).map(w=>w.b.items)});
      await page.screenshot({path:path.join(OUT,`running-long-read-${profile}-${skin}.png`)});
      await ctx.close();
      const off = await mount(browser, svc, { shell, skin, tweaks: [], docScroll: profile === 'phone-doc' });
      if (shell === 'desktop') await off.page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps'));
      await openThread(off.page, 'tt-main'); await off.page.waitForTimeout(600);
      const original = await off.page.evaluate(mid => {
        const all = document.querySelectorAll('.ch-msgs .msg.a'), n = all[all.length - 1], nb = n.closest('.ch-msgs');
        const base = document.documentElement.classList.contains('wos-doc-scroll') ? nb.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect().bottom : nb.getBoundingClientRect().top;
        return { top: n.getBoundingClientRect().top, base, gap: n.getBoundingClientRect().top - base, strip: !!document.querySelector('[data-tt-strip]') };
      }, String(latest.id));
      check(`autoseen/${profile}/${skin}: tweak-off original opening eye-line unchanged`, !original.strip && Math.abs(original.gap - 8) <= 2, original);
      await off.ctx.close();
    }
    /* ---- 2. on: phone + desktop AI apps, two skins ---- */
    if (!process.env.QA_LATE_ONLY) for (const skin of SKINS) for (const shell of ['phone', 'desktop']) {
      const tag = `${shell}/${skin}`;
      const svc = service();
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [ID] });
      if (shell === 'desktop') await page.evaluate(() => window.WosExperience.chooseDesktopView('ai-apps')).catch(() => {});
      await page.waitForFunction(id => window.WosThreadTracker?.on() && (window.WosExperience?.state.active || []).includes(id), ID, { timeout: 25000 });
      check(`${tag}: tweak on`, (await tt(page)).on);
      if (shell === 'desktop') { await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 }).catch(() => {}); const lay = await page.evaluate(() => ({ view: window.WosExperience.desktopView, layout: document.documentElement.dataset.layout })); check(`${tag}: AI apps layout active`, lay.view === 'ai-apps' && lay.layout === 'ai-apps', lay); }
      // Chats list dots match the counts
      await page.waitForSelector('[data-tt-dots]', { timeout: 20000 }).catch(() => {});
      const dots = await page.evaluate(() => [...document.querySelectorAll('[data-tt-dots]')].map(d => ({ key: d.dataset.ttDots, text: d.textContent.replace(/\s+/g, ''), n: d.querySelectorAll('.tt-dot').length })));
      const c = svc.counts();
      check(`${tag}: Chats list dots match the counts (needs ${c.needs_you} · running ${c.running} · unseen ${c.done_unseen})`, dots.length === 1 && dots[0].key === 'hermes/tt-main' && dots[0].n === 3 && dots[0].text === [c.needs_you, c.running, c.done_unseen].map(x => (x > 1 ? x : '')).join(''), dots);
      check(`${tag}: a thread without asks shows no dots`, !(await page.evaluate(() => !!document.querySelector('[data-tt-dots*="tt-other"]'))));
      if (shell === 'phone') { // show the actual Chats list: the Ready pill on Home opens it
        await page.getByText('Ready', { exact: true }).first().click().catch(() => {});
        await page.waitForSelector('.ch-row, .ch-row2', { state: 'visible', timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(300);
        check(`${tag}: the dots are visible on the phone Chats list row`, await page.evaluate(() => { const d = document.querySelector('[data-tt-dots]'); if (!d) return false; const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom <= innerHeight; }));
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => document.getAnimations().every(a => a.effect?.getComputedTiming().iterations === Infinity || a.playState !== 'running'));
      const geometry = await page.evaluate(() => {
        const d = document.querySelector('[data-tt-dots="hermes/tt-main"]'), row = d?.closest('.tp, .aad-row');
        const t = row?.querySelector('time, .aad-time'), title = row?.querySelector('b, .aad-row-t'), badge = row?.querySelector('.ch-background');
        if (!d || !t || !title) return null;
        const dr = d.getBoundingClientRect(), tr = t.getBoundingClientRect(), rr = row.getBoundingClientRect(), br = badge?.getBoundingClientRect();
        return { shell: document.documentElement.dataset.shell, skin: document.documentElement.dataset.skin,
          gap: tr.left - dr.right, right: rr.right - tr.right, endSpace: parseFloat(getComputedStyle(row).paddingRight) + [...row.children].slice([...row.children].indexOf(t) + 1).reduce((n, el) => { const c = getComputedStyle(el); return n + el.getBoundingClientRect().width + parseFloat(c.marginLeft || 0) + parseFloat(c.marginRight || 0) + parseFloat(getComputedStyle(row).columnGap || 0); }, 0), truncated: title.scrollWidth > title.clientWidth,
          visible: dr.left >= 0 && tr.right <= innerWidth && dr.top >= 0 && dr.bottom <= innerHeight && row.contains(document.elementFromPoint(dr.left + 2, dr.top + 2)),
          badge: badge?.textContent, badgeBefore: !br || br.right <= dr.left,
          ordered: !!(d.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) };
      });
      check(`${tag}: dots immediately left of time with an 8px gap and the group right aligned`, geometry?.ordered && Math.abs(geometry.gap - 8) < 1 && Math.abs(geometry.right - geometry.endSpace) < 1, geometry);
      check(`${tag}: long title truncates while dots and timestamp remain visible`, geometry?.visible && geometry.truncated && geometry.shell === shell && geometry.skin === skin, geometry);
      if (shell === 'phone') check(`${tag}: Helper still working badge precedes dots and time`, geometry?.badge === 'Helper still working' && geometry.badgeBefore, geometry);
      await page.screenshot({ path: path.join(OUT, `dots-left-${shell}-${skin}.png`) });
      await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-list.png`) });
      if (shell === 'phone') await page.evaluate(() => (window.__wux || window.__wos)?.goHome?.()).catch(() => {});
      await openThread(page, 'tt-main');
      await page.waitForSelector('[data-tt-strip] .tt-h', { timeout: 15000 });
      const head = (await strip(page).locator('.tt-h').innerText()).replace(/\s+/g, ' ');
      check(`${tag}: collapsed strip reads "6 open" with the three tallies`, /^6 open/.test(head), head);
      check(`${tag}: strip is directly under the title, before the messages`, await page.evaluate(() => { const s = document.querySelector('[data-tt-strip]'), m = document.querySelector('.ch-msgs'); return !!s && !!m && !!(s.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING); }));
      check(`${tag}: panel hidden while collapsed`, !(await strip(page).locator('.tt-panel').isVisible()));
      await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-collapsed.png`) });
      await strip(page).locator('.tt-h').click();
      await page.waitForSelector('.tt-panel:not([hidden])');
      const groups = await strip(page).locator('.tt-gh').allInnerTexts();
      check(`${tag}: expanded rows are grouped Your move / Running / Finished not seen`, JSON.stringify(groups.map(g => g.toLowerCase())) === JSON.stringify(['your move', 'running', 'finished · not seen']), groups);
      check(`${tag}: amber actions are Open plus Dismiss; finished rows use Seen`, JSON.stringify(await strip(page).locator('.tt-btn').allInnerTexts()) === JSON.stringify(['Open', 'Dismiss', 'Open', 'Dismiss', '✓ Seen', '✓ Seen']), await strip(page).locator('.tt-btn').allInnerTexts());
      check(`${tag}: the 'N acknowledged' fold is there`, /1 acknowledged · show/.test(await strip(page).innerText()));
      check(`${tag}: panel is fully opaque`, await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.tt-panel')); return !/rgba\([^)]*,\s*0(\.\d+)?\)|transparent/.test(c.backgroundColor) && c.backgroundImage !== 'none' || !/rgba?\(0, 0, 0, 0\)/.test(c.backgroundColor); }));
      await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-expanded.png`) });
      // tap outside closes (and Escape on desktop)
      await page.locator('.ch-compose textarea').click();
      check(`${tag}: tapping outside closes the list`, !(await strip(page).locator('.tt-panel').isVisible()));
      // row whose reply is already loaded (Answer 78) -> scrolls to and highlights it
      await strip(page).locator('.tt-h').click();
      await strip(page).locator('[data-tt-row="tap-lag"]').click();
      const a78 = svc.items.find(i => i.id === 'tap-lag').message_id;
      await page.waitForFunction(m => document.querySelector(`.msg[data-mid="${m}"]`)?.classList.contains('tt-flash'), a78, { timeout: 8000 }).catch(() => {});
      check(`${tag}: tapping a row closes the list, scrolls to the reply and highlights it`, !(await strip(page).locator('.tt-panel').isVisible()) && await page.evaluate(m => document.querySelector(`.msg[data-mid="${m}"]`)?.classList.contains('tt-flash'), a78) && await page.evaluate(m => { const r = document.querySelector(`.msg[data-mid="${m}"]`).getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }, a78));
      await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-jumped.png`) });
      // new messages still land at the bottom: the chat is still linear
      check(`${tag}: chat order untouched (oldest first, latest last)`, await page.evaluate(() => { const t = [...document.querySelectorAll('.ch-msgs .msg .bub')].map(n => n.textContent); return /Question number/.test(t[0] || '') && /Answer number 80/.test(t[t.length - 1] || ''); }));
      // a row whose anchor is NOT loaded yet (Answer 3 is outside the 60-turn window)
      const a3 = svc.items.find(i => i.id === 'voice-notes').message_id;
      check(`${tag}: the oldest reply is not on screen yet`, (await page.locator(`.msg[data-mid="${a3}"]`).count()) === 0);
      await strip(page).locator('.tt-h').click();
      await strip(page).locator('[data-tt-row="voice-notes"] .tt-ti').click();
      if (process.env.QA_DEBUG) { const log = []; for (let i = 0; i < 20; i++) { log.push(await page.evaluate(m => { const n = document.querySelector(`.msg[data-mid="${m}"]`); const sc = document.scrollingElement; return [!!n, n?.classList.contains('tt-flash'), n && Math.round(n.getBoundingClientRect().top), Math.round(sc.scrollTop), document.querySelectorAll('.ch-msgs .msg').length]; }, a3)); await page.waitForTimeout(100); } console.log('DEBUG', JSON.stringify(log)); }
      await page.waitForSelector(`.msg[data-mid="${a3}"].tt-flash`, { timeout: 10000 }).catch(() => {});
      check(`${tag}: a row with no anchor loaded loads history up to it, then scrolls and highlights`, (await page.locator(`.msg[data-mid="${a3}"].tt-flash`).count()) === 1 && await page.evaluate(m => { const r = document.querySelector(`.msg[data-mid="${m}"]`).getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }, a3), await page.evaluate(m => ({ msgs: document.querySelectorAll('.ch-msgs .msg').length, has: !!document.querySelector(`.msg[data-mid="${m}"]`), first: document.querySelector('.ch-msgs .msg')?.textContent.slice(0, 30) }), a3));
      await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-jumped-old.png`) });
      // Seen: persists, across reload, and the other device
      await strip(page).locator('.tt-h').click();
      if (process.env.QA_DEBUG) console.log('DEBUG2', JSON.stringify(await page.evaluate(() => { const s = document.querySelector('[data-tt-strip]'); return [s?.className, s?.querySelector('.tt-panel')?.hidden, s?.innerText.slice(0, 400)]; })));
      await strip(page).locator('[data-tt-row="backup"] [data-tt-seen]').click();
      const seenOnPaint = await page.evaluate(() => /acknowledged/.test(document.querySelector('[data-tt-strip]').innerText));
      check(`${tag}: ✓ Seen paints on the same frame (before the box answers)`, seenOnPaint);
      await page.waitForTimeout(500);
      check(`${tag}: Seen was sent to the box`, svc.writes.some(w => w.p === '/wizard/v1/thread-items/seen' && w.b.ids.includes('backup')), svc.writes.map(w => w.p));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!(window.__wos || window.__wux)); await openThread(page, 'tt-main');
      await page.waitForSelector('[data-tt-strip] .tt-h');
      await strip(page).locator('.tt-h').click();
      const afterReload = await strip(page).innerText();
      check(`${tag}: Seen persists across reload ("Nightly backup check" folded)`, !/Nightly backup check/.test(afterReload.split('acknowledged')[0] || '') && /\d acknowledged/.test(afterReload), afterReload.slice(-120));
      await strip(page).locator('[data-tt-ack]').click();
      check(`${tag}: acknowledged rows show hollow dots when unfolded`, (await strip(page).locator('.tt-row.ack .tt-dot.ack').count()) >= 2);
      await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-acknowledged.png`) });
      // a second device sees the same truth (new context, same service)
      {
        const other = await mount(browser, svc, { shell: shell === 'phone' ? 'desktop' : 'phone', skin, tweaks: [ID] });
        await openThread(other.page, 'tt-main'); await other.page.waitForSelector('[data-tt-strip] .tt-h');
        await other.page.locator('[data-tt-strip] .tt-h').click();
        const t = await other.page.locator('[data-tt-strip]').innerText();
        check(`${tag}: the other device agrees (Seen is shared through the box)`, /2 acknowledged/.test(t) && !/Nightly backup check\n[^\n]*\n✓ Seen/.test(t), t.slice(-160));
        await other.ctx.close();
      }
      /* ---- quote reply ---- */
      if (await strip(page).locator('.tt-panel').isVisible()) await page.locator('.ch-compose textarea').click();
      const lastA = svc.rows[svc.rows.length - 1];
      const bubble = page.locator(`.msg[data-mid="${lastA.id}"]`);
      await bubble.scrollIntoViewIfNeeded();
      await bubble.locator('[data-mquote]').click();
      await page.waitForSelector('.ch-reply.ch-reply-q', { timeout: 5000 });
      const ql = await page.locator('.ch-reply.ch-reply-q').innerText();
      check(`${tag}: Reply shows the quoted snippet above the composer`, /Answer number 80/.test(ql), ql);
      await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-quote-composer.png`) });
      await page.locator('.ch-compose textarea').fill('Thanks, but please also check the weekend');
      svc.writes.length = 0;
      await page.keyboard.press(shell === 'phone' ? 'Enter' : 'Enter').catch(() => {});
      let run = null;
      for (let i = 0; i < 40 && !run; i++) { await page.waitForTimeout(100); run = svc.writes.find(w => /\/v1\/runs$/.test(w.p)); }
      if (!run) { await page.locator('[data-chsend], .ch-send').first().click().catch(() => {}); for (let i = 0; i < 40 && !run; i++) { await page.waitForTimeout(100); run = svc.writes.find(w => /\/v1\/runs$/.test(w.p)); } }
      const sent = run ? JSON.parse(run.body).input : '';
      check(`${tag}: the send carries the hidden reply marker with the message id, the excerpt, and the user's words`, /\[WIZARD_REPLY_TO_V1\]\{"message_id":"?\d+"?/.test(sent) && /Answer number 80/.test(sent) && /Thanks, but please also check the weekend/.test(sent), sent.slice(0, 300));
      await page.waitForSelector('.msg.u .ch-rq.ch-rq-q', { timeout: 8000 }).catch(() => {});
      // Existing behaviour (chats.js leaveAfterSend, "send and go"): a sent reply steps back to the list on the phone and in
      // the docked AI-apps layout. Prove that is what happened, then reopen the thread the way a person would.
      await page.waitForTimeout(400);
      const afterSend = await page.evaluate(() => ({ thread: !!document.querySelector('.ch-thread .msg'), msgs: !!document.querySelector('.ch-msgs') }));
      await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-after-send.png`) });
      if (!afterSend.thread) {
        check(`${tag}: after the send the app steps back to the list (existing send-and-go), the thread is not broken`, true, afterSend);
        await openThread(page, 'tt-main');
      }
      await page.waitForSelector('.ch-msgs', { timeout: 8000 });
      if (process.env.QA_DEBUG) console.log('DEBUG3', await page.evaluate(() => [...document.querySelectorAll('.msg.u')].slice(-2).map(n => n.outerHTML.slice(0, 700)).join('\n---\n')));
      const visible = await page.evaluate(() => document.querySelector('.ch-msgs').innerText);
      check(`${tag}: the quote header renders on the bubble and the marker is never visible raw`, (await page.locator('.msg.u .ch-rq.ch-rq-q').count()) >= 1 && !/WIZARD_REPLY_TO|"message_id"/.test(visible) && /Thanks, but please also check the weekend/.test(visible), visible.slice(-200));
      await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-quote-sent.png`) });
      // tap the header: back to the original (scroll somewhere else first)
      await page.evaluate(() => { const s = document.querySelector('.ch-msgs'); (s.scrollHeight > s.clientHeight ? s : document.scrollingElement).scrollTop = 0; });
      await page.waitForTimeout(300);
      await page.locator('.msg.u .ch-rq.ch-rq-q').last().scrollIntoViewIfNeeded();
      await page.locator('.msg.u .ch-rq.ch-rq-q').last().click();
      await page.waitForSelector(`.msg[data-mid="${lastA.id}"].tt-flash`, { timeout: 8000 }).catch(() => {});
      check(`${tag}: tapping the quote header scrolls to the original and highlights it`, (await page.locator(`.msg[data-mid="${lastA.id}"].tt-flash`).count()) === 1);
      // Reply on a user message, and removing a quote
      await page.locator('.msg.u [data-mquote]').first().scrollIntoViewIfNeeded();
      await page.locator('.msg.u [data-mquote]').first().click();
      check(`${tag}: Reply works on any message (also your own)`, (await page.locator('.ch-reply.ch-reply-q').count()) === 1);
      await page.locator('[data-chreplyx]').click();
      check(`${tag}: the quote can be removed before sending`, (await page.locator('.ch-reply.ch-reply-q').count()) === 0);
      // steer path: while the run is working, a quote reply goes out as a steer with the same marker
      WORKING = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!(window.__wos || window.__wux)); await openThread(page, 'tt-main');
      await page.waitForFunction(() => { const s = (window.__wux?.live || window.__wos?.live)?.session?.('tt-main'); return !!s && s.runId === 'run-live-1'; }, null, { timeout: 15000 }).catch(() => {});
      const lastB = svc.rows[svc.rows.length - 1];
      const bub2 = page.locator(`.msg[data-mid="${lastB.id}"]`); await bub2.scrollIntoViewIfNeeded(); await bub2.locator('[data-mquote]').click();
      await page.locator('.ch-compose textarea').fill('While you work: also include Sunday');
      svc.writes.length = 0;
      await page.keyboard.press('Enter');
      for (let i = 0; i < 10 && !svc.writes.length; i++) await page.waitForTimeout(100);
      if (!svc.writes.length) await page.locator('[data-chsend], .ch-send').first().click().catch(() => {});
      let steer = null;
      for (let i = 0; i < 60 && !steer; i++) { await page.waitForTimeout(100); steer = svc.writes.find(w => /\/runs\/run-live-1\/steer/.test(w.p)); }
      const sb = steer ? String(JSON.parse(steer.body).input) : '';
      check(`${tag}: a quote reply sent while the agent is working goes out as a steer carrying the marker`, !!steer && /\[WIZARD_REPLY_TO_V1\]\{"message_id":"\d+"/.test(sb) && /While you work: also include Sunday/.test(sb), steer ? sb.slice(0, 200) : svc.writes.map(w => w.p));
      WORKING = false;
      check(`${tag}: no page errors`, ctx.errors.length === 0, ctx.errors);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async e => { try { await global.LASTPAGE?.screenshot({ path: path.join(OUT, 'fatal.png') }); } catch (_) {} console.log('FATAL ' + (e && e.stack || e)); process.exit(2); });
