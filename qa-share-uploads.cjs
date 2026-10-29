// QA: chat attachments over the resumable /wizard/v1/uploads API (briefs/share-files.md, acceptance 1).
// Drives the real phone shell against tools/share-fixture.mjs (spawned here, so it can be killed and restarted
// mid-upload). Nothing reaches a real Wizard.
//
//   QA_BIG=<path to a big file, e.g. 500 MB>  QA_DATA=<fixture data dir>  QA_OUT=<shots dir>  node qa-share-uploads.cjs
//   QA_PLAYWRIGHT=<playwright module path>  QA_CHROME=<chrome binary, optional>  QA_PORT=9652
//
// Checks: progress on the chip while uploading · Send stays live while uploading · a send mid-upload clears the
// composer at once and the message arrives with the file once it lands · a hung upload create is retried (no
// 0% forever) · the send carries the Wizard Files id · killing the fixture mid-upload and restarting it resumes from the server's offset (no restart from 0) and
// the stored bytes match the source · removing a chip cancels its upload · a full Wizard (507) says “Not enough space
// on your Wizard” and attaches nothing · a box without resumable_uploads uses the old POST /wizard/files/upload ·
// Back from the thread keeps the app open.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), http = require('http');
const { spawn } = require('child_process');
const PORT = Number(process.env.QA_PORT || 9652);
const BASE = `http://127.0.0.1:${PORT}/wizard-os-home/`;
const DATA = process.env.QA_DATA || path.join(process.env.TMPDIR || '/tmp', 'qa-share-uploads');
const OUT = process.env.QA_OUT || path.join(DATA, 'shots');
const BIG = process.env.QA_BIG || '';
const THROTTLE = process.env.QA_THROTTLE || '40'; // MB/s for the big-file phase, so a kill lands mid-upload
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = p => new Promise((res, rej) => http.get(`http://127.0.0.1:${PORT}${p}`, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));
const post = p => new Promise((res, rej) => { const q = http.request(`http://127.0.0.1:${PORT}${p}`, { method: 'POST' }, r => { r.resume(); r.on('end', res); }); q.on('error', rej); q.end(); });

let fx = null;
async function startFixture(extra = []) {
  const log = fs.openSync(path.join(DATA, 'fixture.log'), 'a');
  fx = spawn(process.execPath, [path.join(__dirname, 'tools', 'share-fixture.mjs'), String(PORT), `--data=${path.join(DATA, 'fx')}`, '--host=127.0.0.1', ...extra], { stdio: ['ignore', log, log] });
  for (let i = 0; i < 50; i++) { try { await get('/wizard/v1/bootstrap'); return; } catch (e) { await sleep(100); } }
  throw new Error('fixture did not start');
}
async function stopFixture(sig = 'SIGKILL') { if (!fx) return; const p = fx; fx = null; p.kill(sig); await new Promise(r => p.once('exit', r)); }
const sha = file => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', c => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej); });

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForFunction(() => window.WizConfig && window.WizConfig.live, null, { timeout: 10000 }).catch(() => {});
  await sleep(800);
  const wid = await p.evaluate(() => { __wos.goDesk(1); return __wos.desks[1].wins.find(x => __wos.wins[x].app === 'chats'); });
  await sleep(500);
  await p.locator(`.win[data-win="${wid}"] .ch-row[data-chopen]`).first().tap(); await sleep(1000);
  const tid = await p.evaluate(id => __wos.wins[id]?.thread ?? null, wid);
  return { ctx, p, errs, wid, tid };
}
async function attach(p, wid, files) {
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator(`.win[data-win="${wid}"] [data-chattach]`).first().tap()]);
  await fc.setFiles(files);
}
const chip = (p, wid) => p.evaluate(id => { const el = document.querySelector(`.win[data-win="${id}"] .ch-att`); return el ? { up: el.classList.contains('up'), wait: el.classList.contains('wait'), text: el.querySelector('small')?.textContent || '', bar: el.style.getPropertyValue('--up') } : null; }, wid);
const sendDisabled = (p, wid) => p.evaluate(id => !!document.querySelector(`.win[data-win="${id}"] button.ch-send`)?.disabled, wid);
async function typeAndSend(p, wid, text) {
  const ta = p.locator(`.win[data-win="${wid}"] textarea`).first();
  await ta.tap(); await ta.fill(text); await sleep(150);
  await p.locator(`.win[data-win="${wid}"] button.ch-send`).first().tap();
}
async function waitRun(text, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const s = await get('/__fixture/state');
    const run = s.runs.find(r => (r.file_ids || []).length && s.sessions.some(x => x.id === r.session_id && x.user_messages.some(m => m.includes(text))));
    if (run || Date.now() - t0 > ms) return { run, s };
    await sleep(300);
  }
}

(async () => {
  fs.rmSync(path.join(DATA, 'fx'), { recursive: true, force: true });
  const small = path.join(DATA, 'qa-small.bin');
  fs.writeFileSync(small, crypto.randomBytes(3 * 1024 * 1024 + 123));
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });

  // 1. Resumable route, small file: progress, Send gated, delivered id.
  await startFixture(['--chunk=1048576', '--throttle=4']);
  {
    const { ctx, p, errs, wid, tid } = await boot(b);
    ok(!!tid, 'a thread is open', String(tid));
    ok(await p.evaluate(() => window.WizUploads?.supported()), 'bootstrap advertises resumable uploads → WizUploads on');
    await attach(p, wid, small);
    await sleep(350);
    const c1 = await chip(p, wid);
    ok(c1 && c1.up && /%/.test(c1.text), 'chip shows upload progress', c1);
    ok(!(await sendDisabled(p, wid)), 'Send stays live while the file uploads');
    await p.screenshot({ path: path.join(OUT, '1-small-progress.png') });
    await p.waitForFunction(id => { const el = document.querySelector(`.win[data-win="${id}"] .ch-att`); return el && !el.classList.contains('up'); }, wid, { timeout: 20000 }).catch(() => {});
    ok(!(await sendDisabled(p, wid)), 'Send is enabled once the upload completes');
    const st = await get('/__fixture/state');
    const u = st.uploads.find(x => x.filename === 'qa-small.bin');
    ok(u && u.status === 'complete' && u.patches >= 3, 'upload went in chunks via PATCH and completed', u);
    ok(st.oldUploads === 0, 'old /wizard/files/upload not used');
    await typeAndSend(p, wid, 'QA small resumable');
    const { run } = await waitRun('QA small resumable');
    ok(run && run.file_ids.includes(u?.file) && !run.missing.length, 'send carried the Wizard Files id', run);
    await p.evaluate(() => history.back()); await sleep(600);
    ok(await p.evaluate(() => !!window.__wos && document.visibilityState === 'visible'), 'Back after send: the app is still open');
    ok(!errs.length, 'no page errors (small)', errs.join(' | '));
    await ctx.close();
  }
  await stopFixture('SIGTERM');

  // 1b. Send mid-upload (James, 19 Oct 2026): no "still uploading" gate. The composer clears at once, nothing is
  // admitted half-attached, and the message arrives with the Wizard Files id after the upload lands.
  fs.rmSync(path.join(DATA, 'fx'), { recursive: true, force: true });
  await startFixture(['--chunk=1048576', '--throttle=1']);
  {
    const { ctx, p, errs, wid } = await boot(b);
    await attach(p, wid, small); await sleep(900);
    const c0 = await chip(p, wid);
    ok(c0 && c0.up, 'mid-upload: chip still uploading at the send tap', c0);
    const toasts = [];
    await p.exposeFunction('__qaToast2', t => toasts.push(t));
    await p.evaluate(() => new MutationObserver(() => { const t = document.body.innerText; if (/still uploading/i.test(t)) window.__qaToast2(t.match(/[^\n]*still uploading[^\n]*/i)[0]); }).observe(document.body, { subtree: true, childList: true, characterData: true }));
    await typeAndSend(p, wid, 'QA send while uploading');
    await sleep(500);
    const after = await p.evaluate(id => ({ text: document.querySelector(`.win[data-win="${id}"] textarea`)?.value || '', chips: document.querySelectorAll(`.win[data-win="${id}"] .ch-compose .ch-att`).length }), wid);
    ok(!toasts.length, 'mid-upload: no "still uploading" block', toasts);
    ok(after.text === '' && after.chips === 0, 'mid-upload: composer cleared at once (message taken)', after);
    await p.screenshot({ path: path.join(OUT, '1b-sent-while-uploading.png') });
    const early = await get('/__fixture/state');
    ok(!early.runs.some(r => (r.file_ids || []).some(id => String(id).startsWith('pending:'))), 'mid-upload: no placeholder id ever reaches the agent');
    const { run, s: st } = await waitRun('QA send while uploading', 30000);
    const u = st.uploads.filter(x => x.filename === 'qa-small.bin').pop();
    ok(u && u.status === 'complete', 'mid-upload: the upload finished in the background', u);
    ok(run && run.file_ids.includes(u?.file) && !run.missing.length, 'mid-upload: message delivered with the Wizard Files id', run);
    ok(!errs.length, 'no page errors (send while uploading)', errs.join(' | '));
    await ctx.close();
  }
  await stopFixture('SIGTERM');

  // 1c. A stalled Wizard never answers the upload create (19 Oct 2026: chip sat at 0% forever). The client gives up
  // on that call, retries, and the file lands.
  fs.rmSync(path.join(DATA, 'fx'), { recursive: true, force: true });
  await startFixture(['--chunk=1048576', '--hang-create=1']);
  {
    const { ctx, p, errs, wid } = await boot(b);
    await attach(p, wid, small); await sleep(1500);
    const c0 = await chip(p, wid);
    ok(c0 && c0.up, 'hung create: chip waiting while the create hangs', c0);
    await p.waitForFunction(id => { const el = document.querySelector(`.win[data-win="${id}"] .ch-att`); return el && !el.classList.contains('up'); }, wid, { timeout: 40000 }).catch(() => {});
    const st = await get('/__fixture/state');
    const u = st.uploads.filter(x => x.filename === 'qa-small.bin').pop();
    ok(st.hungCreates === 1 && u && u.status === 'complete', 'hung create: retried and completed (no 0% forever)', { hung: st.hungCreates, u });
    ok(!errs.length, 'no page errors (hung create)', errs.join(' | '));
    await ctx.close();
  }
  await stopFixture('SIGTERM');

  // 2. Remove a chip mid-upload cancels it (no completed upload, no send).
  await startFixture(['--chunk=1048576', '--throttle=1']);
  {
    const { ctx, p, errs, wid } = await boot(b);
    await attach(p, wid, small); await sleep(1200);
    await p.locator(`.win[data-win="${wid}"] [data-attrm]`).first().tap(); await sleep(2500);
    const st = await get('/__fixture/state');
    const u = st.uploads.filter(x => x.filename === 'qa-small.bin').pop();
    ok(u && u.status !== 'complete' && u.offset < u.bytes, 'removing the chip cancelled the upload', u);
    ok(!(await chip(p, wid)), 'chip is gone');
    ok(!errs.length, 'no page errors (cancel)', errs.join(' | '));
    await ctx.close();
  }
  await stopFixture('SIGTERM');

  // 3. Big file: kill the Wizard mid-upload, restart it, the upload resumes from the server offset.
  if (BIG && fs.existsSync(BIG)) {
    fs.rmSync(path.join(DATA, 'fx'), { recursive: true, force: true });
    await startFixture([`--throttle=${THROTTLE}`]);
    const size = fs.statSync(BIG).size;
    const { ctx, p, errs, wid } = await boot(b);
    const t0 = Date.now();
    await attach(p, wid, BIG);
    let seen = [], killedAt = -1;
    for (;;) {
      await sleep(500);
      const c = await chip(p, wid); if (c) seen.push(c.text);
      const s = await get('/__fixture/state').catch(() => null);
      const u = s && s.uploads.find(x => x.filename === path.basename(BIG));
      if (u && u.offset >= size * 0.4) { killedAt = u.offset; break; }
      if (Date.now() - t0 > 600000) break;
    }
    await p.screenshot({ path: path.join(OUT, '3-big-before-kill.png') });
    ok(killedAt > 0, `big file reached 40% (${Math.round(killedAt / 1048576)} MB of ${Math.round(size / 1048576)} MB)`);
    ok(seen.some(t => /\d+% · /.test(t)), 'chip showed a percentage', seen.slice(-3));
    await stopFixture('SIGKILL');
    await sleep(6000);
    const cw = await chip(p, wid);
    await p.screenshot({ path: path.join(OUT, '3-big-wizard-down.png') });
    ok(cw && cw.up && /Reconnecting/.test(cw.text), 'chip says Reconnecting while the Wizard is down', cw);
    ok(!(await sendDisabled(p, wid)), 'Send stays live while the Wizard is down');
    await startFixture([`--throttle=${THROTTLE}`]);
    const sAfter = await get('/__fixture/state');
    const resumedFrom = sAfter.uploads.find(x => x.filename === path.basename(BIG))?.offset ?? -1;
    ok(resumedFrom >= killedAt * 0.9 && resumedFrom > 0, `server kept ${Math.round(resumedFrom / 1048576)} MB across the restart`);
    await p.waitForFunction(id => { const el = document.querySelector(`.win[data-win="${id}"] .ch-att`); return el && !el.classList.contains('up'); }, wid, { timeout: 900000 }).catch(() => {});
    const done = await get('/__fixture/state');
    const u = done.uploads.find(x => x.filename === path.basename(BIG));
    ok(u && u.status === 'complete' && u.bytes === size, 'big upload completed after the restart', u);
    ok(u && u.conflicts <= 3, 'resumed from the server offset (few/no offset conflicts)', u && u.conflicts);
    const stored = path.join(DATA, 'fx', 'files', u?.file || 'x');
    const [a, bsha] = await Promise.all([sha(BIG), fs.existsSync(stored) ? sha(stored) : '']);
    ok(a === bsha, 'stored bytes match the source (sha256)', `${a} vs ${bsha}`);
    await p.screenshot({ path: path.join(OUT, '3-big-complete.png') });
    await typeAndSend(p, wid, 'QA big resumable');
    const { run } = await waitRun('QA big resumable');
    ok(run && run.file_ids.includes(u?.file), 'big file sent in the chat', run);
    ok(!errs.length, 'no page errors (big)', errs.join(' | '));
    console.log(`big: ${Math.round(size / 1048576)} MB in ${Math.round((Date.now() - t0) / 1000)} s (incl. restart)`);
    await ctx.close();
    await stopFixture('SIGTERM');
  } else console.log('SKIP big-file phase (set QA_BIG)');

  // 3b. A full Wizard (box cap / reserve) refuses with 507: the user sees plain words, nothing is attached or sent.
  fs.rmSync(path.join(DATA, 'fx'), { recursive: true, force: true });
  await startFixture(['--max=1048576']);
  {
    const { ctx, p, errs, wid } = await boot(b);
    const toasts = [];
    await p.exposeFunction('__qaToast', t => toasts.push(t));
    await p.evaluate(() => new MutationObserver(() => { const t = document.body.innerText; if (/space on your Wizard/.test(t)) window.__qaToast(t.match(/[^\n]*space on your Wizard[^\n]*/)[0]); }).observe(document.body, { subtree: true, childList: true, characterData: true }));
    await attach(p, wid, small);
    await p.waitForFunction(id => !document.querySelector(`.win[data-win="${id}"] .ch-att`), wid, { timeout: 20000 }).catch(() => {});
    await sleep(300);
    ok(toasts.some(t => /Not enough space on your Wizard/.test(t)), '507 → “Not enough space on your Wizard” shown', toasts);
    ok(!(await chip(p, wid)), '507 → nothing left attached');
    const st = await get('/__fixture/state');
    ok(!st.uploads.length && !st.runs.some(r => (r.file_ids || []).length), '507 → no upload record and nothing sent', { uploads: st.uploads.length });
    ok(!errs.length, 'no page errors (full Wizard)', errs.join(' | '));
    await ctx.close();
  }
  await stopFixture('SIGTERM');

  // 4. A box without resumable uploads keeps the old route.
  fs.rmSync(path.join(DATA, 'fx'), { recursive: true, force: true });
  await startFixture(['--resumable=0']);
  {
    const { ctx, p, errs, wid } = await boot(b);
    ok(await p.evaluate(() => !window.WizUploads?.supported()), 'no capability → resumable off');
    await attach(p, wid, small);
    await p.waitForFunction(id => { const el = document.querySelector(`.win[data-win="${id}"] .ch-att`); return el && !el.classList.contains('up'); }, wid, { timeout: 20000 }).catch(() => {});
    const st = await get('/__fixture/state');
    ok(st.oldUploads === 1 && !st.uploads.length, 'fallback: old POST /wizard/files/upload used', { old: st.oldUploads, up: st.uploads.length });
    ok(!errs.length, 'no page errors (fallback)', errs.join(' | '));
    await ctx.close();
  }
  await stopFixture('SIGTERM');
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async e => { console.error(e); await stopFixture(); process.exit(2); });
