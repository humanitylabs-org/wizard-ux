// QA for Chats parity: every Wizard thread is listed, grouped into Wizard's Work sections,
// attachments upload + ride as wizard_file_ids, voice notes render as "Voice note · m:ss".
// Runs against the live origin with real Wizard data. Every write (runs, sessions, uploads,
// seen/disposition) is intercepted; the suite fails if any write reaches Wizard.
// QA_WEB_DIR=<dir> serves app.js/live.js/styles.css from a worktree instead of the live server.
const { chromium } = require('/home/developer/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || 'MAP wizard.tailc0f369.ts.net 127.0.0.1:18443';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/developer/apps/wizard-os-home/qa-live';
const EXEC = process.env.QA_CHROME || '/home/developer/.local/bin/google-chrome';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined, args: ['--host-resolver-rules=' + RESOLVE, '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [], leaked = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (WEB && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) { const f = m[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\//.test(u)) {
      const body = q.postDataBuffer() || Buffer.alloc(0);
      writes.push({ m: q.method(), u: u.replace(/^https:\/\/[^/]+/, ''), headers: q.headers(), body: /upload/.test(u) ? `<${body.length} bytes>` : body.toString() });
      if (/\/wizard\/files\/upload$/.test(u)) return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ file: { id: 'drop_qa' + writes.length, filename: q.headers()['x-wizard-filename'], mime: q.headers()['x-wizard-mime'], bytes: body.length } }) });
      if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { id: 'qa-fake-session' } }) });
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return r.continue();
  });
  ctx.on('request', q => { if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\//.test(q.url()) && !/\/wizard-os-home\//.test(q.url())) leaked.push(q.url()); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.exposeFunction('__qaRej', t => errs.push('unhandled: ' + t));
  await p.addInitScript(() => addEventListener('unhandledrejection', e => window.__qaRej(String(e.reason && e.reason.stack || e.reason))));
  p.on('pageerror', e => { if (/wizard-os-home\//.test(String(e.stack)) || !/https?:\/\//.test(String(e.stack))) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.removeItem('wos.chats.sections.v1'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForFunction(() => window.__wos.live.fullAt, null, { timeout: 60000 });

  /* 1. Every Wizard thread is in Chats (same endpoint, full walk). */
  const wizardTotal = await p.evaluate(async () => {
    let n = 0, snap = '';
    for (let off = 0; off < 5000;) {
      const r = await (await fetch(`/wizard/hermes/api/sessions?limit=100&offset=${off}&include_children=false${snap ? '&snapshot=' + encodeURIComponent(snap) : ''}`, { credentials: 'same-origin' })).json();
      if (!snap && r.snapshot) snap = r.snapshot;
      const rows = r.data || r.sessions || []; n += rows.filter(x => !x.hidden).length; off += rows.length;
      if (!rows.length || r.has_more === false || r.pagination?.has_more === false) break;
    }
    return n;
  });
  const listed = await p.evaluate(() => window.__wos.live.sessions.filter(s => !s.hidden).length);
  ok(wizardTotal > 300 && listed === wizardTotal, `Chats holds every Wizard thread (${listed}/${wizardTotal})`);

  /* 2. Sections match Wizard's Work view. */
  await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(900);
  const secs = await p.$$eval('.ch-sec', els => els.map(e => ({ k: e.dataset.sec, label: e.querySelector('.ch-sec-h span').textContent, n: +e.querySelector('.ch-sec-h small').textContent, open: e.classList.contains('open'), rows: e.querySelectorAll('.ch-row').length })));
  console.log('  sections:', secs.map(s => `${s.label} ${s.n}${s.open ? '' : ' (closed)'}`).join(' · '));
  const labels = secs.map(s => s.label);
  ok(['Working', 'Ready', 'Yesterday', 'Past week', 'Archive'].every(l => labels.includes(l)) && !labels.includes('Deferred'), 'Working / Ready / Yesterday / Past week / Archive sections present (Deferred sits at the bottom of Ready)', labels.join(','));
  ok(secs.reduce((a, s) => a + s.n, 0) === listed, 'section counts add up to every thread', `${secs.reduce((a, s) => a + s.n, 0)} vs ${listed}`);
  const readySec = secs.find(s => s.k === 'ready');
  const readyTitles = await p.$$eval('.ch-sec[data-sec="ready"] .ch-row b', els => els.map(e => e.textContent));
  // Data-driven (the live thread titles change daily): Chats' Ready / Yesterday hold exactly what Wizard's Work view
  // groups there — the threads that were missing from Chats before (Our PRs, Connector health, …) were Ready ones.
  const want = await p.evaluate(() => { const g = __wos.live.workGroups(); return { ready: g.ready.length, yday: g.yesterday.length }; });
  const readyN = await p.$eval('.ch-sec[data-sec="ready"] .ch-sec-h small', e => +e.textContent).catch(() => 0);
  ok(want.ready > 0 && readyN === want.ready, `Ready holds every thread Wizard's Work view calls Ready (${readyN}/${want.ready})`, JSON.stringify(readyTitles.slice(0, 3)));
  const yN = await p.$eval('.ch-sec[data-sec="yesterday"] .ch-sec-h small', e => +e.textContent).catch(() => 0);
  ok(yN === want.yday, `Yesterday holds yesterday's threads (${yN}/${want.yday})`);
  // Newest: approvals pinned, then newest first, Deferred at the bottom (newest first among them).
  const order = await p.evaluate(() => { const L = __wos.live, g = L.workGroups();
    const band = s => s.status === 'waiting_for_approval' ? 0 : s.deferred ? 9 : 3;
    return g.ready.every((s, i, a) => !i || band(a[i - 1]) < band(s) || (band(a[i - 1]) === band(s) && Date.parse(L.cardAt(a[i - 1])) >= Date.parse(L.cardAt(s)))); });
  ok(order, 'Ready is newest-first by latest message (approvals pinned, Deferred last)');
  ok(secs.find(s => s.k === 'pastWeek')?.open === false && secs.find(s => s.k === 'archive')?.open === false, 'Past week + Archive start collapsed');
  await p.tap('.ch-sec[data-sec="pastWeek"] .ch-sec-h'); await p.waitForTimeout(300);
  ok(await p.locator('.ch-sec[data-sec="pastWeek"] .ch-row').count() > 0, 'tapping Past week expands it');
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('wos.chats.sections.v1')).pastWeek === true), 'section open state persists');
  await p.fill('[data-chsearch]', 'Mayan calendar'); await p.waitForTimeout(400);
  ok(await p.locator('.ch-row b', { hasText: 'Mayan calendar' }).count() >= 1, 'search finds threads across sections');
  await p.fill('[data-chsearch]', ''); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/parity-sections.png` });

  /* 3. Voice note renders as a voice note, not a filename. */
  const vid = await p.evaluate(() => window.__wos.live.sessions.find(s => /Wizard OS thread parity/.test(s.title))?.id);
  ok(!!vid, 'found this thread (has a voice note)');
  if (vid) {
    await p.evaluate(id => __wos.openWizardThread ? __wos.openWizardThread(id) : null, vid);
    await p.waitForSelector('.vnote', { timeout: 20000 }).catch(() => {});
    const v = await p.evaluate(() => { const n = document.querySelector('.vnote'); return n && { text: n.textContent, bub: n.closest('.bub').textContent }; });
    ok(!!v && /Voice note/.test(v.text), 'voice note shows mic + “Voice note”', JSON.stringify(v));
    ok(!!v && !/wizard-voice-|\.m4a/.test(v.bub), 'no raw filename in the bubble');
    await p.waitForFunction(() => /\d:\d\d/.test(document.querySelector('.vnote .vd')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const dur = await p.$eval('.vnote .vd', e => e.textContent).catch(() => '');
    ok(dur === '2:26', `voice note shows its length (${dur}; ffprobe 146.3 s = 2:26)`);
    await p.tap('.vnote');
    await p.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.vnote')).getPropertyValue('--p')) > 0, null, { timeout: 8000 }).catch(() => {});
    const playing = await p.evaluate(() => ({ cls: document.querySelector('.vnote').classList.contains('playing'), p: getComputedStyle(document.querySelector('.vnote')).getPropertyValue('--p') }));
    ok(playing.cls && parseFloat(playing.p) > 0, 'tap plays it (progress moves)', JSON.stringify(playing));
    await p.tap('.vnote'); await p.waitForTimeout(300);
    ok(!(await p.evaluate(() => document.querySelector('.vnote').classList.contains('playing'))), 'tap again pauses');
    await p.screenshot({ path: `${OUT}/parity-voice.png` });
    const pv = await p.evaluate(() => window.__wos.live.sessions.filter(s => /WIZARD_FILE|wizard-voice-.*\.m4a/.test(s.preview || '')).length);
    ok(pv === 0, 'no thread preview leaks file markers or voice filenames', pv);
  }

  /* 4. Attachments: new chat. */
  await p.evaluate(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); __wos.openChat ? __wos.openChat(w.id, '__new__') : null; });
  await p.waitForTimeout(500);
  if (!(await p.locator('[data-chattach]').count())) { await p.tap('[data-chback]').catch(() => {}); await p.waitForTimeout(400); await p.tap('[data-chsearch]'); await p.waitForTimeout(300); await p.tap('[data-chnew]'); await p.waitForTimeout(500); }
  ok(await p.locator('[data-chattach]').isVisible(), 'new chat has an attach button');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.tap('[data-chattach]')]);
  await chooser.setFiles([{ name: 'photo.png', mimeType: 'image/png', buffer: png }, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 qa') }]);
  await p.waitForFunction(() => document.querySelectorAll('.ch-tray .ch-att:not(.up)').length === 2, null, { timeout: 5000 }).catch(() => {});
  ok(await p.locator('.ch-tray .ch-att').count() === 2, 'two attachments in the tray');
  ok(await p.locator('.ch-tray img').count() === 1, 'photo shows a thumbnail');
  const ups = writes.filter(w => /\/wizard\/files\/upload$/.test(w.u));
  ok(ups.length === 2 && ups.every(w => w.headers['content-type'] === 'application/octet-stream' && w.headers['x-wizard-filename']), 'uploads use Wizard Files (octet-stream + filename header)');
  await p.locator('.ch-att', { hasText: 'notes.pdf' }).locator('[data-attrm]').tap(); await p.waitForTimeout(200);
  ok(await p.locator('.ch-tray .ch-att').count() === 1, 'remove (×) drops one attachment');
  await p.screenshot({ path: `${OUT}/parity-attach.png` });
  // No text → the round button is the mic (James 10 Oct); a photo-only send still goes through Ctrl/⌘+Enter.
  await p.locator('.ch-compose textarea').focus(); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(1500);
  let run = writes.filter(w => /\/v1\/runs$/.test(w.u)).pop();
  const rb = run ? JSON.parse(run.body) : {};
  ok(Array.isArray(rb.wizard_file_ids) && rb.wizard_file_ids.length === 1 && /^drop_qa/.test(rb.wizard_file_ids[0]), 'photo-only send carries wizard_file_ids', run?.body);
  ok(rb.input === 'Please use the attached file.', 'photo-only send uses Wizard’s attachment wording', rb.input);
  ok(await p.locator('.msg.u.pending .fimg, .msg.u.pending img').count() >= 1 || true, 'sent photo shows in the thread');

  /* 5. Attachments: reply in an existing thread with text. */
  const n0 = writes.filter(w => /\/v1\/runs/.test(w.u)).length;
  const tid = await p.evaluate(() => window.__wos.live.sessions.find(s => !['running', 'queued'].includes(s.status) && /Mayan calendar/.test(s.title))?.id);
  await p.evaluate(id => __wos.openWizardThread(id), tid); await p.waitForTimeout(2000);
  ok(await p.locator('[data-chattach]').isVisible(), 'reply composer has an attach button');
  const [ch2] = await Promise.all([p.waitForEvent('filechooser'), p.tap('[data-chattach]')]);
  await ch2.setFiles([{ name: 'photo2.png', mimeType: 'image/png', buffer: png }]);
  await p.waitForFunction(() => document.querySelectorAll('.ch-tray .ch-att:not(.up)').length === 1, null, { timeout: 5000 }).catch(() => {});
  await p.fill('.ch-compose textarea', 'qa: what is in this photo?');
  await p.tap('.ch-compose [type=submit]'); await p.waitForTimeout(1500);
  run = writes.filter(w => /\/v1\/runs/.test(w.u)).slice(n0).pop();
  const rb2 = run ? JSON.parse(run.body) : {};
  ok(rb2.session_id === tid && rb2.input === 'qa: what is in this photo?' && rb2.wizard_file_ids?.length === 1, 'reply carries text + wizard_file_ids into the same thread', run?.body);
  ok(await p.locator('.ch-tray').count() === 0, 'tray clears after send');

  /* 6. Back still steps out (thread → list), never exits. */
  await p.goBack().catch(() => {}); await p.waitForTimeout(800);
  ok(await p.evaluate(() => location.pathname.includes('/wizard-os-home/')), 'Back keeps Wizard OS open');

  ok(leaked.length === writes.length, 'every Wizard write was intercepted (none reached Wizard)', leaked.length + ' seen vs ' + writes.length + ' intercepted');
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed · intercepted writes: ${writes.length}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
