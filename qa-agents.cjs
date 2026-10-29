// QA: Agents MVP (Lane B). Agents is its own system app (Home + System, not Apps/Store); New agent flow
// Harness → Model provider → Permissions; editable agent page; per-agent Chats with a persistent agent header;
// model picker limited to the agent's allowed models; Back never exits (nested view → list → root, still open).
// Runs against tools/agents-fixture.mjs (exact brief contract). Phone and desktop. Screenshots to QA_OUT.
// Usage: PW=<playwright> QA_OUT=<dir> node qa-agents.cjs http://127.0.0.1:9741/wizard-os-home/
const { chromium } = require('./tools/qa-playwright.cjs');
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
  // An installed app that declares agent_binding (the fixture serves it; the shell's cached app list carries it).
  await c.addInitScript(() => { try { if (!localStorage.getItem('wux.apps.v1')) localStorage.setItem('wux.apps.v1', JSON.stringify([{ id: 'meeting-recorder', name: 'Meeting Recorder', url: '/__fixture/apps/meeting-recorder/', desc: 'Records meetings and writes recaps', icon: 'R', colors: ['#ff8a5c', '#ff5ccf'] }])); } catch (e) {} });
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
  ok(await f.locator('.ag-row').count() >= 1 && /Atlas/.test(await f.locator('.ag-list').innerText()), 'phone: Agents lists the main agent');
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
  ok(await f.locator('.ag-chip[data-v="glm-5-3"][aria-checked="true"]').count() === 1, 'phone: Tinfoil preselects its default model, GLM 5.3');
  ok(/No fallback/.test(await f.locator('.ag').innerText()), 'phone: Tinfoil says no fallback');
  await shot(p, 'phone-03-new-provider');
  await f.locator('[data-next]').click(); await wait(300);
  ok(await f.locator('.ag-choice[data-pick="preset"][data-v="private"][aria-checked="true"]').count() === 1, 'phone: confidential provider proposes the Private preset');
  ok(await f.locator('.sw[data-tool][aria-checked="true"]').count() === 0, 'phone: Private preset: all outside tools off');
  ok(await f.locator('[data-files="own"][aria-checked="true"]').count() === 1, 'phone: Private preset: files = own folder');
  await shot(p, 'phone-04-new-permissions');
  // Adjust before create: add a Wizard app.
  await f.locator('[data-add="wizard"]').click(); await f.locator('[data-addpick="meeting-recorder"]').click(); await wait(200);
  ok(/Meeting Recorder/.test(await f.locator('.ag').innerText()), 'phone: Add Wizard app in the flow (Meeting Recorder)');
  await f.locator('[data-create]').click();
  await f.waitForSelector('.ag-hero', { timeout: 8000 });
  const created = (await api(p, '/wizard/v1/agents')).body.agents.find(a => a.label === 'Private');
  ok(created && created.privacy === 'private' && created.model.provider === 'tinfoil' && created.model.model === 'glm-5-3' && created.model.fallback === false && created.permissions.wizard_apps.includes('meeting-recorder'), 'phone: Create → server agent private · tinfoil · glm-5-3 · no fallback · Meeting Recorder added', JSON.stringify(created));
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
  await f.locator('[data-remove="wizard"][data-v="meeting-recorder"]').click(); await wait(700);
  const ed = (await api(p, '/wizard/v1/agents/' + created.id)).body.agent;
  ok(ed.permissions.agent_apps.includes('transcriber') && ed.permissions.agent_apps.includes('tool-pdf') && ed.permissions.files === 'shared-read' && !ed.permissions.wizard_apps.includes('meeting-recorder') && ed.permissions.outside_tools.length === 0, 'phone: edits saved server-side (agent app, tool, files; Meeting Recorder removed; outside tools still off)', JSON.stringify(ed.permissions));
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
  const strip = p.locator(`.win[data-win="${agWin}"] [data-agent-titlebar]`);
  await strip.waitFor({ timeout: 8000 }).catch(() => {});
  ok(await strip.count() === 1 && /Private/.test(await strip.innerText()) && await strip.locator('.sg-hat-private').count() === 1, 'phone: agent Chats list has a persistent header (name + lock)');
  ok(await p.locator(`[data-chats="${agWin}"] .ch-agent`).count() === 0, 'phone: agent identity is not repeated above search');
  ok(await p.locator(`[data-chats="${agWin}"] .ch-row`).count() === 0, 'phone: a new agent starts with no chats (none from the main agent)');
  await shot(p, 'phone-08-agent-chats-empty');
  // New chat in the agent → model picker shows only allowed models → send.
  await p.locator(`[data-chats="${agWin}"] [data-chfab]`).click(); await wait(600);
  ok(await p.locator(`.win[data-win="${agWin}"] [data-agent-titlebar]`).count() === 1, 'phone: new chat shows the agent header');
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
  ok(await th.locator('.ch-agent').count() === 0 && /Private/.test(await strip.innerText()), 'phone: thread view keeps the agent header');
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
  const mainStrip = await p.locator(`.win[data-win="${mainWin}"] [data-agent-titlebar]`).innerText().catch(() => '');
  ok(/Atlas/.test(mainStrip) && !/Private/.test(mainStrip), 'phone: main Chats header names the main agent once several exist', mainStrip);
  // Unified Chats (18 Oct 2026): the owner's main Chats lists the private agent's threads too, each with the lock.
  ok(await p.locator(`[data-chats="${mainWin}"] .ch-list .ch-row.private`, { hasText: 'Recap my private recording' }).locator('.ch-plock').count() === 1, 'phone: main Chats (unified) lists the private thread with a lock');
  await shot(p, 'phone-13-main-chats');
  // System links to Agents (its own app, opened beside System).
  await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'system'))); await wait(1500);
  const sys = await (await p.waitForSelector('iframe[title="System"]')).contentFrame();
  await sys.locator('[data-agents]').click(); await wait(1200);
  ok(await p.evaluate(() => __wos.wins[__wos.desks[__wos.idx].focus]?.appId === 'agents'), 'phone: System → Agents opens the Agents app');
  await shot(p, 'phone-14-system-link');
  // ---- App → agent binding ("Sends its work to"; default = main agent; stopped bound agent shows clearly) ----
  // A failure in the binding section is reported on its own; the desktop half still runs.
  try { await bindingPhone(p, created); } catch (e) { ok(false, 'phone binding section threw', e.message); }
  ok(errs.length === 0, 'phone: no page errors', errs.slice(0, 5).join(' | '));
  await c.close();
  return created;
}

const BIND = 'meeting-recorder';
const binding = p => api(p, `/wizard/v1/apps/${BIND}/binding`).then(r => (r.body && r.body.binding) || {});
async function bindingPhone(p, created) {
  let b = await binding(p);
  ok(b.agent === 'hermes' && b.is_default === true, 'binding: a fresh install routes through the main agent (default)', JSON.stringify(b));
  const agMain = (await api(p, '/wizard/v1/agents/hermes')).body.agent;
  ok((agMain.bound_apps || []).some(x => x.id === BIND), 'binding: the main agent lists the app as bound', JSON.stringify(agMain.bound_apps));
  // The app's window bar: Sends its work to <agent>.
  await p.evaluate(id => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === id)), BIND); await wait(1500);
  const recWin = await p.evaluate(id => Object.values(__wos.wins).find(w => w.appId === id)?.id || '', BIND);
  const btn = p.locator(`.win[data-win="${recWin}"] .wbar [data-route-open="${BIND}"]`);
  await btn.waitFor({ timeout: 8000 }).catch(() => {});
  ok(!!recWin && await btn.count() === 1 && /Sends its work to Atlas/.test(await btn.getAttribute('aria-label')), 'phone: the app window bar shows Sends its work to (main agent)', await btn.getAttribute('aria-label').catch(() => ''));
  await btn.click(); await wait(500);
  const sheet = p.locator('.aroute');
  ok(await sheet.count() === 1 && /Sends its work to/i.test(await sheet.innerText()) && !/Routes through/i.test(await sheet.innerText()) && await sheet.locator('[data-route-pick="hermes"][aria-checked="true"]').count() === 1, 'phone: app settings sheet: Sends its work to, main agent checked');
  // #58: Which agents can use <App>? Standard ticked, private unticked by default.
  await sheet.locator('[data-access]').waitFor({ timeout: 5000 }).catch(() => {});
  ok(/Which agents can use Meeting Recorder\?/i.test(await sheet.innerText()) && await sheet.locator('[data-access-pick="hermes"][aria-checked="true"]').count() === 1 && await sheet.locator(`[data-access-pick="${created.id}"][aria-checked="false"]`).count() === 1, 'phone: app settings sheet: Which agents can use it? main ticked, Private unticked', await sheet.innerText().catch(() => ''));
  await sheet.locator(`[data-access-pick="${created.id}"]`).click(); await wait(1000);
  const acc = (await api(p, `/wizard/v1/apps/${BIND}/agents`)).body;
  const privAfter = (await api(p, '/wizard/v1/agents/' + created.id)).body.agent;
  ok(acc.agents.find(x => x.id === created.id)?.enabled === true && privAfter.permissions.wizard_apps.includes(BIND) && await sheet.locator(`[data-access-pick="${created.id}"][aria-checked="true"]`).count() === 1, 'phone: ticking Private writes its app list (PUT /apps/<id>/agents)', JSON.stringify(privAfter.permissions.wizard_apps));
  await shot(p, 'phone-15b-which-agents');
  ok(await sheet.locator(`[data-route-pick="${created.id}"] .ag-lock`).count() === 1 && await sheet.locator('[data-route-held]').count() === 0, 'phone: a private agent is offered with its lock; no extra warning while it runs');
  await shot(p, 'phone-15-route-sheet');
  await p.evaluate(() => window.__wosNativeBack()); await wait(400);
  ok(await sheet.count() === 0 && await p.evaluate(w => __wos.desks[__wos.idx]?.focus === w && !!__wos.wins[w], recWin), 'Back test phone: Back closes the route sheet only; the app stays open');
  await btn.click(); await wait(400);
  await p.locator(`.aroute [data-route-pick="${created.id}"]`).click(); await wait(1200);
  b = await binding(p);
  const ag = (await api(p, '/wizard/v1/agents/' + created.id)).body.agent;
  ok(b.agent === created.id && !b.is_default && (ag.bound_apps || []).some(x => x.id === BIND), 'phone: picking Private saves the binding (PUT) and the agent lists the app', JSON.stringify([b, ag.bound_apps]));
  ok(/now sends its work to Private/.test(await p.locator('.aroute').innerText()), 'phone: the sheet confirms the new route');
  await p.locator('.aroute [data-route-close]').click(); await wait(300);
  ok(/Sends its work to Private/.test(await btn.getAttribute('aria-label')), 'phone: the window bar now sends its work to Private', await btn.getAttribute('aria-label'));
  // Bound but stopped: shown clearly; the work waits (never another agent).
  await api(p, `/wizard/v1/agents/${created.id}/stop`, { method: 'POST' });
  await p.evaluate(() => window.WosAgents.load(true)); await wait(500);
  ok(await p.locator(`.win[data-win="${recWin}"] .wroute.held`).count() === 1, 'phone: a stopped bound agent marks the route button');
  await btn.click(); await wait(500);
  const held = p.locator('.aroute [data-route-held]');
  ok(await held.count() === 1 && /Private is stopped/.test(await held.innerText()) && /never goes to another agent/.test(await held.innerText()), 'phone: the sheet says the bound private agent is stopped and the work waits', await held.innerText().catch(() => ''));
  await shot(p, 'phone-16-route-held');
  await p.evaluate(() => window.__wosNativeBack()); await wait(300);
  // Agents app: App routing on the list, "Apps that send work here" on the agent page.
  await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'agents'))); await wait(1200);
  const f = await agentsFrame(p); await f.evaluate(() => window.WosAgents.load(true).then(() => window.WosAgents.loadBindings(true))); await wait(500);
  while (await f.locator('.ag-list').count() === 0 && await f.locator('[data-back]').count()) { await f.locator('[data-back]').first().click(); await wait(300); }
  ok(await f.locator(`.ag-row[data-open="${created.id}"] [data-waiting]`).count() === 1, 'phone: Agents list: the stopped Private agent shows apps waiting');
  const routeRow = f.locator(`.ag-routes [data-route-row="${BIND}"]`);
  ok(await routeRow.count() === 1 && /Sends its work to/i.test(await routeRow.innerText()) && /Private/.test(await routeRow.innerText()), 'phone: Agents list: App routing shows Meeting Recorder → Private', await routeRow.innerText().catch(() => ''));
  await f.locator(`.ag-row[data-open="${created.id}"]`).click(); await wait(400);
  const bound = f.locator('[data-bound-apps]');
  ok(await bound.count() === 1 && /Meeting Recorder/.test(await bound.innerText()) && await bound.locator(`[data-held="${BIND}"]`).count() === 1, 'phone: agent page: Apps that send work here lists the app and the held warning', await bound.innerText().catch(() => ''));
  ok(/Apps that send work here/i.test(await f.locator('.ag').innerText()), 'phone: agent page names the section “Apps that send work here”');
  // #58 in sync: the app ticked in the app's sheet is in the agent's Wizard apps; removing it here unticks it there.
  ok(await f.locator(`[data-wizard-apps] [data-app-item="${BIND}"]`).count() === 1, 'phone: agent page: Wizard apps lists the app ticked in its settings sheet');
  const prov = (await f.locator('[data-provider-line]').innerText().catch(() => '')).trim();
  ok(prov === 'Tinfoil · Confidential', 'phone: provider line says Confidential once', prov);
  await f.locator(`[data-wizard-apps] [data-remove="wizard"][data-v="${BIND}"]`).click(); await wait(1000);
  const acc2 = (await api(p, `/wizard/v1/apps/${BIND}/agents`)).body;
  ok(acc2.agents.find(x => x.id === created.id)?.enabled === false && await f.locator(`[data-wizard-apps] [data-app-item="${BIND}"]`).count() === 0, 'phone: removing the app on the agent page unticks it for the app', JSON.stringify(acc2.agents));
  await shot(p, 'phone-17-agent-bound-apps');
  // Change it from the agent page (in-app sheet), back to the main agent.
  await bound.locator(`[data-route="${BIND}"]`).click(); await wait(300);
  ok(await f.locator('.ag-sheet [data-routepick="hermes"]').count() === 1, 'phone: agent page: route sheet offers every agent');
  await f.locator('.ag-sheet [data-routepick="hermes"]').click(); await wait(1200);
  b = await binding(p);
  ok(b.agent === 'hermes', 'phone: agent page: moving the app to the main agent saves', JSON.stringify(b));
  ok(await f.locator('.ag-sheet').count() === 0 && await f.locator('.ag-hero').count() === 1 && !/Meeting Recorder/.test(await f.locator('[data-bound-apps]').innerText()), 'phone: agent page updates (no apps left on Private)');
  await api(p, `/wizard/v1/agents/${created.id}/start`, { method: 'POST' });
  await f.locator(`[data-back]`).first().click(); await wait(300);
  // System: App routing; tapping it opens the shell's app settings sheet; Back closes only that.
  await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'system'))); await wait(1500);
  const sys = await (await p.waitForSelector('iframe[title="System"]')).contentFrame();
  await sys.waitForSelector(`#s-routes [data-route="${BIND}"]`, { timeout: 8000 }).catch(() => {});
  ok(/Atlas/.test(await sys.locator(`#s-routes [data-route="${BIND}"]`).innerText().catch(() => '')), 'phone: System: App routing shows Meeting Recorder → Atlas');
  await sys.locator(`#s-routes [data-route="${BIND}"]`).click(); await wait(500);
  ok(await p.locator('.aroute').count() === 1, 'phone: System → Sends its work to opens the app settings sheet');
  await shot(p, 'phone-18-system-routes');
  await p.evaluate(() => window.__wosNativeBack()); await wait(300);
  ok(await p.locator('.aroute').count() === 0 && await p.evaluate(() => __wos.wins[__wos.desks[__wos.idx].focus]?.appId === 'system'), 'Back test phone: Back from the System route sheet stays in System');
}

async function desktop(b, created) {
  const c = await ctx(b, false), p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + 'desktop.html', { waitUntil: 'load' }); await wait(2500);
  // First run opens Chats on workspace 1; Home (with its app chips) is what an empty workspace shows.
  ok(await p.evaluate(() => __wux.ws[__wux.cur].wins.length > 0 && !document.querySelector('.wsp:not([hidden]) .home')), 'desktop: first run opens Chats on workspace 1 (no Home there)');
  // Home is its own root view (hat / clock), separate from the desktops (daily: Hat Home, dynamic desktops).
  await p.evaluate(() => __wux.goHome ? __wux.goHome() : __wux.goWs(1)); await wait(500);
  const chip = p.locator('#desktopHome:not([hidden]) [data-app="agents"], .wsp:not([hidden]) .home [data-app="agents"]');
  ok(await chip.count() === 1, 'desktop: Home has an Agents chip');
  await chip.first().click();
  const f = await agentsFrame(p); await wait(800);
  ok(await f.locator('.ag-row').count() >= 2, 'desktop: Agents lists both agents');
  await shot(p, 'desktop-01-agents-list');
  await f.locator('.ag-row[data-open="' + created.id + '"]').click(); await wait(400);
  await shot(p, 'desktop-02-agent-detail');
  await f.locator('[data-chats]').click(); await wait(2000);
  // Scope to the agent's own Chats window (the main Chats window on workspace 1 is still mounted, hidden).
  const aw = await p.evaluate(id => Object.values(__wux.wins).find(w => w.app === 'chats' && w.agent === id)?.id || '', created.id);
  ok(!!aw, 'desktop: Open chats opens a Chats window pinned to the agent', aw);
  const win = p.locator(`.win[data-win="${aw}"]`);
  const head = win.locator('[data-agent-titlebar]');
  ok(await head.count() >= 1 && /Private/.test(await head.innerText()) && await head.locator('.sg-hat-private').count() === 1, 'desktop: agent Chats has the persistent header with lock');
  ok(/Private/.test(await win.locator('.wbar').innerText()), 'desktop: the window names the agent', await win.locator('.wbar').innerText().catch(() => ''));
  const rows = await win.locator('.dchats .pane-list .ch-row').allInnerTexts();
  ok(rows.length >= 1 && rows.some(t => /Recap my private recording/.test(t)) && !rows.some(t => /Groceries/.test(t)), 'desktop: agent list shows only its own thread', JSON.stringify(rows));
  await win.locator('.dchats .pane-list .ch-row').first().click(); await wait(1800);
  ok(await win.locator('.dchats .ch-agent').count() === 0 && await head.count() === 1, 'desktop: thread pane shows the agent header');
  await shot(p, 'desktop-03-agent-thread');
  // Sends its work to on the desktop: the app's window bar and the settings sheet; Esc closes only the sheet.
  await p.evaluate(id => __wux.openApp(window.WizCore.apps('desktop').APPS.find(a => a.id === id)), BIND); await wait(1500);
  const dWin = await p.evaluate(id => Object.values(__wux.wins).find(w => w.appId === id)?.id || '', BIND);
  const dBtn = p.locator(`.win[data-win="${dWin}"] .wbar [data-route-open="${BIND}"]`);
  await dBtn.waitFor({ timeout: 8000 }).catch(() => {});
  ok(await dBtn.count() === 1 && /Sends its work to Atlas/.test(await dBtn.getAttribute('aria-label')), 'desktop: the app window bar shows Sends its work to', await dBtn.getAttribute('aria-label').catch(() => ''));
  await dBtn.click(); await wait(500);
  ok(await p.locator('.aroute [data-route-pick]').count() >= 2, 'desktop: Sends its work to lists the agents');
  await p.locator('.aroute [data-access]').waitFor({ timeout: 5000 }).catch(() => {});
  ok(await p.locator('.aroute [data-access-pick]').count() >= 2 && /Which agents can use/i.test(await p.locator('.aroute').innerText()), 'desktop: the sheet has Which agents can use it?');
  await shot(p, 'desktop-04-route-sheet');
  await p.keyboard.press('Escape'); await wait(300);
  ok(await p.locator('.aroute').count() === 0 && await p.evaluate(w => !!__wux.wins[w], dWin), 'desktop: Esc closes the sheet; the app stays open');
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
