// wizard-customize acceptance in the real shell, isolated: the skill's helper changes the look and layout
// through the documented routes (fixture Agent Service + temp Files root), the shell shows it on two base
// skins, a "shell update" (a different build of web/) keeps it, undo restores the previous look, and a
// broken skin.js loads switched off with its file named. No live service or owner data is touched.
// Usage: QA_WEB_DIR=<tree> node qa-customize.cjs   (QA_SHOTS=<dir> for screenshots)
const pw = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { createHash } = require('node:crypto');
const ORIGIN = 'http://localhost:9/wizard-os-home/'; // localhost = secure context (crypto.subtle), never reached: every request is fulfilled below
const WEB = path.resolve(process.env.QA_WEB_DIR || __dirname, 'web');
const SHOTS = process.env.QA_SHOTS || path.join(process.env.TMPDIR || os.tmpdir(), 'qa-customize');
fs.mkdirSync(SHOTS, { recursive: true });
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const TYPES = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
let pass = 0, fail = 0;
const ok = (v, name, detail = '') => { v ? pass++ : fail++; console.log(v ? 'PASS' : 'FAIL', name, detail); };
const sha = b => createHash('sha256').update(b).digest('hex');
const SESSIONS = Array.from({ length: 6 }, (_, i) => ({ id: `qa_${i}`, title: `QA thread ${i + 1}`, preview: 'A short preview line for density', status: 'idle', updated_at: Date.now() / 1000 - i * 60, last_active: Date.now() / 1000 - i * 60, message_count: 4 }));

// "Shell update": a second build of web/ with a different ux-version and a changed asset, as a deploy would.
function rebuilt() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'qa-customize-web-'));
  fs.cpSync(WEB, dir, { recursive: true, dereference: true, filter: s => !/node_modules/.test(s) });
  fs.writeFileSync(path.join(dir, 'ux-version.txt'), 'qa-rebuilt-' + Date.now() + '\n');
  fs.appendFileSync(path.join(dir, 'core/skins.css'), '\n/* qa: rebuilt shell */\n');
  return dir;
}

(async () => {
  const { startBox } = await import('./tests/fixtures/customize-box.mjs');
  const { run } = await import('./skills/wizard-customize/scripts/wizard-customize.mjs');
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'qa-customize-files-'));
  fs.mkdirSync(path.join(root, 'Skins/My skin'), { recursive: true });
  const OWNER = '/* owner notes */\n.qa-owner-mark { outline: 0 }\n';
  fs.writeFileSync(path.join(root, 'Skins/My skin/skin.css'), OWNER);
  const box = await startBox({ root });
  const env = { base: box.url, filesRoot: root, home: path.join(root, '.agent') };
  const cli = (...a) => run(a, env);
  let webDir = WEB, base = 'nebula';
  const browser = await pw.chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: PHONE_UA });
  const agentWrites = [];
  await ctx.route('**/*', async route => {
    const q = route.request(), u = new URL(q.url());
    if (u.host !== 'localhost:9') return route.abort();
    if (u.pathname.startsWith('/wizard/v1/my-skin') || u.pathname === '/wizard/v1/ui-preferences') {
      if (q.method() !== 'GET') { agentWrites.push(q.method() + ' ' + u.pathname); return route.fulfill({ status: 403, json: { error: 'QA: shell writes refused' } }); }
      const r = await fetch(box.url + u.pathname + u.search);
      return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
    }
    if (u.pathname === '/wizard/v1/ui-preferences/seed') return route.fulfill({ status: 404, json: { error: 'older service' } });
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { agentWrites.push(q.method() + ' ' + u.pathname); return route.fulfill({ status: 403, json: { error: 'QA refuses writes' } }); }
    if (u.pathname === '/wizard/v1/skins') return route.fulfill({ json: { skins: [{ id: 'my-skin', name: 'My skin', base, tweaks: {} }], active: 'my-skin' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return route.fulfill({ json: { data: SESSIONS, sessions: SESSIONS, total: SESSIONS.length, has_more: false } });
    if (u.pathname === '/wizard/thread-seen') return route.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
    if (u.pathname.startsWith('/wizard-os-home/')) {
      let rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
      const f = path.join(webDir, rel);
      if (!f.startsWith(webDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        if (/(^|\/)(data|summaries)\.js$/.test(rel)) return route.fulfill({ contentType: 'application/javascript', body: '// empty QA data' });
        return route.fulfill({ status: 404, body: '' });
      }
      return route.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f), headers: { 'Cache-Control': 'no-cache' } });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"isolated QA fixture"}' });
  });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
  async function load(query = '') {
    await p.goto(ORIGIN + query, { waitUntil: 'load' });
    await p.waitForFunction(() => window.WosMySkin?.state.loaded && window.WosSkinHost?.personalState.ready, null, { timeout: 20000 });
    await p.waitForTimeout(600);
  }
  const look = () => p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('span'); probe.style.color = 'var(--violet)'; document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color; probe.remove();
    return { skin: document.documentElement.dataset.skin, mySkin: document.documentElement.hasAttribute('data-my-skin'), violet: cs.getPropertyValue('--violet').trim(), accent, compactPref: localStorage.getItem('wos.chats.compact.v1') };
  });
  async function openChats() {
    await p.evaluate(() => WizCore?.deeplink?.route?.(location.pathname + '?open=chats'));
    await p.waitForTimeout(700);
    return p.evaluate(() => { const l = [...document.querySelectorAll('.ch-list')].find(e => e.getBoundingClientRect().width > 0); return l ? l.classList.contains('compact') : null; });
  }
  const ORANGE = 'rgb(255, 165, 0)';
  try {
    // 0. Before: base look, not compact.
    await load();
    const before = await look();
    ok(before.skin === 'nebula' && before.accent !== ORANGE, 'before: nebula base, accent is the skin’s own', JSON.stringify(before));
    // 1. "make my accent colour orange and the chat list compact" → one helper call, documented routes only.
    const r = await cli('change', '--label', 'orange accent, compact chat list', '--accent', 'orange', '--pref', 'compact=true');
    ok(r.ok && r.blocks.includes('accent') && r.preferences.compact === true, 'helper applies accent + compact in one change', JSON.stringify({ via: r.via, blocks: r.blocks }));
    ok(fs.readFileSync(path.join(root, 'Skins/My skin/skin.css'), 'utf8').startsWith(OWNER.trimEnd()), 'owner’s own skin.css text kept byte for byte');
    for (const b of ['nebula', 'obsidian-light']) {
      base = b; await load();
      const l = await look(), compact = await openChats();
      ok(l.skin === b && l.mySkin && l.accent === ORANGE && compact === true, `${b}: orange accent and compact list`, JSON.stringify({ ...l, compact }));
      await p.screenshot({ path: path.join(SHOTS, `after-${b}.png`) });
    }
    // 2. Shell update: a different build of web/ keeps the change (it lives in Files + preferences, not the shell).
    webDir = rebuilt(); base = 'nebula';
    await load();
    const served = await p.evaluate(async () => (await fetch('ux-version.txt', { cache: 'no-store' })).text());
    const upd = await look(), updCompact = await openChats();
    ok(served.startsWith('qa-rebuilt-') && upd.accent === ORANGE && updCompact === true, 'after shell update: change kept', JSON.stringify({ served: served.trim(), ...upd, compact: updCompact }));
    await p.screenshot({ path: path.join(SHOTS, 'after-update-nebula.png') });
    // 3. "undo that" → previous look exactly.
    const u = await cli('undo');
    await load();
    const back = await look(), backCompact = await openChats();
    ok(u.ok && back.accent === before.accent && backCompact === false && fs.readFileSync(path.join(root, 'Skins/My skin/skin.css'), 'utf8') === OWNER, 'undo restores the previous accent, list density and file', JSON.stringify({ ...back, compact: backCompact }));
    await p.screenshot({ path: path.join(SHOTS, 'after-undo-nebula.png') });
    // 4. A broken skin.js (approved earlier, now throwing) loads switched off and names its file.
    for (const [kind, code] of [['throws in setup', 'export default api => { throw new Error("qa broken skin") }'], ['syntax error', 'export default api => { this is not javascript']]) {
      fs.writeFileSync(path.join(root, 'Skins/My skin/skin.js'), code);
      await p.evaluate(h => localStorage.setItem('wos.myskin.js.ok', h), sha(Buffer.from(code)));
      await load();
      await p.waitForFunction(() => WosMySkin.state.script?.error, null, { timeout: 8000 }).catch(() => {});
      const s = await p.evaluate(() => ({ host: WosSkinHost.personalState, script: WosMySkin.state.script, ok: localStorage.getItem('wos.myskin.js.ok') }));
      ok(!s.host.active && !s.ok && s.script.error?.file === 'Skins/My skin/skin.js', `broken skin.js (${kind}): off, approval revoked, file named`, JSON.stringify(s));
      await p.evaluate(() => WizCore.deeplink.route(location.pathname + '?view=skin')); await p.waitForTimeout(500);
      const row = await p.evaluate(() => { const e = [...document.querySelectorAll('[data-myskin-error]')].find(x => x.getBoundingClientRect().height > 0); if (e) e.scrollIntoView({ block: 'center' }); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
      ok(!!row && row.includes('Skin script off') && row.includes('Skins/My skin/skin.js'), `broken skin.js (${kind}): Settings › Look names the file and stays off`, row || '');
      if (kind === 'throws in setup') await p.screenshot({ path: path.join(SHOTS, 'broken-skin-js-settings.png') });
      await load();
      const again = await p.evaluate(() => ({ active: WosSkinHost.personalState.active, ok: localStorage.getItem('wos.myskin.js.ok') }));
      ok(!again.active && !again.ok, `broken skin.js (${kind}): still off after reload`);
    }
    ok(agentWrites.length === 0, 'the shell itself wrote nothing (all changes came through the helper)', agentWrites.join(', '));
    ok(errors.filter(e => !/qa broken skin|Unexpected identifier|not javascript/.test(e)).length === 0, 'no unrelated page errors', errors.join(' | '));
  } catch (e) { ok(false, 'suite crashed', e.stack); }
  finally { await browser.close(); await box.close(); box.wipe(); if (webDir !== WEB) fs.rmSync(webDir, { recursive: true, force: true }); }
  console.log(`\n${pass} passed, ${fail} failed · screenshots ${SHOTS}`);
  process.exit(fail ? 1 : 0);
})();
