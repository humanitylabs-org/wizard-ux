// QA: two images picked on the orb, sent while the second is still uploading, both arrive (James, 27 Oct 2026: "I click
// two images and I guess the second one didn't finish uploading yet. I hit send, it only sent the first image").
// Each picked file must join the take at once, not only after the one before it finished uploading.
// Runs the same take in a main thread and in a routed (host-profile) agent thread, because routed delivery carries
// `agent` and takes its own outbox path.
// Self-contained: synthetic threads only, every request is fixtured; no real Wizard session is read or written.
// Usage: QA_WEB_DIR=<repo> node qa-orb-send-two-images.cjs   (WIZARD_ORIGIN optional; nothing leaves the browser)
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin();
const URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const MAIN_SID = 'qa_orb_two_main', ROUTED_SID = 'qa_orb_two_routed', AGENT = 'qa-host';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = Date.now() / 1000;
const session = (id, title, agent) => ({
  id, source: 'wizard-mobile', title, status: 'completed', archived: false, hidden: false, message_count: 2,
  started_at: now - 600, last_active: now - 60, wizard_last_user_at: now - 120, wizard_last_assistant_at: now - 60, wizard_activity_at: now - 60,
  latest_message: { role: 'assistant', content: 'Ready.', timestamp: now - 60 }, last_user_message: { role: 'user', content: 'Hello', timestamp: now - 120 },
  ...(agent ? { agent: { id: agent, label: 'Synthetic routed', privacy: 'standard' } } : {}),
});
const rows = sid => [
  { id: 1, session_id: sid, role: 'user', content: 'Hello', timestamp: now - 120 },
  { id: 2, session_id: sid, role: 'assistant', content: 'Ready.', timestamp: now - 60 },
];

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'], colorScheme: 'dark', serviceWorkers: 'block' });
  const writes = [], foreign = []; const R = { createDelay: 0, creates: 0, patched: 0, completes: 0, words: 'Here is the photo I mentioned' };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), method = q.method();
    if (u.origin !== ORIGIN) { foreign.push(u.href); return r.abort(); }
    const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) }).catch(() => {});
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && (method === 'GET' || method === 'HEAD')) {
      const f = decodeURIComponent(m[1]) || 'index.html', p = path.join(WEB, 'web', f);
      if (f.includes('..') || /^(data|summaries)\.js$/.test(f) || !fs.existsSync(p) || !fs.statSync(p).isFile()) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : /\.(json|webmanifest)$/.test(f) ? 'application/json' : 'application/javascript', body: fs.readFileSync(p) });
    }
    // A box that advertises resumable uploads, so picked files take the WizUploads path a real Wizard uses.
    if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1,
      settings: { owner: { name: 'QA', place: '' }, agent: { name: 'Wizard' }, clock: { timezone: 'UTC', day_starts_at: '00:00' }, voice: { language: '', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, resumable_uploads: true },
      endpoints: { transcribe: '/wizard/v1/transcribe', route: '/wizard/v1/route', uploads: '/wizard/v1/uploads' } });
    if (u.pathname.endsWith('/transcribe') && method === 'POST') return json({ text: R.words, ms: 5 });
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u.pathname)) return json({ cmd: { route: 'agent' }, ms: 5 });
    // Resumable uploads: a slow create (a busy Wizard), then normal PATCH/complete.
    if (u.pathname === '/wizard/v1/uploads' && method === 'POST') {
      const n = ++R.creates; const body = JSON.parse(q.postData() || '{}'); R.bytes = body.bytes;
      await sleep(R.createDelay);
      return json({ upload_id: 'up_qa' + n, offset: 0, status: 'uploading', chunk_bytes: 8388608 }, 201);
    }
    if (/^\/wizard\/v1\/uploads\/up_qa\d+$/.test(u.pathname) && method === 'PATCH') { R.patched++; return r.fulfill({ status: 204, headers: { 'Upload-Offset': String(R.bytes) } }); }
    if (/^\/wizard\/v1\/uploads\/up_qa\d+$/.test(u.pathname) && method === 'GET') return json({ offset: R.patched ? R.bytes : 0, status: 'uploading' });
    if (/^\/wizard\/v1\/uploads\/up_qa\d+\/complete$/.test(u.pathname)) { R.completes++; const n = u.pathname.match(/up_qa(\d+)/)[1]; return json({ file: { id: 'qa-photo-file-' + n, filename: 'qa-photo.png', mime: 'image/png', bytes: R.bytes } }); }
    if (method !== 'GET' && method !== 'HEAD') {
      let body = null; try { body = JSON.parse(q.postData() || '{}'); } catch (_) { body = q.postData() || ''; }
      writes.push({ path: u.pathname, agent: u.searchParams.get('agent') || '', body });
      if (u.pathname === '/wizard/files/upload') return json({ file: { id: 'qa-audio', filename: 'v.webm', mime: 'audio/webm', bytes: 10 } }, 201);
      if (u.pathname === '/wizard/hermes/v1/runs') return json({ run_id: 'qa-run-' + writes.length, status: 'queued', session_id: body?.session_id }, 202);
      if (/\/v1\/runs\/[^/]+\/steer$/.test(u.pathname)) return json({ accepted: true }, 202);
      return json({ ok: true, accepted: true, state: { initializedAt: Date.now(), threads: {} } });
    }
    if (u.pathname === '/wizard/v1/agents') return json({ agents: [
      { id: 'hermes', is_default: true, label: 'Hermes', harness: 'hermes', privacy: 'standard', status: 'running' },
      { id: AGENT, label: 'Synthetic routed', harness: 'hermes', privacy: 'standard', status: 'running', model: { model: 'fixture-model', provider: 'fixture' } },
    ] });
    const agentQ = u.searchParams.get('agent') || '';
    if (u.pathname === '/wizard/hermes/api/sessions') {
      const data = agentQ === AGENT ? [session(ROUTED_SID, 'Routed orb QA', AGENT)] : agentQ ? [] : [session(MAIN_SID, 'Main orb QA')];
      return json({ object: 'list', data, has_more: false, pagination: { limit: 100, offset: 0, returned: data.length, has_more: false } });
    }
    const sm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/);
    if (sm && [MAIN_SID, ROUTED_SID].includes(sm[1])) return sm[2] ? json({ object: 'list', data: rows(sm[1]), pagination: { limit: 500, offset: 0, returned: 2 } }) : json({ session: session(sm[1], 'QA', sm[1] === ROUTED_SID ? AGENT : '') });
    if (sm) return json({ error: 'not a synthetic thread' }, 404);
    if (/\/wizard\/hermes\/v1\/runs\//.test(u.pathname)) return u.pathname.endsWith('/events') ? r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }) : json({ run_id: 'qa-run', status: 'queued' });
    if (u.pathname === '/wizard/hermes/api/model/options') return json({ model: 'fixture-model', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Synthetic fixture route', authenticated: true, is_current: true, models: ['fixture-model'] }] });
    if (u.pathname === '/wizard/thread-seen' || u.pathname === '/wizard/thread-dispositions') return json({ state: { initializedAt: Date.now(), threads: {} } });
    return json({});
  });
  const p = await ctx.newPage();
  const errs = [], toasts = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(sid => window.__wos?.live?.ok && window.__wos.live.session(sid), MAIN_SID, { timeout: 30000 });
  await p.exposeFunction('__qaToast', t => toasts.push(t));
  await p.evaluate(() => new MutationObserver(() => { const t = document.body.innerText; const m = t.match(/[^\n]*(still uploading|tap again when it finishes|send when it finishes)[^\n]*/i); if (m) window.__qaToast(m[0]); }).observe(document.body, { subtree: true, childList: true, characterData: true }));
  await p.waitForTimeout(600);
  return { ctx, p, writes, errs, toasts, R, foreign };
}
const runsOf = ws => ws.filter(w => w.path === '/wizard/hermes/v1/runs').map(w => ({ ...w.body, _agent: w.agent }));
async function tapOrb(p) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); }

async function twoImageTake(b, label, open, sid, agent) {
  const png = path.join(process.env.TMPDIR || '/tmp', 'qa-photo.png'), png2 = path.join(process.env.TMPDIR || '/tmp', 'qa-photo-2.png');
  for (const f of [png, png2]) fs.writeFileSync(f, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), require('crypto').randomBytes(200000)]));
  const { ctx, p, writes, errs, toasts, R, foreign } = await boot(b);
  await open(p); await p.waitForTimeout(800);
  R.createDelay = 2500; writes.length = 0;
  await tapOrb(p); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => __wos.voice) === 'listen', `${label}: orb take is recording`);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#arcAttach').tap()]);
  await fc.setFiles([png, png2]);
  await p.waitForTimeout(700);
  ok(R.creates <= 1, `${label}: the second image has not started uploading at the send tap`, String(R.creates));
  await tapOrb(p);
  await p.waitForFunction(() => __wos.voice !== 'listen' && __wos.voice !== 'paused', null, { timeout: 5000 }).catch(() => {});
  ok(!toasts.length, `${label}: no "still uploading" block`, toasts.join(' | '));
  const end = Date.now() + 30000; let run = null;
  while (Date.now() < end && !(run = runsOf(writes).find(r => (r.wizard_file_ids || []).some(id => /^qa-photo-file/.test(id))))) await sleep(300);
  const ids = (run?.wizard_file_ids || []).filter(id => /^qa-photo-file/.test(id));
  ok(ids.length === 2, `${label}: both images are delivered with the message`, JSON.stringify(runsOf(writes).map(r => r.wizard_file_ids)));
  ok(run && run.session_id === sid, `${label}: it lands in the thread it was sent from`, run && run.session_id);
  ok(run && (run._agent || run.agent || '') === agent, `${label}: it is delivered to the ${agent ? 'routed' : 'main'} agent`, run && JSON.stringify({ q: run._agent, body: run.agent }));
  ok(!runsOf(writes).some(r => (r.wizard_file_ids || []).some(id => String(id).startsWith('pending:'))), `${label}: no placeholder id reaches the agent`);
  ok(runsOf(writes).length === 1, `${label}: exactly one run (no duplicate send)`, runsOf(writes).length);
  ok(await p.evaluate(() => window.WosOutbox.unsent().length) === 0, `${label}: outbox drained`);
  ok(!foreign.length, `${label}: no request left the fixture origin`, foreign.join(' '));
  ok(errs.length === 0, `${label}: no page errors`, errs.join(' | '));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  await twoImageTake(b, 'main thread', async p => {
    await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(400);
    await p.evaluate(sid => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && !x.agent); __wos.openChat(w.id, sid); }, MAIN_SID);
  }, MAIN_SID, '');
  await twoImageTake(b, 'routed thread', async p => {
    // Routed threads open in the main Chats window under the agent's Focus (no per-agent window).
    await p.evaluate(ag => window.WizOpenAgentChats(ag), AGENT);
    await p.waitForFunction(sid => window.__wos.live.session(sid), ROUTED_SID, { timeout: 8000 });
    await p.evaluate(sid => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && !x.agent); __wos.openChat(w.id, sid); }, ROUTED_SID);
  }, ROUTED_SID, AGENT);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
