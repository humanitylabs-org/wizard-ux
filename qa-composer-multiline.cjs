'use strict';
// QA: multiline mobile drafts keep the model control outside every editable row.
// The reported two-line case must allow selection on its final line; three-line drafts retain the earlier regression.
// Usage: QA_TREE=<baseline-or-candidate> QA_OUT=<evidence-dir> node qa-composer-multiline.cjs
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname;
const OUT = process.env.QA_OUT || path.join(process.env.TMPDIR || '/tmp', 'composer-multiline');
fs.mkdirSync(OUT, { recursive: true });
const CATALOGUE = { model: 'gpt-6.1-terra', provider: 'openai-codex', providers: [
  { slug: 'openai-codex', authenticated: true, is_current: true, models: ['gpt-6.1-terra', 'gpt-6.1-sol'] },
] };
const ROUTES = [
  { kind: 'main', id: 'hermes', label: 'Hermes', is_default: true },
  { kind: 'host-profile', id: 'qa-profile', label: 'Profile fixture', runtime: { kind: 'host-profile', profile: 'qa-profile' } },
  { kind: 'container', id: 'qa-container', label: 'Container fixture', runtime: { kind: 'container', container: 'synthetic-only' } },
  { kind: 'restricted', id: 'qa-restricted', label: 'Restricted fixture', privacy: 'private', permissions: { tools: [], network: false } },
];
const AGENTS = { agents: ROUTES.map(route => ({ harness: 'hermes', privacy: 'standard', status: 'running',
  model: { model: CATALOGUE.model, provider: CATALOGUE.provider, allowed_models: [CATALOGUE.model], fallback: false }, ...route })) };
const THREE_LINE_DRAFT = 'Add Popcorn and Costumes to\nmorning brief reminder morning\nbrief';
const TWO_LINE_DRAFT = 'Add this is a new draft to my right app';
let pass = 0, fail = 0, foreign = 0, blockedWrites = 0, agentWrites = 0;
function ok(v, name, detail) {
  v ? pass++ : fail++;
  console.log(`${v ? 'PASS' : 'FAIL'} ${name}${v || detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
}
async function run(browser, { mode, width, height, skin, route = ROUTES[0], draft = THREE_LINE_DRAFT, draftKind = 'three-line' }) {
  const native = mode === 'native';
  const label = `${draftKind}-${mode}-${width}-${skin}-${route.kind}`;
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', isMobile: true, hasTouch: true,
    deviceScaleFactor: 1, userAgent: `Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36${native ? ' WizardOS-DocScroll' : ''}` });
  await ctx.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.hostname !== 'wizard.test') { foreign++; return route.abort(); }
    if (!['GET', 'HEAD'].includes(req.method())) {
      blockedWrites++;
      if (/\/v1\/runs|\/api\/sessions(?:\/|$)/.test(url.pathname)) agentWrites++;
      return json({});
    }
    if (url.pathname === '/wizard/hermes/api/model/options') return json(CATALOGUE);
    if (url.pathname === '/wizard/v1/agents') return json(AGENTS);
    if (url.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: 1, threads: {} } });
    if (url.pathname === '/wizard/hermes/api/sessions') return json({ data: [], has_more: false });
    if (url.pathname.startsWith('/wizard/')) return json({});
    const match = url.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (!match) return route.fulfill({ status: 404, body: '' });
    const rel = match[1] || 'index.html', file = path.join(TREE, 'web', rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    const type = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' }[path.extname(file)] || 'application/javascript';
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
  });
  await ctx.addInitScript(activeSkin => {
    localStorage.setItem('wos.skin', activeSkin);
    localStorage.setItem('wos.coached', 'true');
    localStorage.setItem('wos.tour.v1', 'true');
    localStorage.setItem('wos.tour.done', '1');
  }, skin);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__wos?.chats && WosAgents.ready);
    await page.evaluate(() => __wos.openApp(WizCore.apps('mobile').APPS.find(app => app.id === 'wizard')));
    await page.waitForFunction(() => Object.values(__wos.wins).some(win => win.app === 'chats'));
    await page.evaluate(async activeRoute => {
      const win = Object.values(__wos.wins).find(item => item.app === 'chats');
      if (activeRoute.kind === 'main') __wos.chats.openNewDraft(win.id, '');
      else await __wos.openAgentChats(activeRoute.id, { thread: '__new__' });
    }, route);
    const textarea = page.locator('.ch-compose textarea').first();
    await textarea.waitFor({ state: 'visible' });
    // The phone shell slides a new window into place. Hit-test only after that real 380ms transform settles;
    // otherwise a busy CI host can sample Send while the whole composer is still partly off-screen.
    await textarea.evaluate(async node => {
      const frame = node.closest('.win');
      await Promise.allSettled((frame?.getAnimations() || []).map(animation => animation.finished));
    });
    await page.waitForFunction(() => WosModels.ready && WosAgents.ready);
    await textarea.fill(draft);
    await page.waitForTimeout(100);
    await textarea.evaluate(node => {
      node.focus();
      const start = node.value.indexOf('\n') + 1;
      node.setSelectionRange(start, node.value.length, 'forward');
    });
    const state = await textarea.evaluate((node, { activeRoute, draftKind }) => {
      const field = node.closest('.ch-field'), compose = node.closest('.ch-compose'), model = field.querySelector('.ch-mlabel'), send = compose.querySelector('.ch-send');
      const win = __wos.wins[node.closest('.win')?.dataset.win];
      const routeOk = activeRoute.kind === 'main'
        ? win?.focus?.kind !== 'agent'
        : win?.focus?.kind === 'agent' && win.focus.key === activeRoute.id;
      const input = node.getBoundingClientRect(), fieldBox = field.getBoundingClientRect(), composer = compose.getBoundingClientRect();
      const frame = node.closest('.win')?.getBoundingClientRect(), badge = model.getBoundingClientRect(), action = send.getBoundingClientRect();
      const line = parseFloat(getComputedStyle(node).lineHeight) || 20;
      const x = Math.min(input.right - 8, Math.max(badge.left + 8, badge.right - 12));
      const y = input.bottom - line * (draftKind === 'two-line' ? 0.5 : 1.5);
      const editHit = document.elementFromPoint(x, y), sendX = action.x + action.width / 2, sendY = action.y + action.height / 2;
      const sendHit = document.elementFromPoint(sendX, sendY);
      const box = rect => rect && ({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
      return { routeOk, route: { expected: activeRoute, focus: win?.focus || null }, draftKind, labRow: field.classList.contains('lab-row'),
        editHit: editHit === node, sendHit: send.contains(sendHit), viewport: innerWidth,
        frame: box(frame), composer: box(composer), field: box(fieldBox), input: box(input), badge: box(badge), action: box(action),
        probe: { x, y, tag: editHit?.tagName || '', cls: editHit?.className || '' },
        sendProbe: { x: sendX, y: sendY, tag: sendHit?.tagName || '', cls: sendHit?.className || '' }, selected: [node.selectionStart, node.selectionEnd] };
    }, { activeRoute: route, draftKind });
    ok(state.routeOk, `${label}: composer belongs to the requested agent route`, state.route);
    ok(state.labRow, `${label}: model control sits below the editable rows`, state);
    ok(state.editHit, `${label}: targeted editing line hit-tests to the textarea`, state);
    ok(state.sendHit, `${label}: Send remains hit-testable with the lower lines selected`, state);
    ok(errors.length === 0, `${label}: no page errors`, errors);
    fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(state, null, 2));
    await page.screenshot({ path: path.join(OUT, `${label}.png`) });
  } finally {
    await ctx.close();
  }
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--no-sandbox'] });
  try {
    const cases = [
      ...['phone', 'native'].flatMap(mode => [360, 412].flatMap(width => ['nebula', 'grove'].map(skin => (
        { mode, width, height: width === 360 ? 780 : 892, skin, route: ROUTES[0] }
      )))),
      { mode: 'native', width: 844, height: 390, skin: 'nebula', route: ROUTES[0] },
      ...ROUTES.slice(1).map(route => ({ mode: 'native', width: 412, height: 892, skin: 'nebula', route })),
      { mode: 'native', width: 393, height: 852, skin: 'nebula', route: ROUTES[0], draft: TWO_LINE_DRAFT, draftKind: 'two-line' },
    ];
    for (const item of cases) {
      try { await run(browser, item); }
      catch (error) { ok(false, `${item.mode}-${item.width}-${item.skin}-${item.route.kind}: completed`, String(error)); }
    }
    ok(foreign === 0, 'no foreign requests', foreign);
    ok(agentWrites === 0, 'no agent message writes', { agentWrites, blockedWrites });
  } finally {
    await browser.close();
  }
  console.log(`${pass} pass, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
})();
