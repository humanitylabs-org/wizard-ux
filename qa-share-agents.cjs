// Focused QA: the share sheet's Agents row (docs/SHARE-SHEET.md, James 31 Oct 2026).
//  Agents row (configured names + sigils, hidden agents left out) → Apps (Messenger) → Other apps…; no People row.
//  Tapping an agent opens a NEW chat with that agent, the shared words staged as a quote under "From Archimedes:"
//  (or an image staged in the tray) and NOTHING sent. Messenger and Other apps… keep working; Back and a tap outside
//  close the sheet; a private agent's chat offers only that agent. Phone and desktop widths, two skins, screenshots.
// Fully fixtured: every request is answered here, every write is recorded and none leaves the page; the Android
// bridge is fake (WizardOSNative records calls).
// Usage: QA_WEB_DIR=<worktree> QA_PLAYWRIGHT=<module> QA_OUT=<dir> node qa-share-agents.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || 'http://127.0.0.1:9475/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-share-agents');
fs.mkdirSync(OUT, { recursive: true });
const now = Date.now() / 1000, SID = 'qa_share_agents', VSID = 'qa_share_vault';
const ANSWER = 'The useful answer James wants to pass on. A second sentence so the quote has some length.';
const VAULT = 'Private words that must stay with the private agent.';
const AGENTS = [
  { id: 'hermes', label: 'Archimedes', is_default: true, harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: 'spark', hue: 265 }, permissions: { files: 'shared-write' } },
  { id: 'archimedes-new', label: 'Archimedes (new)', harness: 'hermes', privacy: 'standard', status: 'running', hidden: true, appearance: { glyph: 'spark', hue: 205 }, permissions: { files: 'none' } },
  { id: 'philosopher', label: 'Philosopher', harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: 'hat', hue: 42 }, permissions: { files: 'own' } },
  { id: 'vault', label: 'Vault', harness: 'hermes', privacy: 'private', status: 'running', appearance: { glyph: 'hat', hue: 150 }, permissions: { files: 'own' } },
];
const MESSENGER = { id: 'messenger', name: 'Messenger', desc: 'Encrypted text conversations with your peers, inside Wizard.', url: '/messenger/', view: { mode: 'original', url: '/messenger/' }, status: 'running', system: false, source: 'apps.json', receives_voice_input: false, provides: ['messaging'], type: 'service', category: 'app' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let pass = 0, fail = 0, uploadN = 0;
const writes = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ok(value, name, evidence = '') {
  if (value) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, JSON.stringify(evidence).slice(0, 700)); }
}
const sess = (id, title, text, agent) => ({ id, source: 'wizard-mobile', title, status: 'completed', archived: false, hidden: false, message_count: 2, ...(agent ? { agent } : {}),
  started_at: now - 600, last_active: now - 30, wizard_last_user_at: now - 120, wizard_last_assistant_at: now - 60, wizard_activity_at: now - 30,
  latest_message: { role: 'assistant', content: text, timestamp: now - 60 }, last_user_message: { role: 'user', content: 'Question', timestamp: now - 120 } });
const rowsOf = (sid, text) => [
  { id: 1, session_id: sid, role: 'user', content: 'Question', timestamp: now - 120 },
  { id: 2, session_id: sid, role: 'assistant', content: text, timestamp: now - 60 },
];
const list = data => ({ object: 'list', data, has_more: false, pagination: { limit: 100, offset: 0, returned: data.length, has_more: false } });
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); } return fn(); };
const NATIVE = `(() => { window.__qaN = []; const c = (k, ...a) => window.__qaN.push([k, ...a]);
  window.WizardOSNative = { platform: () => 'android:0.9.9', sideButton: () => '{"mic":true,"assistant":true,"used":true,"samsung":false,"step":"done"}', unsent: () => '[]', everywhere: () => '{}', appUnsent() {}, haptic() {}, keepAwake() {},
    shareText: (t, title) => { c('shareText', t, title); return 'shared'; }, shareFile: (b, n, m) => { c('shareFile', n, m); return 'shared'; }, selection: s => c('selection', s) };
  localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); })()`;

async function fence(ctx) {
  await ctx.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method !== 'GET' && method !== 'HEAD') {
      let body = null; try { body = JSON.parse(request.postData() || '{}'); } catch (_) { body = '(binary)'; }
      writes.push({ method, path: url.pathname, body });
      if (url.pathname === '/wizard/files/upload') { uploadN++; return json({ file: { id: `qa-file-${uploadN}`, filename: request.headers()['x-wizard-filename'] || 'upload', mime: request.headers()['x-wizard-mime'] || 'image/png', bytes: 68 } }, 201); }
      return json({ ok: true, state: { initializedAt: Date.now(), threads: {} } });
    }
    if (url.pathname.startsWith('/wizard-os-home/')) {
      const rel = decodeURIComponent(url.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
      if (/^(data|summaries)\.js$/.test(rel)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const file = path.join(WEB, 'web', rel);
      if (!rel.includes('..') && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const type = rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : rel.endsWith('.svg') ? 'image/svg+xml' : rel.endsWith('.woff2') ? 'font/woff2' : /\.(json|webmanifest)$/.test(rel) ? 'application/json' : rel.endsWith('.png') ? 'image/png' : 'application/javascript';
        return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname.startsWith('/messenger/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Messenger</title><body>Messenger fixture</body>' });
    if (url.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, settings: { owner: { name: 'James', place: '' }, agent: { name: 'Archimedes' }, clock: { timezone: 'UTC', day_starts_at: '00:00' }, voice: { language: '', vocabulary: [] } },
      capabilities: { voice: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', upload: '/wizard/files/upload', uploads: '/wizard/v1/uploads' } });
    if (url.pathname === '/wizard/v1/agents') return json({ agents: AGENTS });
    if (url.pathname === '/wizard/v1/apps') return json({ schema: 1, apps: [MESSENGER], in_development: [], slots: {}, parking: [] });
    const agent = url.searchParams.get('agent') || '';
    if (url.pathname === '/wizard/hermes/api/sessions') return json(list(agent === 'vault' ? [sess(VSID, 'Vault notes', VAULT, 'vault')] : agent ? [] : [sess(SID, 'Share agents QA', ANSWER)]));
    if (url.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) return json(list(rowsOf(SID, ANSWER)));
    if (url.pathname === `/wizard/hermes/api/sessions/${VSID}/messages`) return json(list(rowsOf(VSID, VAULT)));
    if (url.pathname === `/wizard/hermes/api/sessions/${SID}`) return json({ session: sess(SID, 'Share agents QA', ANSWER) });
    if (url.pathname === `/wizard/hermes/api/sessions/${VSID}`) return json({ session: sess(VSID, 'Vault notes', VAULT, 'vault') });
    if (/\/events$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
    if (url.pathname === '/wizard/hermes/api/model/options') return json({ model: 'fixture-model', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Fixture', authenticated: true, is_current: true, models: ['fixture-model'] }] });
    if (url.pathname === '/wizard/thread-seen' || url.pathname === '/wizard/thread-dispositions') return json({ state: { initializedAt: Date.now(), threads: {} } });
    return json({});
  });
}
const sentRuns = () => writes.filter(w => /\/v1\/runs|\/chat|\/messages$/.test(w.path) || w.path.includes('/outbox'));
const sheet = p => p.evaluate(() => {
  const el = document.querySelector('.wos-share'); if (!el) return null;
  const b = el.querySelector('.shs-b'), cs = getComputedStyle(b);
  return {
    subs: [...el.querySelectorAll('.shs-sub')].map(x => x.textContent),
    agents: [...el.querySelectorAll('[data-shs-agent]')].map(x => ({ id: x.dataset.shsAgent, name: x.querySelector('.shs-nm')?.textContent, colour: x.querySelector('.shs-ic')?.style.getPropertyValue('--c') || '', icon: !!x.querySelector('.shs-ic svg, .shs-ic .sgi, .shs-ic') })),
    apps: [...el.querySelectorAll('[data-shs-app]')].map(x => x.dataset.shsApp),
    people: !!el.querySelector('[data-shs-people], .shs-person'),
    other: !!el.querySelector('[data-shs-other]'),
    preview: el.querySelector('.shs-prev')?.textContent || '',
    bg: cs.backgroundColor, w: b.getBoundingClientRect().width,
    split: [...el.querySelectorAll('[data-shs-agent] .shs-nm, [data-shs-app] .shs-nm')].filter(n => !/\s/.test(n.textContent.trim()) && n.getBoundingClientRect().height > parseFloat(getComputedStyle(n).lineHeight) * 1.5).map(n => n.textContent),
  };
});
const openTap = (p, sel) => p.locator(sel).first().evaluate(el => el.click());
const tile = async (p, sel) => { const box = await p.locator(sel).first().boundingBox(); await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); };
const alphaOf = c => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return /color\(/.test(c) ? (/(\/\s*0?\.\d+)/.test(c) ? 0.5 : 1) : 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };

async function phone(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await fence(ctx);
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await p.addInitScript(NATIVE);
  await p.goto(ORIGIN, { waitUntil: 'load' });
  await p.waitForFunction(sid => window.__wos?.live?.ok && window.__wos.live.session(sid), SID, { timeout: 30000 });
  await p.waitForFunction(() => (window.WosAgents?.list || []).length >= 3, null, { timeout: 15000 });
  const openThread = async () => {
    const wid = await p.evaluate(sid => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && !x.agent); if (__wos.chats.winAgent(w)) __wos.chats.setFocus(w, null); __wos.openChat(w.id, sid); __wos.focusWin(w.id); __wos.goDesk(__wos.desks.findIndex(d => d.wins.includes(w.id)), true); return w.id; }, SID);
    await p.waitForSelector(`[data-chats="${wid}"] .msg.a [data-mshare]`, { timeout: 10000 });
    return wid;
  };
  let wid = await openThread();

  // 1 Share under a response opens Wizard's sheet: Agents → Apps → Other apps…, no People row.
  await openTap(p, `[data-chats="${wid}"] .msg.a [data-mshare]`);
  await p.waitForSelector('.wos-share.on'); await sleep(300);
  let s = await sheet(p);
  ok(s && s.subs.join('|') === 'Agents|Apps', 'phone: sheet rows are Agents then Apps', s);
  ok(s && s.agents.map(a => a.name).join(',') === 'Archimedes,Philosopher,Vault', 'phone: Agents row shows configured names, main agent first, hidden agent left out', s?.agents);
  ok(s && s.agents.every(a => a.colour) && new Set(s.agents.map(a => a.colour)).size === 3, 'phone: each agent tile wears its own sigil colour', s?.agents);
  ok(s && s.apps.join(',') === 'messenger' && !s.people && s.other, 'phone: Apps row has Messenger, no People row, Other apps… kept', s);
  ok(s && s.split.length === 0, 'phone: one-word names (Archimedes, Philosopher) are not split mid-word', s?.split);
  ok(s && s.preview.startsWith('From Archimedes:'), 'phone: preview keeps the "From Archimedes:" attribution', s?.preview);
  ok(s && alphaOf(s.bg) === 1, 'phone: sheet panel is opaque on Nebula', s?.bg);
  await p.screenshot({ path: path.join(OUT, 'phone-nebula-sheet.png') });
  // Live skin change while the sheet is open: tokens follow without a reload.
  await p.evaluate(() => window.WosSkin.set('sepia')); await sleep(700);
  s = await sheet(p);
  ok(s && alphaOf(s.bg) === 1 && s.bg !== 'rgb(0, 0, 0)', 'phone: live skin change to Sepia repaints the open sheet, still opaque', s?.bg);
  await p.screenshot({ path: path.join(OUT, 'phone-sepia-sheet.png') });
  await p.evaluate(() => window.WosSkin.set('nebula')); await sleep(400);

  // 2 Back closes the sheet and stays in the thread.
  await p.evaluate(() => window.__wos.onBack()); await sleep(300);
  ok(!(await p.$('.wos-share.on')) && await p.$(`[data-chats="${wid}"] .msg.a`), 'phone: Back closes the sheet and stays in the chat');

  // 3 Tap outside closes it.
  await openTap(p, `[data-chats="${wid}"] .msg.a [data-mshare]`); await p.waitForSelector('.wos-share.on'); await sleep(250);
  await p.mouse.click(195, 40); await sleep(300);
  ok(!(await p.$('.wos-share.on')), 'phone: tapping outside closes the sheet');

  // 4 Philosopher: a new Philosopher chat with the quote staged, nothing sent.
  const before = writes.length;
  await openTap(p, `[data-chats="${wid}"] .msg.a [data-mshare]`); await p.waitForSelector('.wos-share.on'); await sleep(250);
  await tile(p, '[data-shs-agent="philosopher"]');
  const staged = await until(() => p.evaluate(() => {
    const w = Object.values(__wos.wins).find(x => x.app === 'chats' && __wos.chats.winAgent(x) === 'philosopher'); if (!w) return null;
    const ta = document.querySelector(`[data-chats="${w.id}"] .ch-compose textarea`); if (!ta || !ta.value) return null;
    return { wid: w.id, thread: w.thread, text: ta.value, focused: document.activeElement === ta, send: getComputedStyle(document.querySelector(`[data-chats="${w.id}"] .ch-send`)).display !== 'none' };
  }));
  ok(staged && staged.thread === '__new__', 'phone: Philosopher opens a NEW chat', staged);
  ok(staged && staged.text === `From Archimedes:\n> ${ANSWER}\n\n`, 'phone: the answer is staged as a quote under "From Archimedes:" with room for his note', staged?.text);
  ok(staged && staged.focused && staged.send, 'phone: composer is focused with Send ready for his own tap', staged);
  const said = await p.evaluate(w => document.querySelector(`[data-chats="${w}"] .ch-empty`)?.innerText || '', staged?.wid);
  ok(/New chat with Philosopher/.test(said), 'phone: the new chat says which agent it is for (the quote hides the placeholder)', said);

  await sleep(1200);
  ok(sentRuns().length === 0 && !writes.slice(before).some(w => w.path.includes('runs')), 'phone: nothing was sent to Philosopher', writes.slice(before));
  await p.screenshot({ path: path.join(OUT, 'phone-nebula-philosopher-staged.png') });

  // 5 Image: staged in the tray of a new Archimedes chat, nothing sent.
  wid = await openThread();
  await p.evaluate(b64 => { const png = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); window.__qaImg = window.WosChat.shareFile(new File([png], 'photo.png', { type: 'image/png' }), { title: 'photo.png' }); }, PNG);
  await p.waitForSelector('.wos-share.on'); await sleep(250);
  s = await sheet(p);
  ok(s && s.agents.map(a => a.id).join(',') === 'philosopher,hermes,vault' && !!(await p.$('.wos-share .shs-thumb')), 'phone: an image opens the sheet with its thumbnail; Philosopher (just used) now leads the Agents row', s);
  const imgBefore = writes.length;
  await tile(p, '[data-shs-agent="hermes"]');
  const tray = await until(() => p.evaluate(() => {
    const w = Object.values(__wos.wins).find(x => x.app === 'chats' && !__wos.chats.winAgent(x) && x.thread === '__new__'); if (!w) return null;
    const n = document.querySelectorAll(`[data-chats="${w.id}"] .ch-tray .ch-att:not(.up)`).length; return n ? { n, wid: w.id } : null;
  }));
  ok(tray && tray.n === 1, 'phone: the image is staged in a new Archimedes chat tray', tray);
  const receipt = await p.evaluate(() => window.__qaImg);
  await sleep(800);
  ok(!writes.slice(imgBefore).some(w => w.path.includes('runs')) && receipt === 'shared', 'phone: image staged (upload receipt only), nothing sent', { receipt, w: writes.slice(imgBefore).map(w => w.path) });
  await p.screenshot({ path: path.join(OUT, 'phone-nebula-image-staged.png') });
  // discard the staged image so later steps start clean
  await p.evaluate(w => document.querySelector(`[data-chats="${w}"] [data-attrm]`)?.click(), tray?.wid);

  // 6 Messenger: tapping it with no target hands the item to Messenger (its own Send to… picker asks who).
  wid = await openThread();
  await openTap(p, `[data-chats="${wid}"] .msg.a [data-mshare]`); await p.waitForSelector('.wos-share.on'); await sleep(250);
  await p.evaluate(() => { window.__qaOpened = []; const o = window.WizOpenApp; window.WizOpenApp = (...a) => { window.__qaOpened.push(a[0]); return o(...a); }; });
  await tile(p, '[data-shs-app="messenger"]'); await sleep(600);
  const ms = await p.evaluate(() => ({ opened: window.__qaOpened, open: !!document.querySelector('.wos-share.on'), pending: window.WosShareSheet._state().pending }));
  ok(ms.opened.includes('messenger') && !ms.open && ms.pending.length === 1 && ms.pending[0].appId === 'messenger' && !ms.pending[0].target, 'phone: Messenger tile opens Messenger with the item pending and no person chosen', ms);

  // 7 Other apps… still goes to the native share.
  wid = await openThread();
  await openTap(p, `[data-chats="${wid}"] .msg.a [data-mshare]`); await p.waitForSelector('.wos-share.on'); await sleep(250);
  await tile(p, '[data-shs-other]'); await sleep(500);
  const nat = await p.evaluate(() => window.__qaN.filter(c => c[0] === 'shareText'));
  ok(nat.length === 1 && nat[0][1].startsWith('From Archimedes:\n\n'), 'phone: Other apps… hands the text to Android', nat);

  // 8 Private agent's chat: only that agent is offered.
  await p.evaluate(() => window.WizOpenAgentChats('vault'));
  const vw = await p.evaluate(vsid => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && __wos.chats.winAgent(x) === 'vault'); __wos.openChat(w.id, vsid); return w.id; }, VSID);
  const vOk = await p.waitForSelector(`[data-chats="${vw}"] .msg.a [data-mshare]`, { timeout: 10000 }).then(() => true, () => false);
  if (vOk) {
    await openTap(p, `[data-chats="${vw}"] .msg.a [data-mshare]`); await p.waitForSelector('.wos-share.on'); await sleep(250);
    s = await sheet(p);
    ok(s && s.agents.map(a => a.id).join(',') === 'vault', 'phone: a private agent’s chat offers only that same agent', s?.agents);
    await p.screenshot({ path: path.join(OUT, 'phone-nebula-private-only.png') });
    await p.evaluate(() => window.__wos.onBack());
  } else ok(false, 'phone: private agent fixture thread opened');

  ok(errors.length === 0, 'phone: no page errors', errors);
  await ctx.close();
}

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await fence(ctx);
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await p.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
  await p.goto(ORIGIN + 'desktop.html', { waitUntil: 'load' });
  await p.waitForFunction(sid => window.__wux?.live?.ok && window.__wux.live.session(sid), SID, { timeout: 30000 });
  await p.waitForFunction(() => (window.WosAgents?.list || []).length >= 3, null, { timeout: 15000 });
  await p.evaluate(sid => window.__wux.openThread(sid), SID);
  await p.waitForSelector('.msg.a [data-mshare]', { timeout: 10000 });
  for (const skin of ['nebula', 'obsidian-light']) {
    await p.evaluate(k => window.WosSkin.set(k), skin); await sleep(500);
    await p.locator('.msg.a [data-mshare]').first().evaluate(el => el.click());
    await p.waitForSelector('.wos-share.on'); await sleep(300);
    const s = await sheet(p);
    ok(s && s.agents.map(a => a.name).join(',') === 'Archimedes,Philosopher,Vault' && s.w <= 560 && alphaOf(s.bg) === 1, `desktop ${skin}: centred opaque sheet with the Agents row`, s);
    await p.screenshot({ path: path.join(OUT, `desktop-${skin}-sheet.png`) });
    await p.keyboard.press('Escape'); await sleep(300);
    ok(!(await p.$('.wos-share.on')), `desktop ${skin}: Esc closes the sheet`);
  }
  await p.locator('.msg.a [data-mshare]').first().evaluate(el => el.click());
  await p.waitForSelector('.wos-share.on'); await sleep(300);
  await tile(p, '[data-shs-agent="philosopher"]');
  const staged = await until(() => p.evaluate(() => {
    const w = Object.values(__wux.wins).find(x => x.app === 'chats' && __wux.chats.winAgent(x) === 'philosopher'); if (!w) return null;
    const ta = document.querySelector(`[data-chats="${w.id}"] .ch-compose textarea`); return ta?.value ? { thread: w.thread, text: ta.value } : null;
  }));
  ok(staged && staged.thread === '__new__' && staged.text === `From Archimedes:\n> ${ANSWER}\n\n`, 'desktop: Philosopher opens a new chat with the quote staged', staged);
  await sleep(800);
  ok(!writes.some(w => w.path.includes('runs')), 'desktop: nothing was sent', writes.map(w => w.path));
  await p.screenshot({ path: path.join(OUT, 'desktop-obsidian-light-philosopher-staged.png') });
  ok(errors.length === 0, 'desktop: no page errors', errors);
  await ctx.close();
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch();
    await phone(browser);
    await desktop(browser);
  } catch (e) { console.error(e); fail++; }
  finally { if (browser) await browser.close(); }
  console.log(`${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
})();
