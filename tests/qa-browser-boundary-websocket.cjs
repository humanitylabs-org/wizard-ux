// Browser QA for a sandboxed app's WebSocket to its own backend (wizard-os#133, slice 38).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js and core/app-services.js; app
// windows made the way app.js / desktop.js make them, whose pages load the real core/app-client.js. An opaque page's
// own WebSocket goes out with `Origin: null` and no cookies, so a server that checks the Origin (the Recorder's live
// transcript does) refuses it. With the app kit the app's socket to its own backend opens with the shell's origin and
// the owner's cookie: text and bytes go both ways in order, a Blob is sent in its place, the server's close and the
// page's close() arrive with their codes, and a reload or a closed window ends the socket at the server. Another app's
// socket and an owner route still go out as before (Origin null, no cookie) and are refused.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-websocket.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOT=<file.png>: a screenshot of the app window after its live socket got its first messages.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
// The app follows a live transcript over a WebSocket, the way the Recorder does.
const APP = name => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{margin:0;padding:18px 22px;font:15px system-ui;background:#fbfaf7;color:#1d1b22}h1{font-size:19px;margin:0 0 10px}
.row{margin:8px 0;padding:10px 12px;border-radius:10px;background:#efece4}.bad{background:#fde3e1;color:#8a1c12}</style></head>
<body><h1>${name} · live transcript</h1><div id="out"><div class="row" id="wait">Connecting…</div></div><script>
  window.log = []; window.got = [];
  const u = new URL('live', location.href); u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(u, ['live.v1', 'live.v0']); window.sock = ws;
  ws.onopen = () => { log.push('open:' + ws.protocol); ws.send(JSON.stringify({ type: 'start', meetingId: 'm1' })); };
  ws.onmessage = e => { got.push(e.data); let m; try { m = JSON.parse(e.data); } catch { return; } if (m.type !== 'words') return;
    const d = document.createElement('div'); d.className = 'row'; d.textContent = m.text; document.getElementById('out').appendChild(d); document.getElementById('wait')?.remove(); };
  ws.onerror = () => log.push('error');
  ws.onclose = e => { log.push('close:' + e.code); if (!got.length) document.getElementById('out').innerHTML = '<div class="row bad">The live transcript is not reaching this app (' + e.code + ').</div>'; };
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
    const w = document.createElement('div'); w.className = 'win'; w.id = 'w-' + id + '-' + Math.random().toString(36).slice(2, 6);
    w.innerHTML = '<header class="wbar">' + id + '</header><iframe class="appframe" ' + B.frameAttributes(url, id) + ' src="' + url + '"></iframe>';
    document.getElementById('desk').appendChild(w);
    WizAppServices.attach(w.querySelector('iframe'), { appId: id, path, isVisible: () => true });
    return w.id;
  };
</script></body></html>`;
const html = (res, body) => { res.setHeader('content-type', 'text/html'); res.end(body); };
// A small WebSocket server (RFC 6455, unfragmented frames), enough for the app's live socket.
const conns = [];   // every socket asked for: path, Origin, cookie, token, offered protocols, answer, and its end
function frame(op, payload) {
  const n = payload.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}
function upgrade(req, socket, base) {
  const u = new URL(req.url, 'http://x');
  const c = { path: u.pathname, origin: req.headers.origin || '', cookie: req.headers.cookie || '', token: req.headers['x-wizard-shell-token'] || '', offered: req.headers['sec-websocket-protocol'] || '', status: 0, ended: false, closeCode: null, texts: [], binaries: [] };
  conns.push(c);
  const refuse = code => { c.status = code; socket.end(`HTTP/1.1 ${code} No\r\n\r\n`); };
  if (c.origin !== base) return refuse(403); // the Recorder's rule: only its own public origin
  if (!/sid=owner/.test(c.cookie)) return refuse(401);
  if (!['/notes/live', '/notes/live2'].includes(c.path)) return refuse(404);
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const proto = c.offered.split(',').map(s => s.trim()).includes('live.v1') ? 'live.v1' : '';
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${proto ? 'Sec-WebSocket-Protocol: ' + proto + '\r\n' : ''}\r\n`);
  c.status = 101;
  const text = s => socket.write(frame(1, Buffer.from(s)));
  let buf = Buffer.alloc(0);
  socket.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15; let n = buf[1] & 127, at = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); at = 4; } else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); at = 10; }
      if (buf.length < at + 4 + n) return;
      const mask = buf.slice(at, at + 4), p = Buffer.from(buf.slice(at + 4, at + 4 + n));
      for (let i = 0; i < n; i++) p[i] ^= mask[i % 4];
      buf = buf.slice(at + 4 + n);
      if (op === 8) { c.closeCode = p.length >= 2 ? p.readUInt16BE(0) : 1005; c.closeReason = p.slice(2).toString(); socket.end(frame(8, p.slice(0, 2))); return; }
      if (op === 2) { c.binaries.push([...p]); socket.write(frame(2, Buffer.from([...p].reverse()))); continue; }
      if (op !== 1) continue;
      const s = p.toString(); c.texts.push(s);
      let m; try { m = JSON.parse(s); } catch { m = null; }
      if (m?.type === 'start') { text(JSON.stringify({ type: 'ready', meetingId: m.meetingId })); text(JSON.stringify({ type: 'words', text: 'Figs are in season' })); text(JSON.stringify({ type: 'words', text: 'Jan joined the call' })); continue; }
      if (m?.type === 'bye') { socket.end(frame(8, Buffer.concat([Buffer.from([0x0f, 0xa1]), Buffer.from('see you')]))); continue; } // 4001
      text('echo:' + s);
    }
  });
  socket.on('close', () => { c.ended = true; });
  socket.on('error', () => {});
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') return html(res, SHELL);
  if (u.pathname === '/notes/') return html(res, APP('Notes'));
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  server.on('upgrade', (req, socket) => upgrade(req, socket, base));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 470, height: 280 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const wid = await page.evaluate(() => openWin('notes', '/notes/', '/notes/'));
  const frameOf = async id => (await (await page.$('#' + id + ' iframe')).contentFrame());
  const f = await frameOf(wid);
  await f.waitForFunction(() => window.log, null, { timeout: 3000 });
  ok(await f.evaluate(() => self.origin) === 'null', 'the app page is opaque');
  // 1. The live socket opens with the shell's origin and the owner's cookie, and the first messages arrive.
  await f.waitForFunction(() => got.length >= 3 || log.some(l => l.startsWith('close')), null, { timeout: 4000 }).catch(() => {});
  const first = await f.evaluate(() => ({ log: log.slice(), got: got.slice(), state: sock.readyState, protocol: sock.protocol, url: sock.url }));
  const c1 = conns[0] || {};
  ok(first.log[0] === 'open:live.v1' && first.state === 1 && first.protocol === 'live.v1' && first.got.length === 3 && JSON.parse(first.got[1]).text === 'Figs are in season',
    'the app\'s live socket to its own backend opens and its messages arrive: ' + JSON.stringify(first));
  ok(c1.status === 101 && c1.origin === base && /sid=owner/.test(c1.cookie) && !c1.token && /live\.v1/.test(c1.offered) && c1.texts[0] === '{"type":"start","meetingId":"m1"}',
    'it went out with the shell\'s origin and the owner\'s cookie, never the shell token: ' + JSON.stringify({ ...c1, binaries: undefined }));
  if (SHOT) await page.screenshot({ path: SHOT });
  // 2. Text and bytes both ways, in the page's order, also with a Blob in between; binaryType picks Blob or ArrayBuffer.
  const both = await f.evaluate(async () => {
    const seen = []; const wait = n => new Promise(r => { const t = setInterval(() => { if (seen.length >= n) { clearInterval(t); r(); } }, 20); setTimeout(() => { clearInterval(t); r(); }, 3000); });
    sock.onmessage = e => seen.push(e.data);
    for (let i = 0; i < 40; i++) sock.send('m' + i);
    sock.send(new Blob([new Uint8Array([1, 2, 3])])); sock.send('after-blob');
    sock.send(new Uint8Array([9, 8, 7, 6]).subarray(1, 3));
    const buffered = sock.bufferedAmount;
    await wait(43);
    const blob = seen[40] instanceof Blob ? [...new Uint8Array(await seen[40].arrayBuffer())] : String(seen[40]);
    sock.binaryType = 'arraybuffer'; seen.length = 0;
    sock.send(new Uint8Array([5, 6]).buffer); await wait(1);
    return { blob, ab: seen[0] instanceof ArrayBuffer ? [...new Uint8Array(seen[0])] : String(seen[0]), buffered, after: sock.bufferedAmount };
  });
  const c1b = conns[0];
  const textsOk = c1b.texts.slice(1, 41).every((t, i) => t === 'm' + i) && c1b.texts[41] === 'after-blob';
  ok(textsOk && JSON.stringify(c1b.binaries.slice(0, 3)) === '[[1,2,3],[8,7],[5,6]]' && JSON.stringify(both.blob) === '[3,2,1]' && JSON.stringify(both.ab) === '[6,5]' && both.buffered > 0 && both.after === 0,
    'text and bytes go both ways in order (a Blob in its place), as Blob or ArrayBuffer: ' + JSON.stringify({ both, server: { texts: c1b.texts.length, binaries: c1b.binaries } }));
  // 3. The server closes it: the page hears its code and reason, cleanly.
  const byServer = await f.evaluate(() => new Promise(r => { sock.onclose = e => r({ code: e.code, reason: e.reason, clean: e.wasClean, state: sock.readyState }); sock.send(JSON.stringify({ type: 'bye' })); setTimeout(() => r('no close in 3 s'), 3000); }));
  ok(byServer.code === 4001 && byServer.reason === 'see you' && byServer.clean === true && byServer.state === 3, 'the server\'s close reaches the page with its code and reason: ' + JSON.stringify(byServer));
  // 4. The page's own close(code, reason) closes it at the server with that code.
  const byPage = await f.evaluate(() => new Promise(r => {
    const s = new WebSocket('live2'); s.onopen = () => s.close(4321, 'done here');
    s.onclose = e => r({ code: e.code, clean: e.wasClean, state: s.readyState }); setTimeout(() => r('no close in 3 s'), 3000);
  }));
  await page.waitForTimeout(300);
  const c2 = conns.find(c => c.path === '/notes/live2') || {};
  ok(byPage.clean === true && byPage.state === 3 && c2.closeCode === 4321 && c2.closeReason === 'done here' && c2.ended, 'close(code, reason) closes it at the server with that code: ' + JSON.stringify({ byPage, server: [c2.closeCode, c2.closeReason, c2.ended] }));
  // 5. The shell reloads the window: the old document's socket ends at the server; the new document opens its own.
  await f.evaluate(() => new Promise(r => { window.keep = new WebSocket('live2'); keep.onopen = r; setTimeout(r, 3000); }));
  const before = conns.length, oldLive = conns.find(c => c.path === '/notes/live2' && c.status === 101 && !c.ended);
  await page.evaluate(id => { document.querySelector('#' + id + ' iframe').src = '/notes/?r=1'; }, wid);
  for (let i = 0; i < 40 && conns.length === before; i++) await page.waitForTimeout(100);
  const f2 = await frameOf(wid);
  await f2.waitForFunction(() => window.got && got.length >= 3, null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
  const fresh = conns.slice(before);
  ok(!!oldLive && oldLive.ended && fresh.length === 1 && fresh[0].status === 101 && !fresh[0].ended && (await f2.evaluate(() => got.length)) >= 3 && conns.slice(0, before).every(c => c.ended),
    'a reload ends the old socket at the server and the new page opens its own: ' + JSON.stringify(conns.map(c => [c.path, c.status, c.ended])));
  // 6. Closing the window ends its socket at the server.
  const live = conns[conns.length - 1];
  await page.evaluate(id => document.getElementById(id).remove(), wid);
  for (let i = 0; i < 70 && !live.ended; i++) await page.waitForTimeout(100);
  ok(live.ended === true, 'closing the window ends its socket at the server');
  // 7. Another app's socket and an owner route go out as before (Origin null, no cookie) and are refused.
  const wid2 = await page.evaluate(() => openWin('notes', '/notes/', '/notes/'));
  const f3 = await frameOf(wid2);
  await f3.waitForFunction(() => window.got && got.length >= 3, null, { timeout: 4000 }).catch(() => {});
  const mark = conns.length;
  const away = await f3.evaluate(() => new Promise(res => {
    const out = {}; let n = 0;
    for (const [k, url] of [['other', '/other/live'], ['owner', '/wizard/v1/live']]) {
      const s = new WebSocket(url); const done = v => { if (out[k]) return; out[k] = v; if (++n === 2) res(out); };
      s.onopen = () => done('open'); s.onclose = e => done('close:' + e.code);
    }
    setTimeout(() => res(out), 3000);
  }));
  const awayConns = conns.slice(mark);
  ok(away.other === 'close:1006' && away.owner === 'close:1006', 'another app\'s socket and an owner route\'s stay closed to the app: ' + JSON.stringify(away));
  ok(awayConns.length === 2 && awayConns.every(c => c.origin === 'null' && !c.cookie && !c.token && c.status === 403), 'those went out as before: Origin null, no cookie, no token: ' + JSON.stringify(awayConns.map(c => [c.path, c.origin, c.cookie, c.token, c.status])));
  ok(!errors.length, 'no shell page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
