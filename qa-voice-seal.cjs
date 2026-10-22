// QA: text + photos + voice go as ONE message (legacy Wizard H4, composeVoiceTurnText). James (10 Oct 2026):
// "when I paste a link in the text box and I send you a voice note and send them together, they're not being sent
// together. They should both be sent together. The images and the text and the voice note should all be sent
// together." Repro in the run queue: a voice note went in at 13:23:40, the pasted link 21 s later as its own message.
// Usage: QA_WEB_DIR=<repo> node qa-voice-seal.cjs [url]. Real Wizard reads; every write is intercepted.
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2] || 'http://127.0.0.1:8923/wizard-os-home/';
const W = process.env.QA_WEB_DIR || '';
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LINK = 'https://hermes-agent.nousresearch.com/docs/reference/automation-blueprints-catalog';
const SAID = 'Which of these blueprints should we bake into Wizard OS';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function boot(b, desktop = false) {
  const ctx = await b.newContext(desktop ? { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', ignoreHTTPSErrors: true, permissions: ['microphone'] }
    : { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = []; const R = { sttDelay: 0, words: SAID, up: 0 }; const uploads = new Map();
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = require('path').join(W, 'web', f);
      if (require('fs').existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: require('fs').readFileSync(p) });
    }
    if (/\/transcribe$/.test(u) && q.method() === 'POST') { await sleep(R.sttDelay); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: R.words, ms: 5 }) }).catch(() => {}); }
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) { writes.push({ u: '/route', body: q.postData() || '' }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cmd: { route: 'agent' }, ms: 5 }) }); }
    // Images use the resumable upload API; voice below still uses the legacy endpoint.
    const uploadPath = new URL(u).pathname.match(/^\/wizard\/v1\/uploads(?:\/([^/]+)(\/complete)?)?$/);
    if(uploadPath){
      const json=(o)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
      if(!uploadPath[1] && q.method()==='POST') { const meta=q.postDataJSON(), id='qa-image-'+(++R.up);uploads.set(id,{...meta,id:'drop_qaimg'+R.up,offset:0});return json({upload_id:id,offset:0,chunk_bytes:65536,status:'uploading'}); }
      const meta=uploads.get(uploadPath[1]);
      if(meta && q.method()==='PATCH'){meta.offset=meta.bytes;return r.fulfill({status:204,headers:{'Upload-Offset':String(meta.offset)}});}
      if(meta && uploadPath[2])return json({file:meta});
      if(meta)return json({...meta,status:'uploading'});
      return json({error:'qa unknown upload'});
    }
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https?:\/\/[^/]+/, ''), body: q.postData() || '', h: q.headers() });
      if (/\/files\/upload$/.test(u)) {
        const mime = q.headers()['x-wizard-mime'] || '', name = q.headers()['x-wizard-filename'] || 'f';
        const id = /^audio\//.test(mime) ? `drop_qavoice${++R.up}` : `drop_qaimg${++R.up}`;
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file: { id, filename: name, mime, bytes: 70 } }) });
      }
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { id: 'qa-fake-session' } }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    }
    if (!['GET','HEAD'].includes(q.method())) return r.fulfill({status:403,contentType:'application/json',body:'{"error":"QA refuses every other write"}'});
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { const st = String(e.stack || ''); if (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st)) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  // Readiness is the shell API below, not third-party iframe load completion.
  await p.goto(URL_ + (desktop ? 'desktop.html?shell=desktop' : '?shell=phone'), { waitUntil: 'commit' });
  if (desktop) { await p.waitForFunction(() => window.__wux && window.__wux.live?.sessions?.length > 2, null, { timeout: 30000 }); await p.waitForTimeout(800); return { ctx, p, writes, errs, R }; }
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.__wos.live.sessions.length > 2, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
  return { ctx, p, writes, errs, R };
}
const chatsWin = p => p.evaluate(() => __wos.desks[1].wins.find(id => __wos.wins[id].app === 'chats'));
const runsOf = ws => ws.filter(w => /\/v1\/runs$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
const steersOf = ws => ws.filter(w => /\/v1\/runs\/[^/]+\/steer$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
const sends = ws => [...runsOf(ws), ...steersOf(ws)];
const routes = ws => ws.filter(w => w.u === '/route');
const pickThread = p => p.evaluate(() => __wos.live.sessions.filter(s => !s.archived)[0].id);
const draftOf = (p, sid) => p.evaluate(k => JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}')[k] || null, 'direct:' + sid);
const sealedKeys = p => p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}')).filter(k => k.startsWith('sealed:')));
const compose = wid => `[data-chats="${wid}"] .ch-compose`;
// Focused-field tap is now dictation (qa-in-app-dictation.cjs). This suite explicitly tests AGENT voice.
async function tapOrb(p) {
  const starting = await p.evaluate(() => { if (__wos.voice === 'idle') {document.activeElement?.blur();return true;}return false; });
  const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2);
  if(starting)await p.waitForFunction(()=>__wos.voice==='listen',null,{timeout:20000});
}
async function openIdle(p, wid, X) {
  await p.evaluate(([w, x]) => { __wos.openChat(w, x); const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, [wid, X]);
  await p.waitForTimeout(700);
}
// Paste the link into the composer, as James did (typed into the textarea, firing input like a paste).
async function pasteLink(p, wid, text = LINK) {
  const ta = p.locator(`${compose(wid)} textarea`);
  await ta.click(); await ta.fill(text); await p.waitForTimeout(200);
}
async function attachShots(p, wid, n = 2) {
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(`${compose(wid)} [data-chattach]`)]);
  await fc.setFiles(Array.from({ length: n }, (_, i) => ({ name: `Screenshot_seal_${i + 1}.png`, mimeType: 'image/png', buffer: PNG })));
  await p.waitForFunction(w => { const c = __wos.chats.ch(w); return (c.files || []).length >= 1 && (c.files || []).every(f => f.id && !f.uploading); }, wid, { timeout: 8000 }).catch(() => {});
  return p.evaluate(w => (__wos.chats.ch(w).files || []).map(f => f.id), wid);
}
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(200); } return null; };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  // 1. James's repro: paste a link in the thread's composer, tap the orb, talk, tap to send. ONE message.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p), X = await pickThread(p);
    await openIdle(p, wid, X);
    await pasteLink(p, wid);
    writes.length = 0;
    await tapOrb(p); await p.waitForTimeout(1500); await tapOrb(p);
    const sent = await until(() => sends(writes).length ? sends(writes) : null);
    await sleep(1500);
    const all = sends(writes);
    ok(all.length === 1, 'orb: exactly one message goes out (not a voice note, then the link)', all.map(r => (r.input || '').slice(0, 60)));
    const m = all[0] || {};
    ok((m.input || '').includes(LINK) && (m.input || '').includes(SAID), 'orb: the one message holds the pasted link AND the spoken words', (m.input || '').slice(0, 200));
    ok((m.input || '').indexOf(LINK) < (m.input || '').indexOf(SAID), 'orb: the link comes first, then what was said (legacy order)');
    ok(m.session_id === X, 'orb: it lands in the thread it was sent from', { sid: m.session_id, X });
    ok(routes(writes).length === 0, 'orb: words in the composer mean "this goes with it": no command routing', routes(writes).length);
    const d = await draftOf(p, X);
    ok(!d, 'orb: the composer is empty afterwards: no leftover draft holding the link', d);
    ok((await sealedKeys(p)).length === 0, 'orb: the hidden hand-off slot is cleared once the outbox has it', await sealedKeys(p));
    await p.evaluate(([w, x]) => __wos.openChat(w, x), [wid, X]); await p.waitForTimeout(500);
    ok(await p.evaluate(w => document.querySelector(`[data-chats="${w}"] .ch-compose textarea`)?.value || '', wid) === '', 'orb: reopening the thread shows an empty composer');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/seal-orb-after.png` });
    ok(errs.length === 0, 'no page errors (1)', errs.join(' | '));
    await ctx.close();
  }
  // 2. Text + two photos + voice from the orb: one message with the link, the words and both photos.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p), X = await pickThread(p);
    await openIdle(p, wid, X);
    const ids = await attachShots(p, wid, 2);
    await pasteLink(p, wid);
    ok(ids.length === 2, 'photos: two screenshots attached in the composer', ids);
    writes.length = 0;
    await tapOrb(p); await p.waitForTimeout(1500); await tapOrb(p);
    await until(() => sends(writes).length ? 1 : null); await sleep(1500);
    const all = sends(writes), m = all[0] || {};
    ok(all.length === 1, 'photos: exactly one message', all.length);
    ok((m.input || '').includes(LINK) && (m.input || '').includes(SAID), 'photos: the link and the spoken words are in it', (m.input || '').slice(0, 200));
    ok(ids.length && ids.every(id => (m.wizard_file_ids || []).includes(id)), 'photos: both photos ride with it', { sent: m.wizard_file_ids, ids });
    const d = await draftOf(p, X);
    ok(!d, 'photos: no leftover draft (text or photos)', d);
    ok(errs.length === 0, 'no page errors (2)', errs.join(' | '));
    await ctx.close();
  }
  // 3. Composer mic (voice reply in this thread): link + photo + recording → one message, voice note attached.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p), X = await pickThread(p);
    await openIdle(p, wid, X);
    const ids = await attachShots(p, wid, 1);
    writes.length = 0;
    // With words in the composer the mic gives way to Send; Send while not recording is a typed send. Start the
    // voice reply through the mic hook (what the mic button calls), then press the composer's Send arrow: it must
    // finish the take and send everything together (legacy: "tapping the text Send arrow while recording also
    // finishes the voice").
    // With words in the composer, Send shows instead of the mic, so start the voice reply first (empty composer),
    // then paste the link while it records, as James might.
    await p.evaluate(w => { const ta = document.querySelector(`[data-chats="${w}"] .ch-compose textarea`); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }, wid);
    await p.click(`${compose(wid)} [data-chmic]`);
    await until(() => p.evaluate(() => __wos.voice === 'listen'), 4000);
    await pasteLink(p, wid);
    await until(() => p.evaluate(() => __wos.voice === 'listen'), 4000); await sleep(1500);
    ok(await p.evaluate(() => __wos.voice) === 'listen', 'mic: a voice reply is recording with the link and a photo in the composer');
    await p.evaluate(w => { const f = document.querySelector(`[data-chats="${w}"] .ch-compose`); f.requestSubmit(); }, wid);
    const vr = await until(() => { const r = sends(writes).find(x => (x.input || '').includes(SAID)); return r || null; });
    await sleep(1500);
    const all = sends(writes);
    ok(all.length === 1, 'mic + Send arrow: exactly one message (Send finished the voice take; no separate text message)', all.map(r => (r.input || '').slice(0, 60)));
    ok(vr && (vr.input || '').startsWith(LINK) && (vr.input || '').includes(SAID), 'mic: link first, then the transcript, in one message', (vr?.input || '').slice(0, 200));
    ok(vr && ids.every(id => (vr.wizard_file_ids || []).includes(id)), 'mic: the photo rides with it', vr?.wizard_file_ids);
    ok(vr && (vr.wizard_file_ids || []).some(id => /^drop_qavoice/.test(id)), 'mic: the recording rides with it as a voice note', vr?.wizard_file_ids);
    ok(vr && vr.session_id === X, 'mic: into this thread', vr?.session_id);
    ok(!(await draftOf(p, X)), 'mic: no leftover draft', await draftOf(p, X));
    ok(errs.length === 0, 'no page errors (3)', errs.join(' | '));
    await ctx.close();
  }
  // 4. Offline at the tap: the recording and the link wait together in the outbox and arrive as one message.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p), X = await pickThread(p);
    await openIdle(p, wid, X);
    await pasteLink(p, wid);
    await tapOrb(p); await p.waitForTimeout(1500);
    await ctx.setOffline(true); writes.length = 0;
    await tapOrb(p);
    await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(800);
    const ob = await p.evaluate(() => [...window.WosOutbox._items.values()].map(it => ({ sid: it.sessionId, typed: it.typed || '', text: it.text || '', audio: !!(it.audio || it.audioFile) })));
    ok(ob.length === 1 && ob[0].audio && (ob[0].typed.includes('automation-blueprints') || ob[0].text.includes('automation-blueprints')), 'offline: one outbox item holds the recording and the link', ob);
    ok(!(await draftOf(p, X)), 'offline: the link is not left behind as a draft', await draftOf(p, X));
    await ctx.setOffline(false);
    await p.waitForFunction(() => window.WosOutbox.unsent().length === 0, null, { timeout: 20000 }).catch(() => {});
    await sleep(800);
    const all = sends(writes), m = all[0] || {};
    ok(all.length === 1 && (m.input || '').startsWith(LINK) && (m.input || '').includes(SAID), 'back online: one message, link then transcript', all.map(r => (r.input || '').slice(0, 120)));
    ok((m.wizard_file_ids || []).some(id => /^drop_qavoice/.test(id)), 'back online: the voice note rides with it', m.wizard_file_ids);
    ok(errs.length === 0, 'no page errors (4)', errs.join(' | '));
    await ctx.close();
  }
  // 5. Nothing heard: nothing is sent and the link goes back into the composer.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const wid = await chatsWin(p), X = await pickThread(p);
    await openIdle(p, wid, X);
    await pasteLink(p, wid);
    R.words = ''; writes.length = 0;
    await tapOrb(p); await p.waitForTimeout(1500); await tapOrb(p);
    await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(1500);
    ok(sends(writes).length === 0, 'empty take: nothing is sent', sends(writes).length);
    const d = await draftOf(p, X);
    ok(d && d.text.includes(LINK), 'empty take: the pasted link is back in that thread’s composer', d);
    ok((await sealedKeys(p)).length === 0, 'empty take: the hand-off slot is cleared', await sealedKeys(p));
    ok(errs.length === 0, 'no page errors (5)', errs.join(' | '));
    await ctx.close();
  }
  // 6. Cancel mid-take: the link stays in the composer.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p), X = await pickThread(p);
    await openIdle(p, wid, X);
    await pasteLink(p, wid);
    writes.length = 0;
    await tapOrb(p); await p.waitForTimeout(1200);
    await p.click('#arcCancel').catch(() => {}); await p.waitForTimeout(800);
    ok(sends(writes).length === 0, 'cancel: nothing is sent');
    const v = await p.evaluate(w => document.querySelector(`[data-chats="${w}"] .ch-compose textarea`)?.value || '', wid);
    ok(v === LINK, 'cancel: the link is still in the composer', v);
    ok(errs.length === 0, 'no page errors (6)', errs.join(' | '));
    await ctx.close();
  }
  // 7. Unchanged: a plain voice take with an empty composer still sends just the words; a typed send is just the text.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p), X = await pickThread(p);
    await openIdle(p, wid, X);
    writes.length = 0;
    await tapOrb(p); await p.waitForTimeout(1500); await tapOrb(p);
    await until(() => sends(writes).length ? 1 : null); await sleep(1200);
    const m = sends(writes)[0] || {};
    ok(sends(writes).length === 1 && (m.input || '').trim() === SAID, 'plain voice: just the words, as before', (m.input || '').slice(0, 120));
    await openIdle(p, wid, X); writes.length = 0;
    await pasteLink(p, wid, 'typed only');
    await p.evaluate(w => document.querySelector(`[data-chats="${w}"] .ch-compose`).requestSubmit(), wid);
    await until(() => sends(writes).length ? 1 : null); await sleep(800);
    ok(sends(writes).length === 1 && (sends(writes)[0].input || '') === 'typed only', 'typed send: just the text, as before', sends(writes).map(r => r.input));
    ok(errs.length === 0, 'no page errors (7)', errs.join(' | '));
    await ctx.close();
  }
  // 8. Desktop shell: link typed in the open thread's composer + Right ⌘ voice → one message there.
  {
    const { ctx, p, writes, errs } = await boot(b, true);
    const X = await p.evaluate(() => __wux.live.sessions.filter(s => !s.archived)[0].id);
    const wid = await p.evaluate(async x => { __wux.openThread(x); await new Promise(r => setTimeout(r, 900)); const s = __wux.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); return Object.values(__wux.wins).find(w => w.app === 'chats' && w.thread === x)?.id || ''; }, X);
    ok(!!wid, 'desktop: the thread is open in a Chats pane', { wid, X });
    await p.waitForTimeout(400);
    await pasteLink(p, wid);
    writes.length = 0;
    const st = await p.evaluate(() => __wux.talk('toggle'));
    await p.waitForTimeout(1500);
    const sent = await p.evaluate(() => __wux.talk('send'));
    ok(st === 'voice' && sent === 'sent', 'desktop: Right ⌘ talk records and sends', { st, sent });
    await until(() => sends(writes).find(r => (r.input || '').includes(SAID)) || null, 20000); await sleep(1000);
    const all = sends(writes), m = all[0] || {};
    ok(all.length === 1 && (m.input || '').startsWith(LINK) && (m.input || '').includes(SAID), 'desktop: one message, link then transcript', all.map(r => (r.input || '').slice(0, 120)));
    ok(m.session_id === X, 'desktop: into the open thread', m.session_id);
    ok((m.wizard_file_ids || []).some(id => /^drop_qavoice/.test(id)), 'desktop: the voice note rides with it', m.wizard_file_ids);
    ok(await p.evaluate(w => document.querySelector(`[data-chats="${w}"] .ch-compose textarea`)?.value || '', wid) === '', 'desktop: the composer is empty afterwards');
    ok(errs.length === 0, 'no page errors (8)', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
