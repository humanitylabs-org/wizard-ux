// QA for Chats parity: every Wizard thread is listed, grouped into Wizard's Work sections,
// attachments upload + ride as wizard_file_ids, voice notes render as "Voice note · m:ss".
// Runs against the live origin with real Wizard data. Every write (runs, sessions, uploads,
// seen/disposition) is intercepted; the suite fails if any write reaches Wizard.
// QA_WEB_DIR=<dir> serves app.js/live.js/styles.css from a worktree instead of the live server.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9440/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || '';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || require('path').join(require('os').homedir(), '.hermes/cache/scratch/chats-parity', 'qa-chats-parity');
const EXEC = process.env.QA_CHROME || undefined;
const uploads = require('./tools/qa-uploads.cjs').uploadsFixture();
const voiceSession = { id: 'qa_voice_thread', title: 'QA voice note', source: 'api', updated_at: new Date().toISOString(), message_count: 1, wizard_status: 'completed' };
const wav = Buffer.alloc(44 + 32000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40);
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
    if (/\/wizard\/v1\/uploads(?:\/|$)/.test(u) && !['GET', 'HEAD'].includes(q.method())) { const body = q.postDataBuffer() || Buffer.alloc(0); writes.push({ m:q.method(), u, headers:q.headers(), body:'<' + body.length + ' bytes>' }); }
    if (await uploads.route(r)) return;
    const parsed = new URL(u);
    if (q.method() === 'GET' && parsed.pathname === '/wizard/hermes/api/sessions') { const resp = await r.fetch(), data = await resp.json(); if (Number(parsed.searchParams.get('offset') || 0) === 0) (data.data || data.sessions).unshift(voiceSession); return r.fulfill({ response:resp, json:data }); }
    if (q.method() === 'GET' && parsed.pathname === '/wizard/hermes/api/sessions/qa_voice_thread') return r.fulfill({ json:{ session:voiceSession } });
    if (q.method() === 'GET' && parsed.pathname === '/wizard/hermes/api/sessions/qa_voice_thread/messages') return r.fulfill({ json:{ data:[{ id:1, role:'user', content:'[WIZARD_FILE_CHIPS_V1]\n[{"id":"drop_qavoice","filename":"wizard-voice-qa.wav","mime":"audio/wav","bytes":32044}]\n[/WIZARD_FILE_CHIPS_V1]', timestamp:Date.now()/1000 }], has_more:false } });
    if (q.method() === 'GET' && parsed.pathname === '/wizard/files/drop_qavoice/content') return r.fulfill({ contentType:'audio/wav', body:wav });
    if (q.method() !== 'GET' && q.method() !== 'HEAD') {
      const body = q.postDataBuffer() || Buffer.alloc(0);
      writes.push({ m: q.method(), u: u.replace(/^https:\/\/[^/]+/, ''), headers: q.headers(), body: /upload/.test(u) ? `<${body.length} bytes>` : body.toString() });
      if (/\/wizard\/files\/upload$/.test(u)) return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ file: { id: 'drop_qa' + writes.length, filename: q.headers()['x-wizard-filename'], mime: q.headers()['x-wizard-mime'], bytes: body.length } }) });
      if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { id: q.postDataJSON().id } }) });
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return r.continue();
  });
  ctx.on('request', q => { if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\//.test(q.url()) && !/\/wizard-os-home\//.test(q.url())) leaked.push(q.url()); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|Framing .*frame-ancestors/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.exposeFunction('__qaRej', t => errs.push('unhandled: ' + t));
  await p.addInitScript(() => addEventListener('unhandledrejection', e => window.__qaRej(String(e.reason && e.reason.stack || e.reason))));
  p.on('pageerror', e => { if (/wizard-os-home\//.test(String(e.stack)) || !/https?:\/\//.test(String(e.stack))) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.removeItem('wos.chats.sections.v1'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForFunction(() => window.__wos.live.fullAt, null, { timeout: 60000 });

  /* 1. Exact bounded API window: all active rows plus newest 50 archived. */
  const windowCheck = await p.evaluate(async () => {
    let n = 0, snap = '', archive = 0, total = 0; const ids = new Set();
    for (let off = 0; off < 5000;) {
      const r = await (await fetch(`/wizard/hermes/api/sessions?view=list&window=archive-50&limit=100&offset=${off}&include_children=false${snap ? '&snapshot=' + encodeURIComponent(snap) : ''}`, { credentials: 'same-origin' })).json();
      if (!snap && r.snapshot) snap = r.snapshot;
      const rows = r.data || r.sessions || []; rows.filter(x => !x.hidden).forEach(x => ids.add(x.id)); n += rows.filter(x => !x.hidden).length; archive = r.archive_returned; total = r.archive_total; off += rows.length;
      if (!rows.length || r.has_more === false || r.pagination?.has_more === false) break;
    }
    const live = __wos.live.sessions.filter(s => !s.hidden);
    return { n, exact:live.length === ids.size && live.every(s => ids.has(s.id)), archive, total };
  });
  const listed = await p.evaluate(() => window.__wos.live.sessions.filter(s => !s.hidden).length);
  ok(windowCheck.exact && listed > 60 && windowCheck.archive <= 50 && windowCheck.total >= windowCheck.archive, `Chats holds exact Wizard window (${listed}/${windowCheck.n}, archive ${windowCheck.archive}/${windowCheck.total})`, JSON.stringify(windowCheck));

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
  // Pick a real archived thread outside the loaded window; search must reach it.
  const older = await p.evaluate(async () => { const live = new Set(__wos.live.sessions.map(s => s.id)); const j = await (await fetch('/wizard/hermes/api/sessions?limit=100&offset=300&include_children=false')).json(); return j.data.find(s => !s.hidden && !live.has(s.id) && s.title); });
  if (!older) throw Error('Expected an older real thread outside archive window');
  await p.fill('[data-chsearch]', older.title);
  await p.waitForFunction(id => !!document.querySelector('[data-chopen="' + CSS.escape(id) + '"]'), older.id);
  ok(await p.locator(`[data-chopen="${older.id}"]`).count() === 1, 'search finds an older real thread outside the loaded archive window');
  await p.fill('[data-chsearch]', ''); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/parity-sections.png` });

  /* 3. Voice note renders as a voice note, not a filename. */
  const vid = await p.evaluate(() => window.__wos.live.sessions.find(s => s.id === 'qa_voice_thread')?.id);
  ok(!!vid, 'found this thread (has a voice note)');
  if (vid) {
    await p.evaluate(id => __wos.openWizardThread ? __wos.openWizardThread(id) : null, vid);
    await p.waitForSelector('.vnote', { timeout: 20000 }).catch(() => {});
    const v = await p.evaluate(() => { const n = document.querySelector('.vnote'); return n && { text: n.textContent, bub: n.closest('.bub').textContent }; });
    ok(!!v && /Voice note/.test(v.text), 'voice note shows mic + “Voice note”', JSON.stringify(v));
    ok(!!v && !/wizard-voice-|\.m4a/.test(v.bub), 'no raw filename in the bubble');
    await p.waitForFunction(() => /\d:\d\d/.test(document.querySelector('.vnote .vd')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const dur = await p.$eval('.vnote .vd', e => e.textContent).catch(() => '');
    ok(dur === '0:02', `voice note shows actual PCM fixture length (${dur}; 16000 samples at 8000 Hz = 0:02)`);
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
  const ups = uploads.completed();
  ok(ups.length === 2 && ups.some(w => w.filename === 'photo.png' && w.mime === 'image/png' && Buffer.concat(w.chunks).equals(png)) && ups.some(w => w.filename === 'notes.pdf' && w.mime === 'application/pdf' && Buffer.concat(w.chunks).toString() === '%PDF-1.4 qa'), 'resumable Wizard Files uploads preserve exact filenames, MIME and bytes');
  await p.locator('.ch-att', { hasText: 'notes.pdf' }).locator('[data-attrm]').tap(); await p.waitForTimeout(200);
  ok(await p.locator('.ch-tray .ch-att').count() === 1, 'remove (×) drops one attachment');
  await p.screenshot({ path: `${OUT}/parity-attach.png` });
  // No text → the round button is the mic (James 10 Oct); a photo-only send still goes through Ctrl/⌘+Enter.
  await p.locator('.ch-compose textarea').focus(); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(1500);
  let run = writes.filter(w => /\/v1\/runs$/.test(w.u)).pop();
  const rb = run ? JSON.parse(run.body) : {};
  ok(Array.isArray(rb.wizard_file_ids) && rb.wizard_file_ids.length === 1 && /^drop_qa/.test(rb.wizard_file_ids[0]), 'photo-only send carries wizard_file_ids', run?.body);
  ok(rb.input === 'Please use the attached file.', 'photo-only send uses Wizard’s attachment wording', rb.input);
  // Send returns to list; reopen the newly created local session before inspecting its pending bubble.
  await p.evaluate(id => __wos.openWizardThread(id), rb.session_id); await p.waitForTimeout(400);
  ok(await p.locator('.msg.u.pending img').count() === 1, 'sent photo shows in the reopened thread');

  /* 5. Attachments: reply in an existing thread with text. */
  const n0 = writes.filter(w => /\/v1\/runs/.test(w.u)).length;
  const tid = await p.evaluate(() => window.__wos.live.sessions.find(s => s.id === 'qa_voice_thread')?.id);
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
