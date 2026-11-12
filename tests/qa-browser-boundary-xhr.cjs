// Browser QA for a sandboxed app's XMLHttpRequest calls to its own backend (wizard-os#133, slice 36; fetch: slice 35,
// tests/qa-browser-boundary-backend.cjs, whose app server and shell page this copies).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js and core/app-services.js; app
// windows made the way app.js / desktop.js make them, whose pages load the real core/app-client.js. An opaque page's
// own fetch goes out with `Origin: null` and no cookies, and the browser hides the answer. With the app kit the app's
// XMLHttpRequest to its own backend works as before (cookies, JSON, uploads with progress, binary, 204, HEAD, abort,
// timeout), while a call to another app or an owner route still gets nothing.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-xhr.cjs
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
  window.loaded = new Promise(done => {
    const x = new XMLHttpRequest(); window.states = [];
    x.onreadystatechange = () => states.push(x.readyState);
    x.open('GET', 'api/notes'); x.responseType = 'json';
    x.onload = () => { const j = x.status === 200 ? x.response : null; show(j, j ? null : { name: 'HTTP', message: String(x.status) }); done(j); };
    x.onerror = () => { window.loadError = 'error'; show(null, { name: 'NetworkError', message: 'the app server could not be reached' }); done(null); };
    x.send();
  });
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
    if (u.pathname === '/notes/api/doc') { res.setHeader('content-type', 'application/xml'); return res.end('<notes><n>figs</n></notes>'); }
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
  // 1. The app's first load with XMLHttpRequest: its own backend, the owner's cookie, JSON, the usual ready states.
  const first = await f.evaluate(() => loaded.then(j => ({ j, states: window.states, err: window.loadError || null })));
  ok(first.j && first.j.who === 'owner' && first.j.notes[0] === 'Buy figs' && JSON.stringify(first.states) === '[1,2,3,4]', 'the app loads its notes with XMLHttpRequest: ' + JSON.stringify(first));
  if (SHOT) { await page.waitForTimeout(100); await page.screenshot({ path: SHOT }); }
  const xhr = (opts) => f.evaluate(o => new Promise(done => {
    const x = new XMLHttpRequest(), ev = [], up = [];
    for (const t of ['loadstart', 'progress', 'load', 'error', 'abort', 'timeout', 'loadend']) x.addEventListener(t, () => ev.push(t));
    for (const t of ['loadstart', 'progress', 'load', 'loadend']) x.upload.addEventListener(t, () => up.push(t));
    x.open(o.method || 'GET', o.url);
    if (o.type) x.responseType = o.type;
    if (o.timeout) x.timeout = o.timeout;
    for (const [k, v] of o.headers || []) x.setRequestHeader(k, v);
    const fin = () => {
      let r = x.response; if (r instanceof ArrayBuffer) r = [...new Uint8Array(r)]; else if (r instanceof Blob) r = { blob: r.type, size: r.size };
      else if (r && typeof r === 'object' && r.nodeType) r = { doc: r.documentElement.nodeName, text: r.documentElement.textContent };
      done({ status: x.status, ready: x.readyState, ev, up, ver: x.getResponseHeader('x-app-version'), all: x.getAllResponseHeaders().includes('content-type'), url: x.responseURL, r });
    };
    x.onloadend = () => setTimeout(fin, 0);
    let body = o.body; if (o.form) { body = new FormData(); body.append('file', new Blob(['figs and dates'], { type: 'text/plain' }), 'figs.txt'); }
    x.send(body);
    if (o.abortAt) setTimeout(() => x.abort(), o.abortAt);
  }), opts);
  // 2. A JSON POST with its own header: status 201, headers and body back, a response URL.
  const post = await xhr({ method: 'POST', url: '/notes/api/save', headers: [['content-type', 'application/json'], ['x-app-thing', 'yes']], body: JSON.stringify({ text: 'Buy figs' }), type: 'json' });
  const postSeen = seen.find(s => s.path === '/notes/api/save');
  ok(post.status === 201 && post.ver === '7' && post.all && post.r?.saved?.text === 'Buy figs' && post.url === base + '/notes/api/save' && postSeen?.custom === 'yes' && postSeen?.type === 'application/json' && post.ev.join() === 'loadstart,progress,load,loadend',
    'a JSON POST reaches the app server with its own headers, and its status, headers and body come back: ' + JSON.stringify(post));
  // 3. An upload (FormData) arrives as multipart and reports upload progress.
  const up = await xhr({ method: 'POST', url: 'api/upload', form: true, type: 'json' });
  ok(up.r?.multipart && up.r?.has && up.status === 200, 'a FormData upload arrives as multipart: ' + JSON.stringify(up));
  const upBytes = await xhr({ method: 'POST', url: 'api/save', body: '{"text":"x"}', type: 'json' });
  ok(upBytes.up.join() === 'loadstart,progress,load,loadend', 'upload events fire for a body: ' + JSON.stringify(upBytes.up));
  // 4. Binary, a Blob, a document, 204 and HEAD.
  const bytes = await xhr({ url: 'api/bytes', type: 'arraybuffer' });
  const blob = await xhr({ url: 'api/bytes', type: 'blob' });
  const doc = await xhr({ url: 'api/doc', type: 'document' });
  const empty = await xhr({ url: 'api/empty' });
  const head = await xhr({ method: 'HEAD', url: 'api/notes' });
  ok(JSON.stringify(bytes.r) === '[0,1,2,250,255]' && blob.r?.blob === 'application/octet-stream' && blob.r?.size === 5 && doc.r?.doc === 'notes' && doc.r?.text === 'figs'
    && empty.status === 204 && empty.r === '' && head.status === 200 && head.r === '', 'binary, Blob, document, 204 and HEAD come back as they are: ' + JSON.stringify({ bytes: bytes.r, blob: blob.r, doc: doc.r, empty: [empty.status, empty.r], head: [head.status, head.r] }));
  // 5. Another app's backend and an owner route: still nothing (error, status 0), and no cookie or token went out.
  seen.length = 0;
  const other = await xhr({ url: '/other/api/secret' });
  const owner = await xhr({ method: 'POST', url: '/wizard/v1/chats', body: '{}' });
  ok(other.status === 0 && other.ev.includes('error') && other.r === '' && owner.status === 0 && owner.ev.includes('error'), 'another app and an owner route stay unreadable: ' + JSON.stringify([other.status, other.ev, owner.status, owner.ev]));
  ok(seen.length >= 2 && seen.every(s => !s.cookie && !s.token && s.origin === 'null'), 'those calls went out as before: Origin null, no cookie, no token: ' + JSON.stringify(seen.map(s => [s.path, s.origin, s.cookie, s.token])));
  // 6. abort() and timeout end the call, also at the server.
  const ab = await xhr({ url: 'api/slow', abortAt: 100 });
  await page.waitForTimeout(300);
  ok(ab.ev.join() === 'loadstart,abort,loadend' && ab.status === 0 && ab.ready === 0 && slowCut === 1, 'abort() ends the call, also at the server (closed: ' + slowCut + '): ' + JSON.stringify(ab));
  const to = await xhr({ url: 'api/slow', timeout: 150 });
  await page.waitForTimeout(300);
  ok(to.ev.join() === 'loadstart,timeout,loadend' && to.status === 0 && to.ready === 4 && slowCut === 2, 'a timeout fires ontimeout and ends the call (closed: ' + slowCut + '): ' + JSON.stringify(to));
  // 7. It is still an XMLHttpRequest to the app's code.
  const shape = await f.evaluate(() => { const x = new XMLHttpRequest(); return { inst: x instanceof XMLHttpRequest && x instanceof EventTarget, done: XMLHttpRequest.DONE, unsent: x.readyState, up: typeof x.upload.addEventListener }; });
  ok(shape.inst && shape.done === 4 && shape.unsent === 0 && shape.up === 'function', 'the stand-in keeps the XMLHttpRequest shape: ' + JSON.stringify(shape));
  ok(!errors.length, 'no shell page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
