// Share to Wizard keeps voice typing: orb above the share sheet dictates into the note, sends nothing.
// Thales: QA_WEB_DIR=<exact source tree> QA_EVIDENCE=<json> node qa-in-app-dictation.cjs
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const WEB = process.env.QA_WEB_DIR || __dirname;
const ORIGIN = 'https://wizard.tailc0f369.ts.net', HOME = ORIGIN + '/wizard-os-home/';
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
    recStop(id) { const x = act('stop', id); if (x.active?.id !== id) return 'null'; const t = metadata(x.active); t.claimed = true; x.pending.push(t); x.active = null; save(x); return JSON.stringify(t); },
    recClaim(id) { const x = act('claim', id), t = x.pending.find(t => t.id === id); if (t) { t.claimed = true; save(x); } return JSON.stringify(t || null); },
    recRead(id, off) {
      const failure = localStorage.getItem('qa.read-failure');
      if (failure === 'first' || (failure === 'later' && off)) return 'null';
      if (failure === 'truncated') return JSON.stringify({ b64: btoa('x'.repeat(800)), next: -1 });
      if (failure === 'later') return JSON.stringify({ b64: btoa('x'.repeat(2048)), next: 2048 });
      if (failure === 'loop') return JSON.stringify({ b64: btoa('x'.repeat(4096)), next: 0 });
      return JSON.stringify({ b64: btoa('x'.repeat(4096)), next: -1 });
    },
    recDone(id) { const x = act('done', id); x.pending = x.pending.filter(t => t.id !== id); save(x); },
    recCancel(id) { const x = act('cancel', id); if (x.active?.id === id) x.active = null; save(x); },
    recPending: () => JSON.stringify(get().pending.filter(t => !t.claimed)),
    clip: text => { window.__qaClip = text; },
    shareMeta: id => JSON.stringify({ id, items: [], text: 'Gotye - Somebody That I Used To Know https://youtube.com/watch?v=qa' }),
    shareRead: () => 'null', shareDone(id) { window.__qaShareDone = id; },
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

const orbUsable = p => p.locator('#orbWrap').evaluate(e => { const b = e.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { w: b.width, top: b.top, bottom: b.bottom, vh: innerHeight, hit: !!hit && e.contains(hit), opacity: +getComputedStyle(document.querySelector('#dock')).opacity }; });
const sheetBox = p => p.locator('.dv-sheet').evaluate(e => e.getBoundingClientRect().toJSON());
async function openShare(p) { await p.evaluate(() => { __wos.closeSheets(true); WosDevice.handle({ action: 'share', id: 'qa-share-1' }); }); await sleep(500); }
async function cases(browser) {
  const f = await boot(browser), p = f.p;
  for (const [label, vh, full] of [['windowed', 892, false], ['keyboard-sized', 540, false], ['full-screen desk', 540, true]]) {
    await p.setViewportSize({ width: 412, height: vh });
    await p.evaluate(full => { __wos.cancelVoice(true); __wos.txHide?.(0); const i = __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')); __wos.goDesk(i, true); const d = __wos.desks[i]; __wos.setFull(d.focus || d.wins[0], full); }, full); await sleep(450);
    ok((await state(p)).full === full, label + ': desk full-screen = ' + full, await state(p));
    await openShare(p);
    ok(await p.locator('.dv-wrap[data-dv="share"].open').count() === 1, label + ': share sheet open');
    const note = p.locator('.dv-text');
    await note.click(); await note.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); await sleep(150);
    const u = await orbUsable(p), s = await sheetBox(p);
    ok(u.hit && u.w >= 40 && u.bottom <= u.vh && u.opacity > .5, label + ': orb visible and tappable above the share sheet', u);
    ok(s.bottom <= u.top + 2 || s.right <= (await p.locator('#orbWrap').boundingBox()).x, label + ': sheet clears the orb', { s, u });
    ok((await state(p)).mode === 'type', label + ': focused share note turns the orb blue (dictate mode)', await state(p));
    if (process.env.QA_SHOTS) await p.screenshot({ path: `${process.env.QA_SHOTS}/share-${label.replace(/\W+/g, '-')}.png` });
    f.writes.length = 0; f.R.words = 'add this to my music library';
    await take(f);
    const v = await note.inputValue();
    ok(v.endsWith('?v=qa add this to my music library') && v.startsWith('Gotye'), label + ': orb tap dictates into the share note', v);
    ok(noAgent(f).length === 0 && !f.writes.some(w => /v1\/runs/.test(w.path)), label + ': dictation sends nothing', noAgent(f));
    ok(await p.locator('.dv-wrap[data-dv="share"]').count() === 1, label + ': share sheet still open after dictation');
    await p.evaluate(() => __wos.onBack()); await sleep(100); await p.evaluate(() => __wos.onBack()); await sleep(400);
    ok(!(await p.evaluate(() => document.querySelector('#device').classList.contains('dv-share-open'))), label + ': closing the sheet restores the normal dock');
    ok(p.url().startsWith(HOME), label + ': Back never exits');
  }
  ok(f.errors.length === 0, 'no page errors', f.errors);
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try { await cases(browser); } catch (e) { ok(false, 'suite crashed', String(e.stack || e)); }
  finally { await browser.close(); }
  const fail = checks.filter(c => !c.pass).length;
  console.log(`${checks.length - fail}/${checks.length} passed`);
  process.exit(fail ? 1 : 0);
})();
