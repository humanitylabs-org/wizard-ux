// Browser QA for a sandboxed app's calls to its own backend (wizard-os#133, slice 35).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js and core/app-services.js; app
// windows made the way app.js / desktop.js make them, whose pages load the real core/app-client.js. An opaque page's
// own fetch goes out with `Origin: null` and no cookies, and the browser hides the answer. With the app kit the app's
// fetch to its own backend works as before (cookies, JSON, uploads, 204, redirects inside the app, abort), while a
// call to another app, an owner route or a redirect out of the app still gets nothing.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-backend.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOT=<file.png>: a screenshot of the app window after it loaded its notes.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
// The app loads its notes from its own backend when it opens (the usual way apps do it).
const APP = name => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{margin:0;padding:18px 22px;font:15px system-ui;background:#fbfaf7;color:#1d1b22}h1{font-size:19px;margin:0 0 10px}
.row{margin:8px 0;padding:10px 12px;border-radius:10px;background:#efece4}.bad{background:#fde3e1;color:#8a1c12}b{font-weight:600}</style></head>
<body><h1>${name}</h1><div id="out"><div class="row">Loading notes…</div></div><script>
  window.loaded = fetch('api/notes').then(r => r.json()).then(j => { window.notes = j; show(j, null); return j; }, e => { window.loadError = e.name; show(null, e); return null; });
  function show(j, e) {
    document.getElementById('out').innerHTML = e ? '<div class="row bad">Couldn\\u2019t load your notes (' + e.name + ': ' + e.message + ').</div>'
      : j.notes.map(n => '<div class="row">' + n + '</div>').join('') + '<div class="row">Signed in as <b>' + j.who + '</b></div>';
  }
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' }); document.cookie = 'sid=owner; path=/';</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } }; window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{margin:0;background:#16121f;padding:14px}.win{margin:0 0 10px;border-radius:12px;overflow:hidden;width:440px;background:#fff}
.wbar{height:28px;background:#2b2440;color:#fff;font:13px system-ui;display:flex;align-items:center;padding:0 10px}iframe{width:440px;height:170px;border:0;display:block}</style></head>
<body><div id="desk"></div><script>
  const B = window.WizBrowserBoundary;
  window.openWin = (id, url, path) => {
    const w = document.createElement('div'); w.className = 'win'; w.id = 'w-' + id;
    w.innerHTML = '<header class="wbar">' + id + '</header><iframe class="appframe" ' + B.frameAttributes(url, id) + ' src="' + url + '"></iframe>';
    document.getElementById('desk').appendChild(w);
    WizAppServices.attach(w.querySelector('iframe'), { appId: id, path, isVisible: () => true });
    return w.id;
  };
</script></body></html>`;
const html = (res, body) => { res.setHeader('content-type', 'text/html'); res.end(body); };
const seen = [];
let slowCut = 0;   // slow calls whose connection closed before the server answered (the app aborted them)   // what each backend call carried: path, method, Origin, cookie, token header
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (u.pathname.includes('/api/') || u.pathname.startsWith('/wizard/')) seen.push({ path: u.pathname, method: req.method, origin: req.headers.origin || '', cookie: req.headers.cookie || '', token: req.headers['x-wizard-shell-token'] || '', type: req.headers['content-type'] || '', len: body.length, custom: req.headers['x-app-thing'] || '' });
    const json = (o, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('x-app-version', '7'); res.end(JSON.stringify(o)); };
    if (u.pathname === '/') return html(res, SHELL);
    if (u.pathname === '/notes/') return html(res, APP('Notes'));
    if (u.pathname === '/notes/api/notes') return /sid=owner/.test(req.headers.cookie || '') ? json({ notes: ['Buy figs', 'Call Jan'], who: 'owner' }) : json({ error: 'sign in' }, 401);
    if (u.pathname === '/notes/api/save' && req.method === 'POST') return json({ saved: JSON.parse(body.toString() || 'null') }, 201);
    if (u.pathname === '/notes/api/upload' && req.method === 'POST') return json({ multipart: /multipart\/form-data/.test(req.headers['content-type'] || ''), bytes: body.length, has: body.includes('figs.txt') });
    if (u.pathname === '/notes/api/empty') { res.statusCode = 204; return res.end(); }
    if (u.pathname === '/notes/api/slow') { let done = false; res.on('close', () => { if (!done) slowCut++; }); return setTimeout(() => { done = true; json({ slow: true }); }, 1500); }
    if (u.pathname === '/notes/api/post-out' && req.method === 'POST') { res.statusCode = 307; res.setHeader('location', '/other/api/act'); return res.end(); }
    if (u.pathname === '/other/api/act') return json({ acted: true });
    if (u.pathname === '/notes/api/bytes') { res.setHeader('content-type', 'application/octet-stream'); return res.end(Buffer.from([0, 1, 2, 250, 255])); }
    if (u.pathname === '/notes/api/in') { res.statusCode = 302; res.setHeader('location', '/notes/api/notes'); return res.end(); }
    if (u.pathname === '/notes/api/out') { res.statusCode = 302; res.setHeader('location', '/other/api/secret'); return res.end(); }
    if (u.pathname === '/other/api/secret') return json({ secret: 'other app data' });
    if (u.pathname.startsWith('/wizard/')) return json({ chats: ['private'] });
    if (u.pathname.startsWith('/wizard-os-home/')) {
      const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
      if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(file)); }
    }
    res.statusCode = 404; res.end('');
  });
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 470, height: 230 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const wid = await page.evaluate(() => openWin('notes', '/notes/', '/notes/'));
  await page.waitForTimeout(300);
  const f = await (await page.$('#' + wid + ' iframe')).contentFrame();
  ok(await f.evaluate(() => self.origin) === 'null', 'the app page is opaque');
  // 1. The app's first load: its own backend, with the owner's cookie, as JSON.
  const first = await f.evaluate(() => loaded.then(j => ({ j, err: window.loadError || null })));
  ok(first.j && first.j.who === 'owner' && first.j.notes[0] === 'Buy figs', 'the app loads its notes from its own backend: ' + JSON.stringify(first));
  if (SHOT) { await page.waitForTimeout(100); await page.screenshot({ path: SHOT }); }
  // 2. A JSON POST with its own header and status 201; the answer's headers reach the app.
  const post = await f.evaluate(() => fetch('/notes/api/save', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-thing': 'yes' }, body: JSON.stringify({ text: 'Buy figs' }) })
    .then(async r => ({ status: r.status, ok: r.ok, ver: r.headers.get('x-app-version'), j: await r.json(), url: r.url })).catch(e => ({ error: e.name + ': ' + e.message })));
  const postSeen = seen.find(s => s.path === '/notes/api/save');
  ok(post.status === 201 && post.ok && post.ver === '7' && post.j?.saved?.text === 'Buy figs' && post.url === base + '/notes/api/save' && postSeen?.custom === 'yes' && postSeen?.type === 'application/json',
    'a JSON POST reaches the app server with its own headers, and its status, headers and body come back: ' + JSON.stringify(post));
  // 3. A file upload (FormData), 204, binary bytes and HEAD.
  const up = await f.evaluate(() => { const fd = new FormData(); fd.append('file', new Blob(['figs and dates'], { type: 'text/plain' }), 'figs.txt'); return fetch('api/upload', { method: 'POST', body: fd }).then(r => r.json()).catch(e => ({ error: e.name })); });
  ok(up.multipart && up.has && up.bytes > 0, 'a FormData upload arrives as multipart: ' + JSON.stringify(up));
  const misc = await f.evaluate(async () => {
    const e = await fetch('api/empty'); const b = new Uint8Array(await (await fetch('api/bytes')).arrayBuffer()); const h = await fetch('api/notes', { method: 'HEAD' });
    return { empty: e.status, emptyBody: await e.text(), bytes: [...b], head: h.status, headBody: await h.text() };
  }).catch(e => ({ error: e.name + ': ' + e.message }));
  ok(misc.empty === 204 && misc.emptyBody === '' && JSON.stringify(misc.bytes) === '[0,1,2,250,255]' && misc.head === 200 && misc.headBody === '', '204, binary bytes and HEAD come back as they are: ' + JSON.stringify(misc));
  // 4. A redirect inside the app is followed; one that leaves the app gives the app nothing.
  const inside = await f.evaluate(() => fetch('api/in').then(async r => ({ redirected: r.redirected, url: r.url, who: (await r.json()).who })).catch(e => ({ error: e.name })));
  ok(inside.redirected === true && inside.url.endsWith('/notes/api/notes') && inside.who === 'owner', 'a redirect inside the app is followed: ' + JSON.stringify(inside));
  const out = await f.evaluate(() => fetch('api/out').then(r => r.text()).then(t => 'read:' + t, e => e.name));
  ok(out === 'TypeError', 'a redirect out of the app gives the app nothing: ' + out);
  // A POST is never sent on to a redirect's address (it may be another app): the other app never sees it.
  seen.length = 0;
  const postOut = await f.evaluate(() => fetch('api/post-out', { method: 'POST', body: 'x' }).then(r => 'status:' + r.status, e => e.name));
  ok(postOut === 'TypeError' && !seen.some(s => s.path === '/other/api/act'), 'a POST redirected to another app is not sent there: ' + postOut + ' ' + JSON.stringify(seen.map(s => s.path)));
  // 5. Another app's backend and an owner route: still no answer, and they never see the owner's cookie or a token.
  seen.length = 0;
  const other = await f.evaluate(() => fetch('/other/api/secret').then(r => r.text()).then(t => 'read:' + t, e => e.name));
  const owner = await f.evaluate(() => fetch('/wizard/v1/chats', { method: 'POST', body: '{}' }).then(r => r.text()).then(t => 'read:' + t, e => e.name));
  ok(other === 'TypeError' && owner === 'TypeError', 'another app and an owner route stay unreadable: ' + other + ' / ' + owner);
  ok(seen.every(s => !s.cookie && !s.token && s.origin === 'null'), 'those calls went out as before: Origin null, no cookie, no token: ' + JSON.stringify(seen.map(s => [s.path, s.origin, s.cookie, s.token])));
  // 6. Abort: the app's AbortController ends its call at once.
  const aborted = await f.evaluate(() => { const c = new AbortController(); const p = fetch('api/slow', { signal: c.signal }).then(() => 'done', e => e.name); setTimeout(() => c.abort(), 100); return p; });
  await page.waitForTimeout(300);
  ok(aborted === 'AbortError' && slowCut === 1, 'abort ends the call, also at the server (connection closed: ' + slowCut + '): ' + aborted);
  ok(!errors.length, 'no shell page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
