// QA: Boomerang (scheduler kind "return") and pins synced per owner, on phone 390px and desktop, in Sepia and Noir.
// Fully stubbed: the shell comes from the tree under test; one fake Wizard (schedules, ui-preferences, two threads)
// is shared by the phone and desktop contexts, so a pin made on the phone must show on the desktop.
// Usage: QA_WEB_DIR=<tree> QA_OUT=<dir> QA_PLAYWRIGHT=<playwright> node qa-boomerang-pins.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const W = process.env.QA_WEB_DIR || __dirname, OUT = process.env.QA_OUT || 'qa-live/boomerang-pins';
const ORIGIN = 'http://127.0.0.1:9371';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 500)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = Date.now() / 1000;
const T = [
  { id: 'qa_boom_a', title: 'QA · Quote for the deck', ask: 'Can you price the deck?', reply: 'The deck quote is 4,200 THB including delivery.' },
  { id: 'qa_boom_b', title: 'QA · Pin me', ask: 'Pin test', reply: 'A thread to pin.' },
];
const session = (t, i) => ({ id: t.id, source: 'wizard-mobile', title: t.title, status: 'completed', archived: false, hidden: false, message_count: 2,
  started_at: now - 7200 - i * 60, last_active: now - 600 - i * 60, wizard_last_user_at: now - 7200, wizard_last_assistant_at: now - 600 - i * 60, wizard_activity_at: now - 600 - i * 60,
  latest_message: { role: 'assistant', content: t.reply, timestamp: now - 600 - i * 60 }, last_user_message: { role: 'user', content: t.ask, timestamp: now - 7200 } });
const rows = t => [{ id: 1, session_id: t.id, role: 'user', content: t.ask, timestamp: now - 7200 }, { id: 2, session_id: t.id, role: 'assistant', content: t.reply, timestamp: now - 600 }];
const ct = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';

function fakeWizard() {
  const st = { schedules: [], prefs: { pinnedChats: [] }, posts: [], prefPuts: [], runs: 0, n: 0 };
  st.route = async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method(), p = u.pathname;
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.origin !== ORIGIN) return r.abort();
    const wm = p.match(/^\/wizard-os-home\/(.*)$/);
    if (wm && m === 'GET') { const f = wm[1] || 'index.html', fp = path.join(W, 'web', f); if (!fs.existsSync(fp) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: ct(f), body: '' }); return r.fulfill({ status: 200, contentType: ct(f), body: fs.readFileSync(fp) }); }
    const body = () => { try { return JSON.parse(q.postData() || '{}'); } catch { return {}; } };
    if (p === '/wizard/v1/schedules' && m === 'GET') return json(200, { schedules: st.schedules });
    if (p === '/wizard/v1/schedules' && m === 'POST') { const b = body(); st.posts.push(b); const j = { id: 'job' + (++st.n), enabled: true, agent: 'hermes', ...b, nextRun: b.when.once, lastRun: null }; st.schedules.push(j); return json(201, j); }
    const sm = p.match(/^\/wizard\/v1\/schedules\/([^/]+)$/);
    if (sm && m === 'PATCH') { const j = st.schedules.find(x => x.id === sm[1]); Object.assign(j, body()); return json(200, j); }
    if (sm && m === 'DELETE') { st.schedules = st.schedules.filter(x => x.id !== sm[1]); return json(200, { deleted: true }); }
    if (p === '/wizard/v1/ui-preferences') { if (m === 'PUT') { const b = body(); st.prefPuts.push(b); Object.assign(st.prefs, b); } return json(200, st.prefs); }
    if (p.endsWith('/v1/runs') && m === 'POST') { st.runs++; return json(403, { error: 'QA: Boomerang must never start a run' }); }
    if (m !== 'GET') return json(200, { ok: true });
    if (p === '/wizard/hermes/api/sessions') return json(200, { data: T.map(session), has_more: false });
    for (const [i, t] of T.entries()) {
      if (p === `/wizard/hermes/api/sessions/${t.id}/messages`) { const d = rows(t); return json(200, { object: 'list', data: d, pagination: { limit: 500, offset: 0, returned: d.length } }); }
      if (p === `/wizard/hermes/api/sessions/${t.id}`) return json(200, { session: session(t, i) });
    }
    return json(200, {});
  };
  st.fire = id => { const j = st.schedules.find(x => x.id === id); j.lastRun = { outcome: 'returned', scheduledFor: new Date(Date.parse(j.when.once)).toISOString(), finishedAt: new Date().toISOString() }; j.nextRun = null; j.enabled = false; };
  return st;
}

async function shell(b, st, desktop, skin) {
  const ctx = await b.newContext(desktop ? { viewport: { width: 1440, height: 900 } } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route('**/*', st.route);
  await ctx.addInitScript(skin => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.skin', skin); } catch (e) {} }, skin);
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(ORIGIN + '/wizard-os-home/' + (desktop ? 'desktop.html' : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(id => { const A = window.__wos || window.__wux, L = window.WizLive; return L?.ok && L.session(id) && window.WosBoomerang && window.WosChatPins; }, T[0].id, { timeout: 60000 });
  return { ctx, p, errs };
}
const openThread = (p, id, desktop) => p.evaluate(({ id, desktop }) => desktop ? window.__wux.openThread(id) : window.__wos.openWizardThread(id), { id, desktop });
const back = (p, desktop) => p.evaluate(desktop => { if (desktop) return window.__wux.escStep(); window.__wos.onBack(); return (window.__backLog || []).at(-1); }, desktop);
const threadOpen = (p, id) => p.evaluate(id => [...document.querySelectorAll('[data-chats]')].some(el => el.querySelector('.ch-thread') && el.offsetParent !== null) && Object.values((window.__wos || window.__wux).wins || {}).some(w => w.thread === id), id);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  for (const skin of ['sepia', 'novairecito']) {
    const st = fakeWizard();
    for (const desktop of [false, true]) {
      const L = `${desktop ? 'desktop' : 'phone'}/${skin}`;
      const { ctx, p, errs } = await shell(b, st, desktop, skin);
      ok(await p.evaluate(() => document.documentElement.dataset.skin) === skin, `${L}: skin applied`);
      if (!desktop) {
        // ---- Boomerang a whole thread from the thread actions, beside Defer.
        await openThread(p, T[0].id, false); await p.locator('.ch-tacts [data-chact="snooze"]:visible').waitFor();
        ok(await p.locator('.ch-tacts [data-chact="defer"]:visible').count() === 0, `${L}: Snooze replaces Defer`);
        await p.locator('.ch-tacts [data-chact="snooze"]:visible').click();
        await p.locator('.boom-sheet .boom-card').waitFor();
        const pick = await p.evaluate(() => { const c = document.querySelector('.boom-card'), r = c.getBoundingClientRect(); return { title: c.querySelector('#boom-title')?.textContent, presets: c.querySelectorAll('[data-boom-preset]').length, minutes: c.querySelector('input[type=time]')?.step, zone: c.querySelector('select[name=timezone]')?.value, w: r.width, right: r.right, vw: innerWidth }; });
        ok(pick.title === 'Snooze' && pick.presets === 3 && pick.minutes === '60' && /\//.test(pick.zone) && pick.right <= pick.vw, `${L}: compact picker: quick choices, exact minutes, visible zone, fits 390px`, pick);
        await p.screenshot({ path: path.join(OUT, `${skin}-phone-picker.png`) });
        // Back closes the picker, never the thread or the app.
        const did = await back(p, false);
        ok(did === 'boomerang' && await p.locator('.boom-sheet').count() === 0, `${L}: Back closes the picker first`, did);
        ok(await threadOpen(p, T[0].id), `${L}: thread still open after Back`);
        await p.locator('.ch-tacts [data-chact="snooze"]:visible').click();
        await p.locator('.boom-card [data-boom-exact]').click();
        await p.locator('.boom-card [data-boom-calendar-toggle]').click();
        ok(await p.locator('.boom-card [data-boom-calendar]:not([hidden])').count() === 1, `${L}: calendar expands`);
        await p.locator('.boom-card [data-boom-preset]').nth(1).click();
        await p.locator('.boom-card [type=submit]').click();
        await p.locator('.boom-banner').waitFor();
        const post = st.posts.at(-1);
        ok(post?.kind === 'return' && post.thread === T[0].id && post.target?.message === null && post.when?.once && !post.body, `${L}: saved as a scheduler return job on the thread`, post);
        ok(/Snoozed/.test(await p.locator('.boom-banner').innerText()), `${L}: banner says it is set`);
        // ---- Boomerang one message.
        await p.locator('.msg.a [data-mboom]:visible').first().click();
        await p.locator('.boom-card').waitFor();
        ok(await p.locator('#boom-title').innerText() === 'Snooze', `${L}: message picker`);
        await p.locator('.boom-card [data-boom-note-toggle]').click(); await p.locator('.boom-card textarea[name=note], .boom-card input[name=note]').fill('Check the price');
        await p.locator('.boom-card [type=submit]').click(); await sleep(400);
        const mpost = st.posts.at(-1);
        ok(mpost?.kind === 'return' && Number(mpost.target?.message) > 0 && /4,200/.test(mpost.target?.excerpt || '') && mpost.prompt === 'Check the price', `${L}: message Boomerang carries its message and note`, mpost);
        // ---- It comes back.
        st.fire(st.schedules.at(-1).id);
        await p.evaluate(() => window.WosBoomerang.refresh()); await sleep(400);
        const ban = await p.locator('.boom-banner').innerText();
        ok(/Back for you/.test(ban) && /Check the price/.test(ban), `${L}: returned banner with the note`, ban);
        await p.screenshot({ path: path.join(OUT, `${skin}-phone-banner.png`) });
        await p.locator('.boom-banner [data-boom-open]').click(); await sleep(300);
        ok(await p.locator('.msg.a.boom-flash').count() === 1, `${L}: Show message lands on the exact reply`);
        await p.locator('.boom-banner [data-boom-done]').click(); await sleep(500);
        ok(!st.schedules.some(j => j.lastRun) && await p.locator('.boom-banner.due').count() === 0, `${L}: Done clears the returned Boomerang`);
        ok(st.runs === 0, `${L}: no run was ever started`);
        // ---- Pin from the phone list: always-visible pushpin.
        await back(p, false); await sleep(400);
        const pin = p.locator(`[data-chpin="${T[1].id}"]:visible`);
        await pin.waitFor();
        ok(Number(await pin.evaluate(el => getComputedStyle(el).opacity)) > 0.5, `${L}: pushpin visible on phone`);
        await pin.click(); await sleep(600);
        ok(await p.locator(`[data-sec="pinned"] [data-chopen="${T[1].id}"]`).count() === 1, `${L}: Pinned section on top`);
        ok(JSON.stringify(st.prefs.pinnedChats) === JSON.stringify([T[1].id]), `${L}: pin stored for the owner`, st.prefs);
        await p.screenshot({ path: path.join(OUT, `${skin}-phone-pinned.png`) });
        ok(!(await p.evaluate(() => document.body.innerText)).includes('undefined'), `${L}: no undefined text`);
      } else {
        // ---- The phone's pin is here on the desktop.
        await p.locator(`[data-sec="pinned"] [data-chopen="${T[1].id}"]`).first().waitFor();
        ok(true, `${L}: pin made on the phone shows on desktop`);
        const row = p.locator(`.ch-row-wrap:has([data-chopen="${T[0].id}"])`).first();
        const hid = await row.locator('.ch-pin-toggle').evaluate(el => getComputedStyle(el).opacity);
        await row.hover(); await sleep(250);
        const shown = await row.locator('.ch-pin-toggle').evaluate(el => getComputedStyle(el).opacity);
        ok(Number(hid) < 0.6 && Number(shown) === 1, `${L}: pin shows on hover`, { hid, shown });
        // Right-click menu offers Pin and Boomerang.
        await row.locator('[data-chopen]').click({ button: 'right' }); await p.locator('.ch-sheet [data-rspin]').waitFor();
        ok(/Pin/.test(await p.locator('.ch-sheet [data-rspin]').innerText()) && await p.locator('.ch-sheet [data-rsact="snooze"]').count() === 1, `${L}: right-click: Pin and Boomerang`);
        await p.locator('.ch-sheet [data-rsact="snooze"]').click(); await p.locator('.boom-card').waitFor();
        await p.screenshot({ path: path.join(OUT, `${skin}-desktop-picker.png`) });
        ok(await back(p, true) === 'boomerang' && await p.locator('.boom-sheet').count() === 0, `${L}: Esc closes the picker first`);
        // Unpin on desktop; the shared list follows.
        await p.locator(`[data-sec="pinned"] [data-chpin="${T[1].id}"]`).first().click(); await sleep(500);
        ok(JSON.stringify(st.prefs.pinnedChats) === '[]' && await p.locator('[data-sec="pinned"]').count() === 0, `${L}: unpin syncs`);
        await p.screenshot({ path: path.join(OUT, `${skin}-desktop-list.png`) });
      }
      ok(errs.length === 0, `${L}: no page errors`, errs);
      await ctx.close();
    }
  }
  await b.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
