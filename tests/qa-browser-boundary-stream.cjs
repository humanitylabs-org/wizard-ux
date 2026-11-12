// Browser QA for a sandboxed app's live answers from its own backend (wizard-os#133, slice 37): server-sent events
// (EventSource) and fetch answers that arrive as they are written (a streamed body).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js and core/app-services.js; app
// windows made the way app.js / desktop.js make them, whose pages load the real core/app-client.js. An opaque page's
// own EventSource goes out with `Origin: null` and no cookies, and the browser refuses the answer (CORS). With the app
// kit the app's live feed from its own backend works (owner cookie, events as they come, reconnect with Last-Event-ID,
// close), a streamed fetch reads its first piece before the server is done, a large streamed answer arrives whole, and
// another app's stream still gets nothing.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-stream.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOT=<file.png>: a screenshot of the app window after its live feed got its first events.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
// The app shows its live feed (the usual way apps follow their own backend).
const APP = name => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{margin:0;padding:18px 22px;font:15px system-ui;background:#fbfaf7;color:#1d1b22}h1{font-size:19px;margin:0 0 10px}
.row{margin:8px 0;padding:10px 12px;border-radius:10px;background:#efece4}.bad{background:#fde3e1;color:#8a1c12}</style></head>
<body><h1>${name} · live</h1><div id="out"><div class="row" id="wait">Waiting for live updates…</div></div><script>
  window.events = []; window.feedErrors = [];
  const es = new EventSource('api/live');
  es.onmessage = e => { events.push({ data: e.data, id: e.lastEventId, at: performance.now() }); const d = document.createElement('div'); d.className = 'row'; d.textContent = e.data; document.getElementById('out').appendChild(d); document.getElementById('wait')?.remove(); };
  es.onerror = () => { feedErrors.push(es.readyState); if (es.readyState === 2) { document.getElementById('out').innerHTML = '<div class="row bad">Live updates are not reaching this app.</div>'; } };
  window.feed = es;
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' }); document.cookie = 'sid=owner; path=/';</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } }; window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{margin:0;background:#16121f;padding:14px}.win{margin:0 0 10px;border-radius:12px;overflow:hidden;width:440px;background:#fff}
.wbar{height:28px;background:#2b2440;color:#fff;font:13px system-ui;display:flex;align-items:center;padding:0 10px}iframe{width:440px;height:220px;border:0;display:block}</style></head>
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
const seen = [];   // what each live call carried: path, Origin, cookie, token header, Last-Event-ID
const closed = {}; // live calls whose connection the client closed, per path
let liveRound = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.includes('/api/') || u.pathname.startsWith('/wizard/')) seen.push({ path: u.pathname, origin: req.headers.origin || '', cookie: req.headers.cookie || '', token: req.headers['x-wizard-shell-token'] || '', last: req.headers['last-event-id'] || '', accept: req.headers.accept || '' });
  const track = p => res.on('close', () => { if (!res.writableEnded) closed[p] = (closed[p] || 0) + 1; });
  if (u.pathname === '/') return html(res, SHELL);
  if (u.pathname === '/notes/') return html(res, APP('Notes'));
  if (u.pathname === '/notes/api/live') {
    if (!/sid=owner/.test(req.headers.cookie || '')) { res.statusCode = 401; return res.end('sign in'); }
    track(u.pathname);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const round = ++liveRound;
    if (round === 1) {
      // The first connection: two events at once, a third later, then the server drops it (the app reconnects).
      res.write('retry: 300\n\nid: 1\ndata: Figs are in season\n\n');
      res.write(': keep-alive\n\nid: 2\nevent: message\ndata: Jan joined the list\n\n');
      setTimeout(() => { res.write('id: 3\ndata: Dates are back\n\n'); setTimeout(() => res.end(), 300); }, 2500);
      return;
    }
    res.write('id: 4\ndata: Reconnected after ' + (req.headers['last-event-id'] || 'nothing') + '\n\n');
    return; // stays open until the app closes it
  }
  if (u.pathname === '/notes/api/slow-stream') {
    track(u.pathname);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('first piece;');
    setTimeout(() => { res.write('second piece;'); setTimeout(() => res.end('done'), 600); }, 1200);
    return;
  }
  if (u.pathname === '/notes/api/big') {
    // 5 MB in 64 KB writes (more than the shell lets wait at once, so the page's acks keep it going).
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    let i = 0; const piece = n => Buffer.alloc(65536, n % 251);
    const more = () => { while (i < 80) { if (!res.write(piece(i++))) return res.once('drain', more); } res.end(); };
    return more();
  }
  if (u.pathname === '/notes/api/endless') {
    track(u.pathname);
    res.writeHead(200, { 'content-type': 'text/plain' });
    const t = setInterval(() => res.write('tick;'), 100); res.on('close', () => clearInterval(t));
    return;
  }
  if (u.pathname === '/other/api/live') { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end('data: other app data\n\n'); }
  if (u.pathname.startsWith('/wizard/')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end('data: private chats\n\n'); }
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 470, height: 280 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const wid = await page.evaluate(() => openWin('notes', '/notes/', '/notes/'));
  await page.waitForTimeout(300);
  const f = await (await page.$('#' + wid + ' iframe')).contentFrame();
  ok(await f.evaluate(() => self.origin) === 'null', 'the app page is opaque');
  // 1. The live feed: the owner's cookie reaches the app's own backend and the first events arrive while it stays open.
  await f.waitForFunction(() => events.length >= 2 || feedErrors.includes(2), null, { timeout: 2000 }).catch(() => {});
  const early = await f.evaluate(() => ({ events: events.map(e => [e.data, e.id]), state: feed.readyState, errs: feedErrors.slice() }));
  ok(early.events.length === 2 && early.events[0][0] === 'Figs are in season' && early.events[1][1] === '2' && early.state === 1,
    'live events from the app\'s own backend arrive as they come (stream still open): ' + JSON.stringify(early));
  const live1 = seen.find(s => s.path === '/notes/api/live');
  ok(!!live1 && /sid=owner/.test(live1.cookie) && live1.accept === 'text/event-stream' && !live1.token, 'the feed went out with the owner\'s cookie, as an event stream, never with the shell token: ' + JSON.stringify(live1));
  if (SHOT) await page.screenshot({ path: SHOT });
  // 2. The server drops it: the app reconnects after `retry` with the last event id it saw.
  await f.waitForFunction(() => events.length >= 4 || feedErrors.includes(2), null, { timeout: 5000 }).catch(() => {});
  const later = await f.evaluate(() => ({ events: events.map(e => [e.data, e.id]), state: feed.readyState, errs: feedErrors.slice() }));
  const again = seen.filter(s => s.path === '/notes/api/live')[1];
  ok(later.events.length === 4 && later.events[2][0] === 'Dates are back' && later.events[3][0] === 'Reconnected after 3' && again?.last === '3' && later.state === 1,
    'a dropped feed reconnects with Last-Event-ID and goes on: ' + JSON.stringify(later));
  // 3. close() ends it at the server too.
  await f.evaluate(() => feed.close());
  await page.waitForTimeout(400);
  ok(closed['/notes/api/live'] === 1, 'close() ends the feed, also at the server (connections closed: ' + (closed['/notes/api/live'] || 0) + ')');
  // 4. A streamed fetch answer: the first piece is readable before the server has finished.
  const slow = await f.evaluate(async () => {
    const t0 = performance.now(), r = await fetch('api/slow-stream'), rd = r.body.getReader(), dec = new TextDecoder();
    const first = await rd.read(), firstAt = performance.now() - t0; let rest = '';
    for (;;) { const { done, value } = await rd.read(); if (done) break; rest += dec.decode(value, { stream: true }); }
    return { first: dec.decode(first.value), firstAt: Math.round(firstAt), all: dec.decode(first.value) + rest, total: Math.round(performance.now() - t0) };
  }).catch(e => ({ error: e.name + ': ' + e.message }));
  ok(slow.first === 'first piece;' && slow.firstAt < 900 && slow.all === 'first piece;second piece;done' && slow.total >= 1500,
    'a streamed answer\'s first piece arrives before the server is done, and the rest follows: ' + JSON.stringify(slow));
  // 5. A large streamed answer (5 MB, more than the shell lets wait at once) arrives whole and in order.
  const big = await f.evaluate(async () => {
    const b = new Uint8Array(await (await fetch('api/big')).arrayBuffer());
    let okBytes = b.length === 80 * 65536;
    for (let i = 0; okBytes && i < 80; i++) okBytes = b[i * 65536] === i % 251 && b[i * 65536 + 65535] === i % 251;
    return { len: b.length, okBytes };
  }).catch(e => ({ error: e.name + ': ' + e.message }));
  ok(big.okBytes === true, 'a 5 MB streamed answer arrives whole and in order: ' + JSON.stringify(big));
  // 6. Cancelling the reader of an endless answer ends the call at the server.
  const cancelled = await f.evaluate(() => Promise.race([(async () => {
    const rd = (await fetch('api/endless')).body.getReader(); await rd.read(); await rd.read(); await rd.cancel(); return 'cancelled';
  })(), new Promise(r => setTimeout(() => r('no answer in 3 s'), 3000))])).catch(e => e.name + ': ' + e.message);
  await page.waitForTimeout(400);
  ok(cancelled === 'cancelled' && closed['/notes/api/endless'] === 1, 'cancelling a streamed answer ends it at the server (' + (closed['/notes/api/endless'] || 0) + '): ' + cancelled);
  // 7. Another app's feed and an owner route: still nothing, and they never see the owner's cookie or a token.
  seen.length = 0;
  const other = await f.evaluate(() => new Promise(res => {
    const out = {}; let n = 0;
    for (const [k, url] of [['other', '/other/api/live'], ['owner', '/wizard/v1/live']]) {
      const s = new EventSource(url); const done = v => { if (out[k]) return; out[k] = v; s.close(); if (++n === 2) res(out); };
      s.onmessage = e => done('read:' + e.data); s.onerror = () => done('error');
    }
    setTimeout(() => res(out), 3000);
  }));
  ok(other.other === 'error' && other.owner === 'error', 'another app\'s and an owner route\'s event streams stay unreadable: ' + JSON.stringify(other));
  ok(seen.length > 0 && seen.every(s => !s.cookie && !s.token && s.origin === 'null'), 'those went out as before: Origin null, no cookie, no token: ' + JSON.stringify(seen.map(s => [s.path, s.origin, s.cookie, s.token])));
  ok(!errors.length, 'no shell page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
