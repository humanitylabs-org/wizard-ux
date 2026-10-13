// SYNTHETIC QA ONLY: native ABI + STT + models/app API fixtures. No request leaves this browser.
// Thales: QA_WEB_DIR=<exact source tree> QA_EVIDENCE=<json> node qa-in-app-dictation.cjs
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const WEB = process.env.QA_WEB_DIR || __dirname;
const ORIGIN = 'https://private.wizard001.com', HOME = ORIGIN + '/wizard-os-home/';
const checks = [], contexts = [], TEXT = 'spoken words';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ok(value, name, extra) { checks.push({ pass: !!value, name, extra }); console.log(value ? 'PASS' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
const APP = { id: 'qa-iching', name: 'QA I Ching', url: '/qa-iching/', icon: '☯', colors: ['#555', '#888'] };
const HTML = `<!doctype html><meta name="wizard-os-voice" content="capture"><title>Synthetic I Ching</title>
<style>body{background:#151820;color:white;padding:20px;font:18px sans-serif}textarea,input,[contenteditable]{display:block;width:250px;margin:12px 0;min-height:36px;background:#fff;color:#111}button{height:44px}</style>
<textarea id="a">one OLD three</textarea><input id="b" value="second"><div id="ce" contenteditable="true">one <b>OLD</b> three</div><div id="shadow"></div>
<input id="pw" type="password"><input id="num" type="number"><input id="ro" readonly><input id="disabled" disabled><select id="sel"><option>value</option></select><button id="away">Leave field</button>
<script>window.submits=0;window.voicePosts=0;document.addEventListener('submit',e=>{e.preventDefault();submits++});window.addEventListener('message',e=>{if(e.data?.type==='wizard-os:voice')voicePosts++});shadow.attachShadow({mode:'open'}).innerHTML='<input id="sh" value="shadow OLD text">';</script>`;
function nativeFixture() {
  if (window !== window.top) return;
  const get = () => JSON.parse(localStorage.getItem('qa.native') || '{"active":null,"pending":[],"calls":[]}');
  const save = x => localStorage.setItem('qa.native', JSON.stringify(x));
  const act = (name, id) => { const x = get(); x.calls.push([name, id]); save(x); return x; };
  const metadata = t => t ? { ...t, ms: Math.max(1800, Date.now() - t.at), bytes: 4096 } : null;
  window.__qaNativeStore = get;
  window.WizardOSDevice = {
    version: () => 1, updateState: () => '{}',
    recStart(kind) { const x = act('start', kind); if (x.active) return ''; const id = 'qa-native-' + Date.now(); x.active = { id, kind, at: Date.now(), paused: false }; save(x); return id; },
    recActive() { const a = metadata(get().active); if (a && localStorage.getItem('qa.kindless')) delete a.kind; return JSON.stringify(a); },
    recPause(on) { const x = act('pause', on); if (x.active) x.active.paused = on; save(x); },
    recLevel: () => 0,
    recStop(id) { const x = act('stop', id); if (x.active?.id !== id) return 'null'; const t = metadata(x.active); x.pending.push(t); x.active = null; save(x); return JSON.stringify(t); },
    recClaim(id) { act('claim', id); return JSON.stringify(get().pending.find(t => t.id === id) || null); },
    recRead() { return JSON.stringify({ b64: btoa('x'.repeat(4096)), next: -1 }); },
    recDone(id) { const x = act('done', id); x.pending = x.pending.filter(t => t.id !== id); save(x); },
    recCancel(id) { const x = act('cancel', id); if (x.active?.id === id) x.active = null; save(x); },
    recPending: () => JSON.stringify(get().pending),
    clip: text => { window.__qaClip = text; },
  };
}
async function boot(browser, native = true) {
  const context = await browser.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, permissions: ['microphone'], serviceWorkers: 'block' });
  const writes = [], requests = [], errors = [], served = [];
  const R = { words: TEXT, delay: 0, down: false };
  const json = (r, data, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
  const threads = Array.from({ length: 6 }, (_, i) => ({ id: 'qa-' + i, title: 'Synthetic thread ' + i, model: 'qa-model', provider: 'qa-provider', status: 'completed', source: 'api_server', message_count: 2, last_active: Date.now() / 1000 - i * 60 }));
  await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method(); requests.push([m, u.pathname]);
    if (u.origin !== ORIGIN) return r.abort();
    const asset = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (asset && m === 'GET' && !asset[1].startsWith('api/')) {
      const file = asset[1] || 'index.html', p = path.join(WEB, 'web', file);
      if (!fs.existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      served.push(p); return r.fulfill({ status: 200, contentType: ({ '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (u.pathname.startsWith('/qa-iching')) return r.fulfill({ status: 200, contentType: 'text/html', body: HTML });
    if (m !== 'GET' && m !== 'HEAD') {
      writes.push({ path: u.pathname, body: q.postData()?.slice(0, 500) });
      if (/\/transcribe$/.test(u.pathname)) { await sleep(R.delay); return json(r, R.down ? { error: 'synthetic STT outage' } : { text: R.words, ms: 5 }, R.down ? 503 : 200); }
      if (/\/route$/.test(u.pathname)) return json(r, { cmd: { route: 'agent' }, ms: 5 });
      if (/\/thread-seen$/.test(u.pathname)) return json(r, { state: { initializedAt: Date.now(), threads: {} } });
      if (/\/files\/upload$/.test(u.pathname)) return json(r, { file: { id: 'drop_qa_dictation', mime: 'audio/aac', filename: 'voice.aac', bytes: 4096 } });
      if (/\/v1\/runs$/.test(u.pathname)) return json(r, { run_id: 'qa-run', status: 'queued' }, 202);
      return json(r, { accepted: true });
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, settings: { agent: { name: 'QA Agent' }, owner: { name: 'QA Owner' } }, capabilities: { voice: true, router: true, files: true }, endpoints: { transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: [APP] });
    if (u.pathname === '/wizard/hermes/api/model/options') return json(r, { model: 'qa-model', provider: 'qa-provider', providers: [{ slug: 'qa-provider', name: 'Synthetic QA provider', authenticated: true, is_current: true, models: ['qa-model'] }] });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: threads, has_more: false });
    if (/\/messages$/.test(u.pathname)) return json(r, { data: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hello' }], has_more: false });
    const t = u.pathname.match(/\/api\/sessions\/(qa-\d)$/); if (t) return json(r, { session: threads.find(x => x.id === t[1]) });
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: Date.now(), threads: {} } });
    return json(r, {});
  });
  await context.addInitScript(() => { if (window !== window.top) return; localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
  if (native) await context.addInitScript(nativeFixture);
  const p = await context.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.goto(HOME); await p.waitForFunction(() => window.__wos?.live?.ok);
  await p.evaluate(async () => { await WizCore.appsLoaded(); window.__qaApp = WizCore.apps('mobile').APP['qa-iching']; });
  await p.waitForTimeout(300);
  const fixture = { context, p, writes, requests, errors, served, R, native }; contexts.push(fixture); return fixture;
}
async function app(f) {
  const { p } = f;
  await p.evaluate(a => { __wos.cancelVoice(true); __wos.closeSheets(true); __wos.goDesk(0, true); __wos.openApp(window.__qaApp); }, APP);
  await p.waitForTimeout(450);
  const frame = p.frames().find(x => x.url().startsWith(ORIGIN + '/qa-iching/'));
  if (!frame) throw new Error('registered synthetic app not mounted');
  return frame;
}
async function select(frame, id = 'a', start = 4, end = 7) { await frame.locator('#' + id).click(); await frame.evaluate(([id, a, b]) => { const el = document.getElementById(id); el.focus(); el.setSelectionRange(a, b); }, [id, start, end]); await sleep(70); }
async function tap(p) { const b = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
async function take(f, action) {
  await tap(f.p); await f.p.evaluate(() => { window.__qaSeal = __wos.V.field; }); await sleep(f.native ? 700 : 1400);
  await tap(f.p); if (action) await action();
  await f.p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 7000 }).catch(() => {}); await sleep(150);
}
const noAgent = f => f.writes.filter(w => /\/hermes\/(?:v1\/runs|api\/sessions)|\/files\/upload|\/route$/.test(w.path));
const state = p => p.evaluate(() => ({ voice: __wos.voice, kind: __wos.V.kind, mode: Orb.mode, full: __wos.desks[__wos.idx].full, focused: __wos.desks[__wos.idx].focus, tx: document.querySelector('#txText').textContent, copies: document.querySelectorAll('[data-dictation-copy]').length }));
async function cases(browser) {
  const f = await boot(browser), p = f.p;
  let frame = await app(f); await select(frame);
  ok((await state(p)).mode === 'type', 'focused app textarea turns existing orb blue');
  if (process.env.QA_EVIDENCE) { await sleep(600); await p.screenshot({ path: process.env.QA_EVIDENCE.replace('.json', '-focused.png') }); }
  f.writes.length = 0; await tap(p); await sleep(150);
  ok((await state(p)).kind === 'dictation' && (await state(p)).mode === 'typing', 'real orb tap starts native dictation with blue listening mode', await state(p));
  await sleep(600); await tap(p); await sleep(450);
  ok(await frame.locator('#a').inputValue() === 'one spoken words three', 'STT replaces selection sealed at START');
  ok(noAgent(f).length === 0, 'dictation makes ZERO router/upload/run/session writes', noAgent(f));
  ok(await frame.evaluate(() => submits === 0 && voicePosts === 0), 'no app submit / capture-mode postMessage');
  await frame.locator('#a').fill('editable afterwards'); ok(await frame.locator('#a').inputValue() === 'editable afterwards', 'inserted text remains editable');
  await frame.locator('#away').click(); await sleep(100); ok((await state(p)).mode === 'idle', 'leaving field restores normal orb');
  await p.evaluate(() => { const d = __wos.desks[__wos.idx]; __wos.setFull(d.focus, true); }); await sleep(450);
  const hidden = await p.locator('#dock').evaluate(e => +getComputedStyle(e).opacity < .1); ok(hidden, 'full-screen reading still hides orb');
  await select(frame, 'b', 0, 6); await sleep(400);
  ok(await p.locator('#orbWrap').evaluate(e => { const b = e.getBoundingClientRect(); return b.width >= 44 && b.y < innerHeight && e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }), 'full-screen focused app has usable hit-tested corner orb');
  await p.setViewportSize({ width: 412, height: 540 }); await sleep(300);
  ok(await p.locator('#orbWrap').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight), 'keyboard-sized viewport keeps orb on screen');
  if (process.env.QA_EVIDENCE) await p.screenshot({ path: process.env.QA_EVIDENCE.replace('.json', '-keyboard.png') });
  await take(f); ok(await frame.locator('#b').inputValue() === TEXT, 'full-screen input dictation replaces selected text');
  await p.setViewportSize({ width: 412, height: 892 });
  await frame.locator('#away').click(); await p.evaluate(() => __wos.onBack()); await sleep(300);
  ok(p.url().startsWith(HOME) && !(await state(p)).full, 'app Back leaves fullscreen, never exits shell');
  frame = await app(f);
  await frame.locator('#ce').click(); await frame.evaluate(() => { const r = document.createRange(); r.selectNodeContents(ce.querySelector('b')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await take(f); ok(await frame.locator('#ce').textContent() === 'one spoken words three', 'contenteditable inserts sealed DOM range without HTML interpretation');
  await frame.locator('#shadow').locator('#sh').click(); await frame.evaluate(() => shadow.shadowRoot.querySelector('input').setSelectionRange(7, 10));
  await take(f); ok(await frame.locator('#shadow').locator('#sh').inputValue() === 'shadow spoken words text', 'open shadow input uses same helper');
  // Long-press still owns command mode even with a focused editable field.
  await frame.goto(ORIGIN + '/qa-iching/'); await sleep(150); await select(frame); f.writes.length = 0;
  const touch = await f.context.newCDPSession(p), box = await p.locator('#orbWrap').boundingBox();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 42 }] }); await sleep(500);
  ok((await state(p)).voice === 'command' && (await state(p)).kind === 'command', 'held real orb retains COMMAND ownership even over focused field');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(800);
  ok(await frame.locator('#a').inputValue() === 'one OLD three' && !f.writes.some(w => /\/hermes\/(?:v1\/runs|api\/sessions)/.test(w.path)), 'release of held non-command never inserts dictation or auto-sends to agent');
  await p.evaluate(() => { __wos.cancelVoice(true); __wos.txHide(0); });
  for (const id of ['pw', 'num', 'ro', 'sel']) { await frame.locator('#' + id).click(); await sleep(80); ok((await state(p)).mode === 'idle', 'excluded control stays normal: ' + id); }
  await frame.evaluate(() => { a.setAttribute('data-no-dictation', ''); a.focus(); }); await sleep(80); ok((await state(p)).mode === 'idle', 'explicit no-dictation opt-out');
  // New app document for each race; held STT proves later edits/navigation do not retarget insertion.
  for (const mutation of ['edit', 'switch', 'remove', 'reload', 'navigate', 'ABA', 'leave-app', 'close-app']) {
    await frame.goto(ORIGIN + '/qa-iching/'); await sleep(150); await select(frame); f.R.delay = 650; f.writes.length = 0;
    await take(f, async () => {
      if (mutation === 'edit') await frame.locator('#a').fill('new edits');
      if (mutation === 'switch') await frame.locator('#b').click();
      if (mutation === 'remove') await frame.evaluate(() => a.remove());
      if (mutation === 'reload') await frame.goto(ORIGIN + '/qa-iching/');
      if (mutation === 'navigate') await frame.evaluate(() => history.pushState({}, '', '?next=1'));
      if (mutation === 'ABA') await frame.evaluate(() => { history.pushState({}, '', '?next=1'); history.replaceState({}, '', '/qa-iching/'); });
      if (mutation === 'leave-app') await p.evaluate(() => __wos.goDesk(0, true));
      if (mutation === 'close-app') await p.evaluate(() => __wos.closeWin(__wos.desks[__wos.idx].focus));
    });
    const s = await state(p), a = mutation === 'close-app' ? null : await frame.locator('#a').count() ? await frame.locator('#a').inputValue() : null;
    if (mutation === 'switch') ok(a === 'one spoken words three' && await frame.locator('#b').inputValue() === 'second', 'field switch inserts only original exact node, not newly focused input', { a, s });
    else ok(a === (mutation === 'edit' ? 'new edits' : ['remove', 'close-app'].includes(mutation) ? null : 'one OLD three') && s.copies === 1, mutation + ': keeps user edits / no insertion into replaced or navigated document; explicit copy offered', { a, s });
    ok(noAgent(f).length === 0, mutation + ': ZERO agent fallback', noAgent(f));
    f.R.delay = 0; await p.evaluate(() => __wos.txHide(0));
    if (['leave-app', 'close-app'].includes(mutation)) frame = await app(f);
  }
  // Empty/outage, cancellation of a delayed STT, and operation-fenced newer take.
  await frame.goto(ORIGIN + '/qa-iching/'); await sleep(150); await select(frame); f.R.words = ''; await take(f);
  ok(await frame.locator('#a').inputValue() === 'one OLD three', 'empty speech changes nothing'); f.R.words = TEXT;
  await select(frame); f.R.down = true; f.writes.length = 0; await take(f); f.R.down = false;
  ok(await frame.locator('#a').inputValue() === 'one OLD three' && await p.evaluate(() => WosCancelled.list().length > 0), 'STT outage retains audio for Settings transcribe & copy');
  ok(noAgent(f).length === 0, 'STT outage NEVER queues agent send');
  await select(frame); f.R.delay = 800; await tap(p); await sleep(700); await tap(p); await sleep(80); await p.evaluate(() => __wos.cancelVoice(true));
  await select(frame, 'b', 0, 6); await tap(p); await sleep(900);
  ok((await state(p)).voice === 'listen' && await frame.locator('#a').inputValue() === 'one OLD three', 'late canceled STT neither inserts nor cleans up newer recording');
  await p.evaluate(() => __wos.cancelVoice(true)); f.R.delay = 0;
  // Native reload with ABI omitting kind uses durable negative send provenance, with no reconstructed target.
  await select(frame); await tap(p); await sleep(600); await p.evaluate(() => localStorage.setItem('qa.kindless', 'true'));
  await p.reload(); await p.waitForFunction(() => window.__wos?.live?.ok); await sleep(500);
  ok((await state(p)).kind === 'dictation', 'kind-less native recovery preserves dictation provenance');
  f.writes.length = 0; await tap(p); await sleep(800);
  ok((await state(p)).copies === 1 && noAgent(f).length === 0, 'recreated native take becomes explicit retained copy, NEVER agent auto', await state(p));
  // Notification marked send after page disappearance must wait for an explicit Transcribe & copy action.
  await p.evaluate(() => { localStorage.removeItem('qa.kindless'); const x = __qaNativeStore(); x.active = null; x.pending.push({ id: 'qa-pending', kind: 'dictation', at: Date.now(), ms: 1800, bytes: 4096, send: true }); localStorage.setItem('qa.native', JSON.stringify(x)); });
  f.writes.length = 0; await p.reload(); await p.waitForFunction(() => window.__wos?.live?.ok); await sleep(500);
  ok(await p.locator('[data-take="qa-pending"]').count() === 1 && f.writes.filter(w => /transcribe$/.test(w.path)).length === 0, 'native pending notification-send dictation waits for explicit recovery, never automatic STT/send');
  if (await p.locator('[data-take="qa-pending"] [data-takeact="send"]').count()) await p.locator('[data-take="qa-pending"] [data-takeact="send"]').click();
  await sleep(800);
  ok((await state(p)).copies === 1 && noAgent(f).length === 0, 'explicit pending recovery transcribes & copies only');
  await p.evaluate(() => { __wos.txHide(0); __wos.goDesk(0, true); __wos.onBack(); }); await sleep(150);
  ok(p.url().startsWith(HOME), 'first root Back keeps Wizard open');
  // Top-level shell fields share the same seal, including chat composer. MIC remains reply/send.
  await p.evaluate(() => { __wos.closeSheets(true); const el = document.createElement('textarea'); el.id = 'qa-shell-field'; el.value = 'one OLD three'; el.style.cssText = 'position:fixed;top:150px;left:30px;z-index:100'; document.body.append(el); });
  await select(p, 'qa-shell-field'); f.writes.length = 0; await take(f);
  ok(await p.locator('#qa-shell-field').inputValue() === 'one spoken words three' && noAgent(f).length === 0, 'ordinary shell textarea uses same focused-field seal and insertion-only pipeline');
  await p.evaluate(() => { document.getElementById('qa-shell-field').remove(); const i = __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')); __wos.goDesk(i, true); const id = __wos.desks[i].wins.find(id => __wos.wins[id].app === 'chats'); __wos.openChat(id, 'qa-0'); });
  await sleep(500); const composer = p.locator('.win .ch-compose textarea:visible').first();
  await composer.fill('one OLD three'); await composer.evaluate(el => el.setSelectionRange(4, 7));
  const composerNode = await composer.elementHandle(); f.writes.length = 0; await take(f);
  const composerValue = await composerNode.evaluate(el => el.value);
  ok(composerValue === 'one spoken words three' && noAgent(f).length === 0, 'chat composer orb tap dictates without sealing/consuming/sending draft', { value: composerValue, state: await state(p), active: await p.evaluate(() => document.activeElement.outerHTML.slice(0, 300)), seal: await p.evaluate(() => { const s=window.__qaSeal; return s && { changed:s.changed, connected:s.el.isConnected, value:s.value, actual:s.el.value, frame:s.frame?.src, href:s.href, current:s.doc.location.href, win:s.el.closest('.win')?.dataset.win, version:s.version, same:s.el===document.activeElement, start:s.start, end:s.end }; }) });
  const reply = await boot(browser); const rp = reply.p;
  await rp.evaluate(() => { const i = __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')); __wos.goDesk(i, true); const id = __wos.desks[i].wins.find(id => __wos.wins[id].app === 'chats'); __wos.openChat(id, 'qa-0'); }); await sleep(400);
  const comp = rp.locator('.win .ch-compose textarea:visible').first(); await comp.fill(''); await comp.click();
  await rp.locator('.win [data-chmic]:visible').first().click(); await sleep(750);
  ok((await state(rp)).kind === 'auto' && await rp.evaluate(() => __wos.V.replyTo?.sid === 'qa-0'), 'composer MIC retains sealed voice-reply behavior despite focused field');
  await tap(rp); await sleep(1000); ok(reply.writes.some(w => /\/hermes\/(?:v1\/runs|api\/sessions)/.test(w.path)), 'composer MIC sends voice reply through unchanged agent pipeline (synthetic accepted write)');
  // Real in-page MediaRecorder path, using Chromium's synthetic microphone, not native bytes.
  const web = await boot(browser, false), wf = await app(web); await select(wf); web.writes.length = 0; await take(web);
  ok(await wf.locator('#a').inputValue() === 'one spoken words three' && noAgent(web).length === 0, 'browser MediaRecorder shares focused-field dictation, ZERO agent writes');
  // Delayed permission, pause and cancellation keep the insertion-only kind and fence old streams.
  await wf.goto(ORIGIN + '/qa-iching/'); await sleep(150); await select(wf);
  await web.p.evaluate(() => { const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__qaGum = orig; navigator.mediaDevices.getUserMedia = async opts => { const s = await orig(opts); await new Promise(r => setTimeout(r, 800)); window.__qaLateStream = s; return s; }; });
  web.writes.length = 0; await tap(web.p); await sleep(100); await web.p.evaluate(() => __wos.cancelVoice(true)); await sleep(950);
  ok(await web.p.evaluate(() => __qaLateStream?.getTracks().every(t => t.readyState === 'ended')) && await wf.locator('#a').inputValue() === 'one OLD three' && web.writes.length === 0, 'cancel while permission pending stops only stale stream, no STT/insertion/send');
  await web.p.evaluate(() => navigator.mediaDevices.getUserMedia = window.__qaGum); await select(wf); await tap(web.p); await sleep(800);
  await web.p.locator('#arcPause').click(); await sleep(150);
  ok((await state(web.p)).voice === 'paused' && web.writes.length === 0, 'pause keeps dictation without auto transcription/send');
  await tap(web.p); await sleep(500); ok(await wf.locator('#a').inputValue() === 'one spoken words three' && noAgent(web).length === 0, 'paused take can be explicitly transcribed into sealed field');
  await select(wf); await tap(web.p); await sleep(500); web.writes.length = 0; await web.p.evaluate(() => __wos.cancelVoice(true)); await sleep(200);
  ok((await state(web.p)).voice === 'idle' && web.writes.length === 0, 'X cancels active browser dictation with no transcription/send');
  // Shared-app mic ownership excludes orb dictation before either recorder starts.
  await select(wf); await web.p.evaluate(async () => { window.__qaOtherCapture = await WizAppCapture.start('qa-other-app', { kind: 'qa-other-app' }); });
  await tap(web.p); await sleep(250); ok((await state(web.p)).voice === 'idle', 'shared app recording ownership blocks dictation');
  await web.p.evaluate(() => window.__qaOtherCapture.cancel());
  // The helper never adopts arbitrary same-origin frames outside the registered app windows.
  await web.p.evaluate(() => { const f = document.createElement('iframe'); f.id = 'qa-unregistered'; f.src = '/qa-iching/'; f.style.cssText = 'position:fixed;top:60px;left:15px;width:350px;height:300px;z-index:100'; document.body.append(f); });
  await sleep(200); const outsider = web.p.frames().find(f => f.frameElement && f.url().startsWith(ORIGIN + '/qa-iching/') && f !== wf);
  await select(outsider); ok((await state(web.p)).mode === 'idle', 'unregistered same-origin iframe cannot claim focused-field dictation');
  await web.p.evaluate(() => document.getElementById('qa-unregistered').remove());
  // Desktop's existing dictation event reuses insertion helpers only; no key/recording UX changes.
  const desktop = await boot(browser, false), dp = desktop.p;
  await dp.setViewportSize({ width: 1440, height: 900 });
  await dp.goto(HOME + 'desktop.html?shell=desktop'); await dp.waitForFunction(() => window.__wux?.live?.ok); await sleep(400);
  await dp.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['qa-iching'])); await sleep(350);
  const df = dp.frames().find(f => f.url().startsWith(ORIGIN + '/qa-iching/')); await select(df);
  desktop.writes.length = 0; await dp.evaluate(text => dispatchEvent(new CustomEvent('wizard:dictation', { detail: { text } })), TEXT);
  ok(await df.locator('#a').inputValue() === 'one spoken words three' && noAgent(desktop).length === 0, 'desktop bridge shares exact app field insertion without agent writes');
  await df.locator('#pw').fill('secret'); await dp.evaluate(() => dispatchEvent(new CustomEvent('wizard:dictation', { detail: { text: 'DO NOT INSERT' } })));
  ok(await df.locator('#pw').inputValue() === 'secret', 'shared desktop helper also excludes password fields');
  for (const c of contexts) ok(c.errors.length === 0, 'no page errors (' + (c.native ? 'native' : 'web') + ')', c.errors);
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  let fatal;
  try { await cases(browser); } catch (e) { fatal = String(e.stack || e); ok(false, 'suite completed', fatal); }
  const result = { fixture: 'synthetic native ABI + STT/models/API; all requests intercepted', web: WEB, passed: checks.filter(x => x.pass).length, failed: checks.filter(x => !x.pass).length, checks, contexts: contexts.map(c => ({ native: c.native, errors: c.errors, served: [...new Set(c.served)], writes: c.writes })) };
  if (process.env.QA_EVIDENCE) fs.writeFileSync(process.env.QA_EVIDENCE, JSON.stringify(result, null, 2));
  await browser.close(); console.log(`${result.passed} passed, ${result.failed} failed`); process.exitCode = fatal ? 2 : result.failed ? 1 : 0;
})();
