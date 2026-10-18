// QA: Unified Chats (wizard-os spec/AGENTS.md, James 18 Oct 2026). The owner's main Chats lists every agent's
// threads by recency, private ones with a lock; opening one reads it with ?agent=<id> (the #59 seal refuses id-only
// reads); replies go to that agent. The model picker shows a Private group; a new chat on a Private model is created
// on the private agent; inside a standard thread a Private pick starts a new private chat with quoted context and the
// standard thread is untouched; inside a private thread only private models are offered. Back never exits.
// Runs against tools/agents-fixture.mjs --seed=private. Phone and desktop. Screenshots to QA_OUT.
// Usage: PW=<playwright> QA_OUT=<dir> node qa-unified-chats.cjs http://127.0.0.1:9741/wizard-os-home/
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:9741/wizard-os-home/';
const ORIGIN = new URL(BASE).origin;
const OUT = process.env.QA_OUT || 'qa-unified-chats-out'; fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const cases = [];
const ok = (v, label, detail = '') => { cases.push({ label, pass: !!v, detail: String(detail).slice(0, 600) }); if (v) { pass++; console.log('PASS', label); } else { fail++; console.log('FAIL', label, detail); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (p, name) => { const f = path.join(OUT, name + '.png'); await p.screenshot({ path: f }); console.log('SHOT', f); return f; };
const api = (p, url, init) => p.evaluate(async ([u, i]) => { const r = await fetch(u, i || {}); return { status: r.status, body: await r.json().catch(() => null) }; }, [url, init || null]);
const fixtureLog = async p => (await api(p, '/__fixture/log')).body.log;
const MIZEL = 'wizard_app_mizel_fixture1', MIZEL_TITLE = 'Mizel recap · Fixture standup';

async function ctx(b, mobile) {
  const c = await b.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: 'dark', userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' }
    : { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await c.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); } catch (e) {} });
  await c.route('**/*', r => { const u = r.request().url(); if (!u.startsWith(ORIGIN)) return r.fulfill({ status: 204, body: '' }); return r.continue(); });
  return c;
}

async function phone(b) {
  const c = await ctx(b, true), p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE, { waitUntil: 'load' }); await wait(2500);
  await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'wizard'))); await wait(2500);
  await p.evaluate(() => __wos.live.refresh(true)); await wait(1500);
  const wid = await p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.id || '');
  ok(!!wid, 'phone: main Chats window open', wid);
  const list = p.locator(`[data-chats="${wid}"] .ch-list`);
  await list.waitFor({ timeout: 10000 }).catch(() => {});
  // ---- 1. One list ----
  const rows = await p.locator(`[data-chats="${wid}"] .ch-list .ch-row`).evaluateAll(els => els.map(e => ({ id: e.dataset.chopen, text: e.innerText, priv: e.classList.contains('private'), lock: !!e.querySelector('.ch-plock .ag-lock'), sec: e.closest('[data-sec]')?.dataset.sec || '' })));
  const mz = rows.find(r => r.id === MIZEL);
  ok(!!mz && mz.lock && mz.priv, 'phone: unified list shows the private agent’s Mizel recap with a lock', JSON.stringify(rows.map(r => [r.id, r.priv, r.sec])));
  ok(rows.some(r => r.id === 'wizard_fixture_main_1') && rows.some(r => r.id === 'wizard_fixture_main_2'), 'phone: main agent threads are in the same list');
  ok(rows.some(r => r.id === 'wizard_fixture_private_1' && r.priv), 'phone: the other private thread is listed too, with the lock');
  ok(rows.filter(r => !r.priv).every(r => !r.lock), 'phone: standard threads carry no lock');
  const order = rows.filter(r => r.sec === mz?.sec).map(r => r.id);
  ok(order[0] === MIZEL, 'phone: merged by recency (the newest, the recap, is first in its section)', JSON.stringify(order));
  ok(await p.evaluate(id => !__wos.live.sessions.some(s => s.id === id), MIZEL), 'phone: the main agent’s own list data (search, links, status) still holds no private thread');
  const groups = await p.evaluate(() => { const g = __wos.live.groups(''); return [...g.needs, ...g.ready, ...g.working].map(s => s.id); });
  ok(groups.includes(MIZEL) || !(await p.evaluate(id => __wos.live.isNew(__wos.live.session(id)), MIZEL)), 'phone: the recap counts in Ready/unread like other threads when unread', JSON.stringify(groups));
  // Private words never go out as screen context with a message to another agent.
  const screen = await p.evaluate(w => window.WizScreen.read(document.querySelector(`[data-chats="${w}"]`)), wid);
  ok(!screen.includes('Mizel recap') && !screen.includes('Fixture recap') && screen.includes('Groceries'), 'phone: screen text read for context skips private rows', screen.slice(0, 300));
  await shot(p, 'phone-01-unified-list');
  // ---- open the recap: read with ?agent=private; Back stays in Chats ----
  const before = (await fixtureLog(p)).length;
  await p.locator(`[data-chats="${wid}"] .ch-row[data-chopen="${MIZEL}"]`).click(); await wait(2200);
  const th = p.locator(`[data-chats="${wid}"] .ch-thread`);
  ok(/Fixture recap: three decisions/.test(await th.locator('.ch-msgs').innerText().catch(() => '')), 'phone: opening the recap shows the private thread');
  ok(await th.locator('.ch-privtag').count() === 1, 'phone: the thread header says Private');
  let log = (await fixtureLog(p)).slice(before);
  const reads = log.filter(x => x.method === 'GET' && x.path.includes(MIZEL));
  ok(reads.length > 0 && reads.every(x => x.agent === 'private'), 'phone: every read of the private thread names the agent (#59)', JSON.stringify(reads.map(x => [x.path, x.agent])));
  const sealed = await api(p, `/wizard/hermes/api/sessions/${MIZEL}/messages`);
  ok(sealed.status === 409 && sealed.body.error === 'private_agent_sealed', 'phone: an id-only read is still sealed (409 private_agent_sealed)', JSON.stringify(sealed));
  // The picker inside a private thread: only the private agent's models, no Private group, no More models.
  await th.locator('[data-chmodel]').click(); await wait(400);
  const picksPriv = await p.locator('.ch-psheet .mrow').allInnerTexts();
  ok(picksPriv.length === 2 && /GLM 5\.3/.test(picksPriv.join()) && /DeepSeek/.test(picksPriv.join()) && await p.locator('.ch-psheet .msheet-grp, .ch-psheet [data-mall]').count() === 0, 'phone: picker in a private thread offers only private models (GLM, DeepSeek)', JSON.stringify(picksPriv));
  await shot(p, 'phone-02-private-thread-picker');
  await p.evaluate(() => window.__wosNativeBack()); await wait(300);
  ok(await p.locator('.ch-psheet').count() === 0 && await p.evaluate(w => __wos.wins[w]?.thread, wid) === MIZEL, 'phone: Back closes the picker first, thread stays open');
  // Reply goes to the private agent.
  const b2 = (await fixtureLog(p)).length;
  await th.locator('textarea').fill('Thanks, noted');
  await th.locator('textarea').press('Enter').catch(() => {});
  await p.locator(`[data-chats="${wid}"] [data-chsend], [data-chats="${wid}"] .ch-send`).first().click().catch(() => {});
  await wait(3000);
  log = (await fixtureLog(p)).slice(b2);
  const replyRun = log.find(x => x.method === 'POST' && /\/v1\/runs/.test(x.path));
  ok(replyRun && replyRun.agent === 'private', 'phone: a reply in the private thread goes to the private agent', JSON.stringify(log.filter(x => x.method !== 'GET')));
  // THE Back test: (re)open the private thread from the unified list → Back → still in Chats.
  await p.evaluate(([w, sid]) => __wos.openChat(w, sid), [wid, MIZEL]); await wait(1200);
  const r1 = await p.evaluate(() => window.__wosNativeBack()); await wait(500);
  const st = await p.evaluate(w => ({ open: !!__wos.wins[w], thread: __wos.wins[w]?.thread ?? null, focus: __wos.desks[__wos.idx]?.focus, visible: document.visibilityState }), wid);
  ok(st.open && st.thread === null && st.focus === wid && st.visible === 'visible', 'Back test phone: private thread from the unified list → Back → still in Chats (list)', JSON.stringify([r1, st]));
  await shot(p, 'phone-03-back-in-chats');
  // ---- 2. New chat on a Private model ----
  await p.locator(`[data-chats="${wid}"] [data-chfab]`).click(); await wait(700);
  await p.locator(`[data-chats="${wid}"] [data-chmodel]`).click(); await wait(400);
  const grp = p.locator('.ch-psheet .msheet-grp.priv');
  ok(await grp.count() === 1 && await grp.locator('.msheet-gh .ag-lock').count() === 1 && /private/i.test(await grp.locator('.msheet-gh').innerText()), 'phone: main Chats picker has a Private group with a lock');
  const privRows = await grp.locator('.mrow').allInnerTexts();
  ok(privRows.length === 2 && /GLM 5\.3/.test(privRows[0]) && /DeepSeek/.test(privRows[1]), 'phone: Private group lists the private agent’s models', JSON.stringify(privRows));
  const mainRows = await p.locator('.ch-psheet .msheet-list > .mrow:not(.more)').allInnerTexts();
  ok(mainRows.some(t => /Opus/.test(t)), 'phone: the main agent’s models are still listed above', JSON.stringify(mainRows));
  await shot(p, 'phone-04-picker-private-group');
  await grp.locator('.mrow', { hasText: 'DeepSeek' }).click(); await wait(500);
  const chip = await p.locator(`[data-chats="${wid}"] [data-chmodel]`).evaluate(e => ({ t: e.innerText, priv: e.classList.contains('private'), lock: !!e.querySelector('.ag-lock') }));
  ok(/DeepSeek/.test(chip.t) && chip.priv && chip.lock, 'phone: new chat chip shows DeepSeek with the lock', JSON.stringify(chip));
  ok(/New private chat/.test(await p.locator(`[data-chats="${wid}"] .ch-empty`).innerText().catch(() => '')), 'phone: the empty new chat says New private chat');
  const b3 = (await fixtureLog(p)).length;
  await p.locator(`[data-chats="${wid}"] textarea`).fill('Private question for DeepSeek');
  await p.locator(`[data-chats="${wid}"] textarea`).press('Enter').catch(() => {});
  await p.locator(`[data-chats="${wid}"] [data-chsend], [data-chats="${wid}"] .ch-send`).first().click().catch(() => {});
  await wait(4000); await p.evaluate(() => __wos.live.refresh(true)); await wait(1500);
  log = (await fixtureLog(p)).slice(b3);
  const created = log.find(x => x.method === 'POST' && x.path.startsWith('/wizard/hermes/api/sessions'));
  const run = log.find(x => x.method === 'POST' && /\/v1\/runs/.test(x.path));
  ok(created?.agent === 'private' && run?.agent === 'private', 'phone: new Private chat created on and run by the private agent', JSON.stringify(log.filter(x => x.method !== 'GET')));
  ok(!log.some(x => x.method === 'POST' && !x.agent && !x.routed), 'phone: nothing reached the main agent');
  const privList = (await api(p, '/wizard/hermes/api/sessions?agent=private')).body.data;
  const mainList = (await api(p, '/wizard/hermes/api/sessions')).body.data;
  const ds = privList.find(s => /Private question for DeepSeek/.test(s.title));
  ok(ds && ds.model === 'deepseek-v4-1-flash', 'phone: the thread lives in the private agent, on DeepSeek', JSON.stringify(privList.map(s => [s.id, s.model, s.title])));
  ok(!mainList.some(s => s.id === ds?.id), 'phone: absent from the main agent’s list');
  ok(await p.locator(`[data-chats="${wid}"] .ch-row[data-chopen="${ds?.id}"].private`).count() === 1, 'phone: it shows in the unified list with the lock');
  await shot(p, 'phone-05-deepseek-in-list');
  // ---- standard thread → Private pick: new private chat with quoted context; standard untouched ----
  const stdBefore = (await api(p, '/wizard/hermes/api/sessions/wizard_fixture_main_2/messages')).body.data.length;
  await p.evaluate(([w, sid]) => __wos.openChat(w, sid), [wid, 'wizard_fixture_main_2']); await wait(1800);
  await p.locator(`[data-chats="${wid}"] [data-chmodel]`).click(); await wait(400);
  ok(/new private chat with this conversation quoted/i.test(await p.locator('.ch-psheet .msheet-grp.priv').innerText().catch(() => '')), 'phone: in a standard thread the Private group explains it starts a new private chat');
  await p.locator('.ch-psheet .msheet-grp.priv .mrow', { hasText: 'GLM' }).click(); await wait(900);
  const now = await p.evaluate(w => __wos.wins[w]?.thread, wid);
  ok(now === '__new__', 'phone: a Private pick in a standard thread opens a new chat', now);
  const carry = await p.locator(`[data-chats="${wid}"] .ch-carry`).innerText().catch(() => '');
  ok(/Continues “Groceries for the week” privately/.test(carry), 'phone: the new private chat says it continues that thread', carry);
  await shot(p, 'phone-06-carry');
  const b4 = (await fixtureLog(p)).length;
  await p.locator(`[data-chats="${wid}"] textarea`).fill('Keep going on this privately');
  await p.locator(`[data-chats="${wid}"] textarea`).press('Enter').catch(() => {});
  await p.locator(`[data-chats="${wid}"] [data-chsend], [data-chats="${wid}"] .ch-send`).first().click().catch(() => {});
  await wait(4000); await p.evaluate(() => __wos.live.refresh(true)); await wait(1200);
  log = (await fixtureLog(p)).slice(b4);
  const cRun = log.find(x => x.method === 'POST' && /\/v1\/runs/.test(x.path));
  ok(cRun?.agent === 'private', 'phone: the continuation runs on the private agent', JSON.stringify(log.filter(x => x.method !== 'GET')));
  const cont = (await api(p, '/wizard/hermes/api/sessions?agent=private')).body.data.find(s => /Keep going on this privately/.test(s.title));
  const contMsgs = cont ? (await api(p, `/wizard/hermes/api/sessions/${cont.id}/messages?agent=private`)).body.data : [];
  const first = String(contMsgs.find(m => m.role === 'user')?.content || '');
  ok(/^Keep going on this privately/.test(first) && first.includes('[Context from my standard thread “Groceries for the week”') && first.includes('> Eggs, rice, greens and coffee.') && first.includes('> **You:**'), 'phone: first message carries the standard thread’s turns as labelled quoted context', first.slice(0, 400));
  const stdAfter = (await api(p, '/wizard/hermes/api/sessions/wizard_fixture_main_2/messages')).body.data.length;
  ok(stdAfter === stdBefore, 'phone: the standard thread is untouched', `${stdBefore} → ${stdAfter}`);
  // Kept view: the per-agent Private workspace still lists only the private agent's threads.
  await p.evaluate(() => window.WizOpenAgentChats('private')); await wait(1800);
  const aw = await p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats' && w.agent === 'private')?.id || '');
  const awRows = await p.locator(`[data-chats="${aw}"] .ch-list .ch-row`).evaluateAll(els => els.map(e => e.dataset.chopen));
  ok(aw && awRows.includes(MIZEL) && !awRows.some(id => id.startsWith('wizard_fixture_main')), 'phone: the Private workspace still shows only private threads', JSON.stringify(awRows));
  ok(/Private/.test(await p.locator(`.win[data-win="${aw}"] [data-agent-titlebar]`).innerText().catch(() => '')), 'phone: the Private workspace keeps its lock header');
  await shot(p, 'phone-07-private-workspace');
  ok(errs.length === 0, 'phone: no page errors', errs.slice(0, 5).join(' | '));
  await c.close();
}

async function desktop(b) {
  const c = await ctx(b, false), p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + 'desktop.html', { waitUntil: 'load' }); await wait(2500);
  await p.evaluate(() => __wux.live?.refresh?.(true)); await wait(1500);
  const wid = await p.evaluate(() => Object.values(__wux.wins).find(w => w.app === 'chats' && !w.agent)?.id || '');
  ok(!!wid, 'desktop: main Chats window open', wid);
  const win = p.locator(`.win[data-win="${wid}"]`);
  await win.locator('.ch-row').first().waitFor({ timeout: 10000 }).catch(() => {});
  const rows = await win.locator('.ch-row').evaluateAll(els => els.map(e => ({ id: e.dataset.chopen, priv: e.classList.contains('private'), lock: !!e.querySelector('.ch-plock') })));
  ok(rows.some(r => r.id === MIZEL && r.priv && r.lock) && rows.some(r => r.id === 'wizard_fixture_main_1' && !r.lock), 'desktop: one list, private recap with a lock beside standard threads', JSON.stringify(rows));
  await shot(p, 'desktop-01-unified-list');
  const before = (await fixtureLog(p)).length;
  await win.locator(`.ch-row[data-chopen="${MIZEL}"]`).first().click(); await wait(2200);
  ok(/Fixture recap: three decisions/.test(await win.innerText()), 'desktop: opening the recap shows the private thread');
  const reads = (await fixtureLog(p)).slice(before).filter(x => x.method === 'GET' && x.path.includes(MIZEL));
  ok(reads.length > 0 && reads.every(x => x.agent === 'private'), 'desktop: reads name the private agent', JSON.stringify(reads.map(x => x.agent)));
  await shot(p, 'desktop-02-private-thread');
  await p.evaluate(() => __wux.newChat()); await wait(900);
  const nw = await p.evaluate(() => Object.values(__wux.wins).find(w => w.app === 'chats' && !w.agent && w.thread === '__new__')?.id || '');
  const nwin = p.locator(`.win[data-win="${nw}"]`);
  await nwin.locator('[data-chmodel]').first().click(); await wait(500);
  const grp = p.locator('.ch-psheet .msheet-grp.priv');
  ok(await grp.count() === 1 && (await grp.locator('.mrow').count()) === 2, 'desktop: new chat picker has the Private group (GLM, DeepSeek)');
  await shot(p, 'desktop-03-picker');
  await grp.locator('.mrow', { hasText: 'DeepSeek' }).click(); await wait(400);
  const b2 = (await fixtureLog(p)).length;
  await nwin.locator('textarea').first().fill('Desktop private DeepSeek chat');
  await nwin.locator('textarea').first().press('Enter'); await wait(4000);
  const log = (await fixtureLog(p)).slice(b2).filter(x => x.method === 'POST');
  ok(log.some(x => /\/v1\/runs/.test(x.path) && x.agent === 'private') && !log.some(x => !x.agent && !x.routed), 'desktop: new DeepSeek chat goes to the private agent only', JSON.stringify(log));
  ok(errs.length === 0, 'desktop: no page errors', errs.slice(0, 5).join(' | '));
  await c.close();
}

(async () => {
  const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  try { await phone(b); } catch (e) { ok(false, 'phone run threw', e.stack); }
  try { await desktop(b); } catch (e) { ok(false, 'desktop run threw', e.stack); }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify({ base: BASE, pass, fail, cases, at: new Date().toISOString(), sha: process.env.QA_SHA || '', host: require('os').hostname() }, null, 2));
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
