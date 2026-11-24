// Browser QA for wizard-ux#1730: Welcome › Say hello has a mic, so a new owner can speak the first message.
// Real Chromium with a fake microphone, the real phone shell (web/index.html, 412 px) and the real desktop shell
// (web/desktop.html), on a fake brand-new Wizard (an AI signed in, Agent Service first_run) whose transcriber answers
// "What can you do for me?". For each shell:
//   1. Say hello shows a mic button labelled "Speak your first message"
//   2. tap it: it shows it is listening; tap again: the words land in the box (the owner sees them before they go)
//   3. Send: the box receives exactly those words and the first thread opens with them and the agent's reply
//   4. mic permission denied: a plain message shows in the card, and typing plus Send still works
// and the mic follows the skin (--wz-* tokens): it is drawn in Nebula and Light and repaints on a live skin change.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-welcome-hello-voice.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: there is no mic there, and the dock orb is covered.
//   QA_SHOTS=<dir>: Say hello idle and listening, in Nebula and Light, phone and desktop.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const BROKEN = process.env.QA_EXPECT === 'broken';
const SPOKEN = 'What can you do for me?';
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const sessions = {}, delivered = [];
let transcribed = 0;
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    if (p === '/') { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end(); }
    // The shell's own transcriber (WizConfig.endpoint('transcribe') before bootstrap: api/transcribe beside the page).
    if (/\/api\/transcribe$/.test(p) && req.method === 'POST') { transcribed++; return json(res, 200, { text: SPOKEN, ms: 120, model: 'qa' }); }
    if (p.startsWith('/wizard-os-home/')) {
      let f = path.join(WEB, decodeURIComponent(p.slice('/wizard-os-home/'.length)) || 'index.html');
      if (f.endsWith('/')) f += 'index.html';
      if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    if (p === '/wizard/hermes/api/model/options') return json(res, 200, { provider: 'anthropic', model: 'claude-sonnet-4-5', providers: [{ slug: 'anthropic', name: 'Anthropic', authenticated: true, auth_type: 'api_key', models: ['claude-sonnet-4-5'] }] });
    if (p === '/wizard/v1/setup') return json(res, 200, { first_run: true, items: [] });
    if (p === '/wizard/v1/setup/seen') return json(res, 200, { ok: true });
    if (p === '/troubleshoot/api/ping') return json(res, 200, { ok: true });
    if (p === '/troubleshoot/api/status') return json(res, 200, { checks: [] });
    if (p === '/wizard/hermes/api/sessions' && req.method === 'POST') { try { const j = JSON.parse(body); sessions[j.id] = sessions[j.id] || []; } catch (e) {} return json(res, 200, { ok: true }); }
    if (p === '/wizard/hermes/v1/runs' && req.method === 'POST') {
      let j = {}; try { j = JSON.parse(body); } catch (e) {}
      const words = typeof j.input === 'string' ? j.input : JSON.stringify(j.input);
      delivered.push(words);
      const now = Date.now() / 1000;
      sessions[j.session_id] = [{ id: 'm1', role: 'user', content: words, timestamp: now }, { id: 'm2', role: 'assistant', content: 'Hi! I can help with your mail, calendar, notes and more. What would you like to start with?', timestamp: now + 1 }];
      return json(res, 200, { run_id: 'r-' + delivered.length, status: 'completed' });
    }
    const m = p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (m) return json(res, 200, { data: sessions[decodeURIComponent(m[1])] || [] });
    if (p === '/wizard/hermes/api/sessions') return json(res, 200, { data: Object.keys(sessions).map(id => ({ id, title: 'First chat', message_count: sessions[id].length, last_active: Date.now() / 1000, source: 'wizard-mobile' })) });
    if (process.env.QA_DEBUG) console.log('404', req.method, p);
    json(res, 404, { error: 'not here' });
  });
});

const SHELLS = {
  phone: { page: '', ctx: { viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
  desktop: { page: 'desktop.html', ctx: { viewport: { width: 1280, height: 800 } } },
};

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const fails = [], notes = [];
  async function helloPage(shell, skin, denyMic = false, slowMic = 0) {
    const ctx = await browser.newContext(SHELLS[shell].ctx);
    await ctx.grantPermissions(['microphone'], { origin: base });
    await ctx.addInitScript(([s, deny, slow]) => {
      if (window !== window.top) return;
      try { localStorage.setItem('wos.skin', s); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wux.tour.v1', 'true'); } catch (e) {}
      // Denied permission, as a browser answers it once the owner said no.
      if (deny && navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new DOMException('Permission denied', 'NotAllowedError')));
      // A slow first microphone open (a permission prompt, a waking device).
      if (slow && navigator.mediaDevices) { const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__qaStreams = []; navigator.mediaDevices.getUserMedia = c => new Promise(r => setTimeout(r, slow)).then(() => real(c)).then(st => (window.__qaStreams.push(st), st)); }
    }, [skin, denyMic, slowMic]);
    const page = await ctx.newPage();
    page.on('pageerror', e => notes.push(`${shell}/${skin} pageerror: ${e.message}`));
    await page.goto(base + '/wizard-os-home/' + SHELLS[shell].page);
    await page.waitForFunction(() => window.WosWelcome?.active, null, { timeout: 20000 });
    for (let i = 0; i < 5; i++) {
      const t = await page.locator('.wl-card h2').textContent();
      if (t.trim() === 'Say hello') break;
      await page.locator('.wl-card [data-wl="next"]').first().click();
    }
    await page.waitForSelector('.wl-hello textarea');
    return { ctx, page };
  }
  const mic = page => page.locator('.wl-hello [data-wl="mic"]');
  async function speak(shell, skin) {
    const { ctx, page } = await helloPage(shell, skin);
    const tag = `${shell}/${skin}`;
    const has = await mic(page).count();
    if (BROKEN) {
      // The bug: no mic in the card, and the shell's orb (phone dock) can't be reached under the Welcome.
      const covered = await page.evaluate(() => { const o = document.querySelector('#orbWrap'); if (!o) return 'no orb'; const r = o.getBoundingClientRect(); const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return at?.closest('#wosWelcome') ? 'covered' : 'reachable'; });
      notes.push(`${tag}: mic buttons in Say hello: ${has}; dock orb: ${covered}`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-${skin}-before.png`) });
      await ctx.close(); return has === 0 ? 'broken' : 'has-mic';
    }
    if (!has) { fails.push(`${tag}: no mic button in Say hello`); await ctx.close(); return; }
    const label = await mic(page).getAttribute('aria-label');
    if (label !== 'Speak your first message') fails.push(`${tag}: mic label is ${JSON.stringify(label)}`);
    const idleBg = await mic(page).evaluate(b => getComputedStyle(b).backgroundColor + ' / ' + getComputedStyle(b).color);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-${skin}-idle.png`) });
    const t0 = transcribed, wire = delivered.length;
    await mic(page).click();
    const listening = await page.waitForFunction(() => document.querySelector('.wl-hello [data-wl="mic"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 8000 }).then(() => true, () => false);
    if (!listening) { fails.push(`${tag}: the mic never showed it was listening (${await page.locator('.wl-hello').innerText()})`); await ctx.close(); return; }
    const status = (await page.locator('.wl-hello .wl-voice').textContent().catch(() => '')).trim();
    await page.waitForTimeout(1600); // a real take: more than the shell's 450 ms / 1200 byte "no speech" floor
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-${skin}-listening.png`) });
    await mic(page).click();
    const landed = await page.waitForFunction(w => document.querySelector('.wl-hello textarea')?.value.trim() === w, SPOKEN, { timeout: 15000 }).then(() => true, () => false);
    const box = await page.locator('.wl-hello textarea').inputValue().catch(() => '');
    const stillOpen = await page.evaluate(() => !!window.WosWelcome?.active);
    if (!landed) { fails.push(`${tag}: after the take the box holds ${JSON.stringify(box)} (transcriber called ${transcribed - t0}x, welcome open ${stillOpen})`); await ctx.close(); return; }
    if (delivered.length !== wire) fails.push(`${tag}: speaking sent something before Send: ${JSON.stringify(delivered.slice(wire))}`);
    const back = await mic(page).getAttribute('aria-pressed');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-${skin}-spoken.png`) });
    await page.locator('.wl-hello button[type=submit]').click();
    await page.waitForFunction(() => !window.WosWelcome?.active, null, { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 60 && delivered.length === wire; i++) await page.waitForTimeout(250);
    const went = delivered.slice(wire);
    const thread = went.length ? await page.waitForFunction(() => /I can help with your mail/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true, () => false) : false;
    if (!(went.length === 1 && went[0] === SPOKEN && thread)) fails.push(`${tag}: Send gave the box ${JSON.stringify(went)}, thread with reply shown ${thread}`);
    else notes.push(`${tag}: mic "${label}" (${idleBg}); listening shows "${status}"; tap again put "${box}" in the box (mic back to aria-pressed=${back}); Send delivered it and the thread opened with the reply`);
    await ctx.close();
  }
  async function denied(shell) {
    const { ctx, page } = await helloPage(shell, 'nebula', true);
    const tag = `${shell}/denied`;
    if (!(await mic(page).count())) { fails.push(`${tag}: no mic button`); await ctx.close(); return; }
    await mic(page).click();
    await page.waitForFunction(() => /microphone/i.test(document.querySelector('.wl-hello .wl-voice')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const msg = (await page.locator('.wl-hello .wl-voice').textContent().catch(() => '')).trim();
    const pressed = await mic(page).getAttribute('aria-pressed');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-denied.png`) });
    if (!/microphone/i.test(msg) || !/type/i.test(msg)) fails.push(`${tag}: message ${JSON.stringify(msg)}`);
    const wire = delivered.length;
    await page.locator('.wl-hello textarea').fill('Typed instead');
    await page.locator('.wl-hello button[type=submit]').click();
    for (let i = 0; i < 60 && delivered.length === wire; i++) await page.waitForTimeout(250);
    const went = delivered.slice(wire);
    if (!(went.length === 1 && went[0] === 'Typed instead')) fails.push(`${tag}: typed Send gave ${JSON.stringify(went)}`);
    else notes.push(`${tag}: "${msg}" (mic aria-pressed=${pressed}); typing and Send still delivered "Typed instead"`);
    await ctx.close();
  }
  // Codex P1 on the PR: a Stop tap while the mic is still opening must not leave a recorder running with no controls.
  async function slowStop(shell) {
    const { ctx, page } = await helloPage(shell, 'nebula', false, 2000);
    const tag = `${shell}/slow-mic`;
    await mic(page).click(); await page.waitForTimeout(300); await mic(page).click(); // Stop before the mic opened
    await page.waitForTimeout(3000);
    const live = await page.evaluate(() => JSON.stringify({ log: window.__welcomeLog, voice: document.querySelector('#device')?.dataset.voice || '', liveTracks: (window.__qaStreams || []).flatMap(x => x.getTracks()).filter(t => t.readyState === 'live').length, toast: document.querySelector('#toast,.toast')?.textContent || '' }));
    const pressed = await mic(page).getAttribute('aria-pressed');
    const box1 = await page.locator('.wl-hello textarea').inputValue();
    // Either the take kept going (the card still says listening, so the owner can stop it) or it ended cleanly.
    if (pressed === 'true') {
      await page.waitForTimeout(800); await mic(page).click();
      const landed = await page.waitForFunction(w => document.querySelector('.wl-hello textarea')?.value.trim() === w, SPOKEN, { timeout: 15000 }).then(() => true, () => false);
      if (!landed) fails.push(`${tag}: after the late Stop the box holds ${JSON.stringify(await page.locator('.wl-hello textarea').inputValue())}`);
      else notes.push(`${tag}: an early Stop waited for the mic; the card kept listening and the next tap put the words in the box`);
    } else if (box1.trim() === SPOKEN) notes.push(`${tag}: the early Stop finished the take once the mic opened; the words landed in the box`);
    else if (shell === 'phone' && JSON.parse(live).voice === 'idle' && !JSON.parse(live).liveTracks && /mic:end/.test(live)) notes.push(`${tag}: the early Stop ended the take before the mic opened (the shell's own rule: nothing recorded, the orb is idle, no hidden recording); the card says so`);
    else fails.push(`${tag}: mic shows idle and the box holds ${JSON.stringify(box1)} (a recorder may be running with no controls) ${live}`);
    await ctx.close();
  }
  async function liveSkin(shell) {
    const { ctx, page } = await helloPage(shell, 'nebula');
    if (!(await mic(page).count())) { await ctx.close(); return; }
    const look = () => mic(page).evaluate(b => getComputedStyle(b).backgroundColor + ' / ' + getComputedStyle(b).borderColor);
    const a = await look();
    await page.evaluate(() => window.WosSkin.set('obsidian-light'));
    let b = a;
    for (let i = 0; i < 30 && b === a; i++) { await page.waitForTimeout(200); b = await look(); } // the skin's styles load async
    const still = await mic(page).count();
    if (a === b || !still) fails.push(`${shell} live skin change: mic look ${a} -> ${b}, still there ${!!still}`);
    else notes.push(`${shell} live skin change Nebula -> Light: mic ${a} -> ${b}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${shell}-live-light.png`) });
    await ctx.close();
  }
  try {
    for (const shell of Object.keys(SHELLS)) {
      for (const skin of ['nebula', 'obsidian-light']) {
        const r = await speak(shell, skin);
        if (BROKEN && r !== 'broken') fails.push(`${shell}/${skin}: expected no mic on the baseline`);
      }
      if (!BROKEN) { await denied(shell); await slowStop(shell); await liveSkin(shell); }
    }
  } catch (e) { fails.push('error: ' + (e && e.stack || e)); }
  await browser.close(); server.close();
  for (const n of notes) console.log('  ' + n);
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log(BROKEN ? 'PASS (baseline is broken as reported)' : 'PASS');
})();
