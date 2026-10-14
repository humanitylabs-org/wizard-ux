// QA: Agents MVP (Lane B). Agents is its own system app (Home + System, not Apps/Store); New agent flow
// Harness → Model provider → Permissions; editable agent page; per-agent Chats with a persistent agent header;
// model picker limited to the agent's allowed models; Back never exits (nested view → list → root, still open).
// Runs against tools/agents-fixture.mjs (exact brief contract). Phone and desktop. Screenshots to QA_OUT.
// Usage: PW=<playwright> QA_OUT=<dir> node qa-agents.cjs http://127.0.0.1:9741/wizard-os-home/
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:9741/wizard-os-home/';
const ORIGIN = new URL(BASE).origin;
const OUT = process.env.QA_OUT || 'qa-agents-out'; fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const cases = [];
const ok = (v, label, detail = '') => { cases.push({ label, pass: !!v, detail: String(detail).slice(0, 400) }); if (v) { pass++; console.log('PASS', label); } else { fail++; console.log('FAIL', label, detail); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (p, name) => { const f = path.join(OUT, name + '.png'); await p.screenshot({ path: f }); console.log('SHOT', f); return f; };
const api = (p, url, init) => p.evaluate(async ([u, i]) => { const r = await fetch(u, i || {}); return { status: r.status, body: await r.json().catch(() => null) }; }, [url, init || null]);

async function ctx(b, mobile) {
  const c = await b.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: 'dark', userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' }
    : { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await c.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); } catch (e) {} });
  // Fence: nothing leaves this origin.
  await c.route('**/*', r => { const u = r.request().url(); if (!u.startsWith(location_origin())) return r.fulfill({ status: 204, body: '' }); return r.continue(); });
  return c;
}
const location_origin = () => ORIGIN;

async function agentsFrame(p) {
  const h = await p.waitForSelector('iframe[title="Agents"]', { timeout: 15000 });
  const f = await h.contentFrame(); await f.waitForSelector('.ag-top', { timeout: 15000 });
  return f;
}

async function phone(b) {
  const c = await ctx(b, true), p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/favicon|data\.js|summaries\.js|404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE, { waitUntil: 'load' }); await wait(2500);
  // ---- Home entry, not in Apps/Store ----
  ok(await p.locator('.home-tools [data-act="agents"]').count() === 1, 'phone: Home has an Agents entry in the system area');
  const launcherHas = await p.evaluate(() => { __wos.openSheet('launcher'); const t = [...document.querySelectorAll('#launcher .lapp, .lsheet .lapp, [data-app]')].map(e => e.dataset.app || e.textContent.trim()); __wos.closeSheets(true); return t; });
  ok(!launcherHas.includes('agents'), 'phone: Agents is not in the Apps launcher', JSON.stringify(launcherHas.slice(0, 30)));
  await p.locator('.home-tools [data-act="agents"]').click();
  let f = await agentsFrame(p); await wait(800);
  ok(await f.locator('.ag-row').count() >= 1 && /Archimedes/.test(await f.locator('.ag-list').innerText()), 'phone: Agents lists the main agent');
  ok(/Main agent/.test(await f.locator('.ag-list').innerText()), 'phone: main agent marked as Main agent');
  await shot(p, 'phone-01-agents-list');
  // ---- New agent: Harness → Model provider → Permissions ----
  await f.locator('[data-new]').click(); await wait(300);
  ok(/1\. Harness/.test(await f.locator('.ag-steps').innerText()) && /Model provider/.test(await f.locator('.ag-steps').innerText()) && /Permissions/.test(await f.locator('.ag-steps').innerText()), 'phone: flow steps say Harness → Model provider → Permissions');
  ok(await f.locator('[data-next]').isDisabled(), 'phone: Next waits for a name');
  await f.locator('#agName').fill('Private'); await wait(100);
  ok(await f.locator('.ag-choice[data-pick="harness"][aria-checked="true"]').innerText().then(t => /Hermes/.test(t)), 'phone: Harness Hermes selected');
  await shot(p, 'phone-02-new-harness');
  // Back inside the flow is one step (step 2 → step 1), not out.
  await f.locator('[data-next]').click(); await wait(300);
  ok(await f.locator('.ag-steps span.on').innerText().then(t => /Model provider/.test(t)), 'phone: step 2 is Model provider');
  await p.evaluate(() => window.__wosNativeBack()); await wait(300);
  ok(await f.locator('#agName').count() === 1 && (await f.locator('#agName').inputValue()) === 'Private', 'phone: Back in step 2 returns to step 1 with the name kept');
  await f.locator('[data-next]').click(); await wait(300);
  await f.locator('.ag-choice[data-pick="provider"][data-v="tinfoil"]').click(); await wait(200);
  ok(await f.locator('.ag-chip[data-v="glm-5-3"][aria-checked="true"]').count() === 1, 'phone: Tinfoil picks its only model, GLM 5.3');
  ok(/No fallback/.test(await f.locator('.ag').innerText()), 'phone: Tinfoil says no fallback');
  await shot(p, 'phone-03-new-provider');
  await f.locator('[data-next]').click(); await wait(300);
  ok(await f.locator('.ag-choice[data-pick="preset"][data-v="private"][aria-checked="true"]').count() === 1, 'phone: confidential provider proposes the Private preset');
  ok(await f.locator('.sw[data-tool][aria-checked="true"]').count() === 0, 'phone: Private preset: all outside tools off');
  ok(await f.locator('[data-files="own"][aria-checked="true"]').count() === 1, 'phone: Private preset: files = own folder');
  await shot(p, 'phone-04-new-permissions');
  // Adjust before create: add a Wizard app.
  await f.locator('[data-add="wizard"]').click(); await f.locator('[data-addpick="mizel"]').click(); await wait(200);
  ok(/Mizel/.test(await f.locator('.ag').innerText()), 'phone: Add Wizard app in the flow (Mizel.ai)');
  await f.locator('[data-create]').click();
  await f.waitForSelector('.ag-hero', { timeout: 8000 });
  const created = (await api(p, '/wizard/v1/agents')).body.agents.find(a => a.label === 'Private');
  ok(created && created.privacy === 'private' && created.model.provider === 'tinfoil' && created.model.model === 'glm-5-3' && created.model.fallback === false && created.permissions.wizard_apps.includes('mizel'), 'phone: Create → server agent private · tinfoil · glm-5-3 · no fallback · Mizel added', JSON.stringify(created));
  await wait(1800); await p.evaluate(() => window.WosAgents.load(true)); await f.evaluate(() => window.WosAgents.load(true)); await wait(400);
  ok(/Running/.test(await f.locator('.ag-hero').innerText()), 'phone: the new agent shows as running', await f.locator('.ag-hero').innerText());
  ok(await f.locator('.ag-hero .ag-lock').count() >= 1, 'phone: private agent shows a lock');
  await shot(p, 'phone-05-agent-detail');
  // ---- Edit any time ----
  await f.locator('[data-add="agent"]').click(); await f.locator('[data-addpick="transcriber"]').click(); await wait(600);
  await f.locator('[data-add="tool"]').click(); await f.locator('[data-addpick="tool-pdf"]').click(); await wait(600);
  await f.locator('[data-files="shared-read"]').click(); await wait(600);
  await f.locator('.sw[data-tool="web"]').click(); await wait(200);
  ok(await f.locator('.ag-sheet').count() === 1 && /public service/.test(await f.locator('.ag-sheet').innerText()), 'phone: turning on an outside tool in a private agent asks first');
  await shot(p, 'phone-06-outside-tool-confirm');
  await p.evaluate(() => window.__wosNativeBack()); await wait(300);
  ok(await f.locator('.ag-sheet').count() === 0 && await f.locator('.ag-hero').count() === 1, 'phone: Back closes the sheet only (still on the agent page)');
  await f.locator('[data-remove="wizard"][data-v="mizel"]').click(); await wait(700);
  const ed = (await api(p, '/wizard/v1/agents/' + created.id)).body.agent;
  ok(ed.permissions.agent_apps.includes('transcriber') && ed.permissions.agent_apps.includes('tool-pdf') && ed.permissions.files === 'shared-read' && !ed.permissions.wizard_apps.includes('mizel') && ed.permissions.outside_tools.length === 0, 'phone: edits saved server-side (agent app, tool, files; Mizel removed; outside tools still off)', JSON.stringify(ed.permissions));
  // ---- Back: agent page → list → shell (app stays open) ----
  await p.evaluate(() => window.__wosNativeBack()); await wait(300);
  ok(await f.locator('.ag-list').count() === 1 && await f.locator('.ag-row').count() === 2, 'phone: Back from agent page → Agents list (2 agents)');
  ok(/Private/.test(await f.locator('.ag-list').innerText()) && /Running/.test(await f.locator('.ag-row[data-open="' + created.id + '"]').innerText()), 'phone: list shows Private as running');
  await shot(p, 'phone-07-list-two-agents');
  // ---- Per-agent Chats ----
  await f.locator('.ag-row[data-open="' + created.id + '"]').click(); await wait(300);
  await f.locator('[data-chats]').click(); await wait(1800);
  const agWin = await p.evaluate(id => Object.values(__wos.wins).find(w => w.app === 'chats' && w.agent === id)?.id || '', created.id);
  ok(!!agWin, 'phone: Open chats opens a Chats window pinned to the agent');
  const strip = p.locator(`[data-chats="${agWin}"] .ch-agent.list`);
  await strip.waitFor({ timeout: 8000 }).catch(() => {});
  ok(await strip.count() === 1 && /Private/.test(await strip.innerText()) && await strip.locator('.ag-lock').count() === 1, 'phone: agent Chats list has a persistent header (name + lock)');
  ok(/Tinfoil|GLM/.test(await strip.innerText()), 'phone: header names the model', await strip.innerText().catch(() => ''));
  ok(await p.locator(`[data-chats="${agWin}"] .ch-row`).count() === 0, 'phone: a new agent starts with no chats (none from the main agent)');
  await shot(p, 'phone-08-agent-chats-empty');
  // New chat in the agent → model picker shows only allowed models → send.
  await p.locator(`[data-chats="${agWin}"] [data-chfab]`).click(); await wait(600);
  ok(await p.locator(`[data-chats="${agWin}"] .ch-agent.thread`).count() === 1, 'phone: new chat shows the agent header');
  ok(/Message Private/.test(await p.locator(`[data-chats="${agWin}"] textarea`).getAttribute('placeholder')), 'phone: composer says Message Private');
  await p.locator(`[data-chats="${agWin}"] [data-chmodel]`).click(); await wait(400);
  const picks = await p.locator('.ch-psheet .mrow').allInnerTexts();
  ok(picks.length === 1 && /GLM 5\.3/.test(picks[0]), 'phone: model picker in the agent shows only GLM 5.3', JSON.stringify(picks));
  ok(await p.locator('.ch-psheet [data-mall], .ch-psheet .mmore').count() === 0, 'phone: no "more models" in the agent picker');
  await shot(p, 'phone-09-model-picker-agent');
  await p.evaluate(() => window.__wosNativeBack()); await wait(300);
  await p.locator(`[data-chats="${agWin}"] textarea`).fill('Recap my private recording please');
  await shot(p, 'phone-10-agent-new-chat');
  await p.locator(`[data-chats="${agWin}"] textarea`).press('Enter').catch(() => {});
  await p.locator(`[data-chats="${agWin}"] .ch-send, [data-chats="${agWin}"] [data-chsend]`).first().click().catch(() => {});
  await wait(4500); await p.evaluate(() => __wos.live.refresh(true)); await wait(1500);
  const log = (await api(p, '/__fixture/log')).body.log;
  const run = log.find(x => x.method === 'POST' && /\/v1\/runs/.test(x.path) && x.agent === created.id);
  ok(!!run, 'phone: the send went to the agent (runs?agent=' + created.id + ')', JSON.stringify(log.filter(x => x.method !== 'GET').slice(-6)));
  ok(!log.some(x => x.method === 'POST' && /\/v1\/runs/.test(x.path) && !x.agent), 'phone: nothing was sent to the main agent');
  const agSessions = (await api(p, '/wizard/hermes/api/sessions?agent=' + created.id)).body.data;
  const mainSessions = (await api(p, '/wizard/hermes/api/sessions')).body.data;
  ok(agSessions.length === 1 && agSessions[0].model === 'glm-5-3', 'phone: thread created in the agent, on GLM 5.3', JSON.stringify(agSessions.map(s => [s.id, s.model])));
  ok(!mainSessions.some(s => agSessions.some(x => x.id === s.id)), 'phone: the main agent’s list does not contain it');
  const shown = await p.evaluate(() => __wos.live.sessions.map(s => s.id));
  ok(!shown.some(id => agSessions.some(x => x.id === id)), 'phone: the main Chats data never holds the agent thread');
  // Open it: thread view header + reply.
  await p.evaluate(([w, sid]) => __wos.openChat(w, sid), [agWin, agSessions[0].id]); await wait(2000);
  const th = p.locator(`[data-chats="${agWin}"] .ch-thread`);
  ok(await th.locator('.ch-agent.thread').count() === 1 && /Private/.test(await th.locator('.ch-agent.thread').innerText()), 'phone: thread view keeps the agent header');
  ok(/Fixture reply/.test(await th.locator('.ch-msgs').innerText()), 'phone: reply from the agent shows in the thread');
  ok(/GLM 5\.3/.test(await th.locator('[data-chmodel]').innerText()), 'phone: thread model chip says GLM 5.3');
  await shot(p, 'phone-11-agent-thread');
  // Server refuses a public model for the private agent (409 names the check).
  const refuse = await api(p, '/wizard/hermes/v1/runs?agent=' + created.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: agSessions[0].id, input: 'x', model: 'claude-opus-5-5', provider: 'anthropic' }) });
  ok(refuse.status === 409 && refuse.body.check === 'agent.allowed_models', 'phone: fixture server refuses a public model for the private agent (409 agent.allowed_models)', JSON.stringify(refuse));
  // ---- THE Back test: nested view → list → Agents app → Home; root stays open ----
  const st = () => p.evaluate(id => ({ idx: __wos.idx, focus: __wos.desks[__wos.idx]?.focus, thread: __wos.wins[id]?.thread ?? null, open: !!__wos.wins[id], log: (window.__backLog || []).slice(-1)[0] }), agWin);
  let r = await p.evaluate(() => window.__wosNativeBack()); await wait(400); let s = await st();
  ok(s.thread === null && s.open, 'Back test phone: thread → agent Chats list', JSON.stringify([r, s]));
  r = await p.evaluate(() => window.__wosNativeBack()); await wait(500); s = await st();
  const inAgents = await p.evaluate(() => { const f = __wos.desks[__wos.idx]?.focus; return __wos.wins[f]?.appId === 'agents'; });
  ok(inAgents && s.open, 'Back test phone: agent Chats list → back to the Agents app it came from', JSON.stringify([r, s]));
  for (let i = 0; i < 4; i++) { r = await p.evaluate(() => window.__wosNativeBack()); await wait(400); }
  s = await p.evaluate(() => ({ idx: __wos.idx, home: __wos.HOME, log: (window.__backLog || []).slice(-3) }));
  ok(s.idx === s.home && s.log[s.log.length - 1] === 'native:root', 'Back test phone: Agents → Home; at the root Back stays put ("You\'re home")', JSON.stringify(s));
  ok(await p.evaluate(() => !!document.querySelector('.home') && document.visibilityState === 'visible'), 'Back test phone: the app is still open after repeated Back');
  // Browser Back (plain tab): first Back at root warns and stays.
  const urlBefore = p.url();
  await p.evaluate(() => history.back()); await wait(900);
  ok(p.url().startsWith(ORIGIN) && await p.locator('.home').count() >= 1, 'Back test phone (browser history): still in Wizard OS after Back at root', p.url() + ' was ' + urlBefore);
  await shot(p, 'phone-12-home-after-back');
  // ---- Deep link + main Chats unaffected ----
  await p.evaluate(() => __wos.openApp(__wos.chats && window.WizCore.apps('mobile').APPS.find(a => a.id === 'wizard'))); await wait(1200);
  const mainWin = await p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.id || '');
  const mainStrip = await p.locator(`[data-chats="${mainWin}"] .ch-agent`).innerText().catch(() => '');
  ok(/Archimedes/.test(mainStrip) && !/Private/.test(mainStrip), 'phone: main Chats header names the main agent once several exist', mainStrip);
  ok(!(await p.locator(`[data-chats="${mainWin}"] .ch-list`).innerText()).includes('Recap my private recording'), 'phone: main Chats list has no private thread');
  await shot(p, 'phone-13-main-chats');
  // System links to Agents (its own app, opened beside System).
  await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'system'))); await wait(1500);
  const sys = await (await p.waitForSelector('iframe[title="System"]')).contentFrame();
  await sys.locator('[data-agents]').click(); await wait(1200);
  ok(await p.evaluate(() => __wos.wins[__wos.desks[__wos.idx].focus]?.appId === 'agents'), 'phone: System → Agents opens the Agents app');
  await shot(p, 'phone-14-system-link');
  ok(errs.length === 0, 'phone: no page errors', errs.slice(0, 5).join(' | '));
  await c.close();
  return created;
}

async function desktop(b, created) {
  const c = await ctx(b, false), p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + 'desktop.html', { waitUntil: 'load' }); await wait(2500);
  const chip = p.locator('.home [data-app="agents"]:visible');
  ok(await chip.count() === 1, 'desktop: Home has an Agents chip');
  await chip.first().click();
  const f = await agentsFrame(p); await wait(800);
  ok(await f.locator('.ag-row').count() >= 2, 'desktop: Agents lists both agents');
  await shot(p, 'desktop-01-agents-list');
  await f.locator('.ag-row[data-open="' + created.id + '"]').click(); await wait(400);
  await shot(p, 'desktop-02-agent-detail');
  await f.locator('[data-chats]').click(); await wait(2000);
  const head = p.locator('.dchats .ch-agent').first();
  ok(await head.count() >= 1 && /Private/.test(await head.innerText()) && await head.locator('.ag-lock').count() === 1, 'desktop: agent Chats has the persistent header with lock');
  ok(/Private/.test(await p.locator('.win.focus, .win.focused, .win').filter({ has: p.locator('.dchats') }).first().innerText()), 'desktop: the window names the agent');
  const rows = await p.locator('.dchats .pane-list .ch-row').allInnerTexts();
  ok(rows.length >= 1 && rows.some(t => /Recap my private recording/.test(t)) && !rows.some(t => /Groceries/.test(t)), 'desktop: agent list shows only its own thread', JSON.stringify(rows));
  await p.locator('.dchats .pane-list .ch-row').first().click(); await wait(1800);
  ok(await p.locator('.dchats .ch-agent.thread').count() >= 1, 'desktop: thread pane shows the agent header');
  await shot(p, 'desktop-03-agent-thread');
  ok(errs.length === 0, 'desktop: no page errors', errs.slice(0, 5).join(' | '));
  await c.close();
}

(async () => {
  const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  let created = null;
  try { created = await phone(b); } catch (e) { ok(false, 'phone run threw', e.stack); }
  try { if (created) await desktop(b, created); } catch (e) { ok(false, 'desktop run threw', e.stack); }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify({ base: BASE, pass, fail, cases, at: new Date().toISOString(), sha: process.env.QA_SHA || '', tree: process.env.QA_TREE || '', host: require('os').hostname() }, null, 2));
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
