// QA (video Share/Save, 18 Oct 2026): a 14 MB chat video opened in the media viewer.
// 1. The service worker leaves private media and Range requests to the browser (no respondWith passthrough).
// 2. Share on the Android app (0.9.22 bridge: void shareFile) answers the tap at once, sends the real bytes once
//    even on a double tap, and reports "Share sheet opened" instead of a false failure.
// 3. Save on the Android app hands the attachment URL to the download path and says so.
// Usage: PW=/home/telos/node_modules/playwright QA_WEB_DIR=<repo> QA_MP4=<file.mp4> node qa-video-share-save.cjs
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PW || '/home/telos/node_modules/playwright');
const WEB = path.join(process.env.QA_WEB_DIR || __dirname, 'web'), MP4 = process.env.QA_MP4;
const ID = 'cf92adfaa105030615d8f39b0d7386a6';
const UA = 'Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.0.0 Mobile Safari/537.36 WizardOS-Android/0.9.22';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x)); };
const size = fs.statSync(MP4).size;
const server = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/wizard/attachments/' + ID) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(q.headers.range || ''); let s = 0, e = size - 1, st = 200;
    if (m && (m[1] || m[2])) { s = +m[1] || 0; if (m[2]) e = Math.min(+m[2], e); st = 206; }
    r.writeHead(st, { 'Content-Type': 'video/mp4', 'Content-Disposition': 'inline; filename="the_good_times_police_ep1.mp4"', 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1, ...(st === 206 ? { 'Content-Range': `bytes ${s}-${e}/${size}` } : {}) });
    return fs.createReadStream(MP4, { start: s, end: e }).pipe(r);
  }
  if (u.pathname === '/wizard-os-home/t.html') { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end('<!doctype html><meta charset="utf-8"><body><div id="device"></div><script src="core/chat-kit.js"></script>'); }
  if (u.pathname === '/wizard-os-home/plain.txt') { r.writeHead(200, { 'Content-Type': 'text/plain' }); return r.end('x'); }
  const f = path.join(WEB, u.pathname.replace(/^\/wizard-os-home\//, ''));
  if (u.pathname.startsWith('/wizard-os-home/') && f.startsWith(WEB) && fs.existsSync(f)) { r.writeHead(200, { 'Content-Type': (f.endsWith('.js') ? 'application/javascript' : 'text/plain') + '; charset=utf-8' }); return r.end(fs.readFileSync(f)); }
  r.writeHead(404); r.end();
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const O = 'http://127.0.0.1:' + server.address().port;
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ userAgent: UA, acceptDownloads: true, viewport: { width: 412, height: 892 } });
    const p = await ctx.newPage();
    await p.goto(O + '/wizard-os-home/t.html');
    await p.evaluate(() => navigator.serviceWorker.register('sw.js', { scope: './' }).then(() => navigator.serviceWorker.ready));
    await p.reload(); await p.waitForFunction(() => !!navigator.serviceWorker.controller);
    // 1. service worker bypass
    const seen = {};
    p.on('response', r => { const n = new URL(r.url()).pathname; seen[n] = seen[n] || []; seen[n].push(r.fromServiceWorker()); });
    await p.evaluate(id => Promise.all([fetch('/wizard/attachments/' + id, { headers: { Range: 'bytes=0-99' } }).then(r => r.arrayBuffer()), fetch('/wizard/attachments/' + id).then(r => r.arrayBuffer()), fetch('plain.txt').then(r => r.text())]), ID);
    ok((seen['/wizard-os-home/plain.txt'] || []).includes(true), 'control: ordinary shell asset still goes through the service worker', seen);
    ok((seen['/wizard/attachments/' + ID] || []).length >= 2 && seen['/wizard/attachments/' + ID].every(x => !x), 'private video (full and Range) bypasses the service worker', seen);
    // 2. Share with the 0.9.22 bridge
    await p.evaluate(() => { window.calls = []; window.notes = []; window.WizardOSNative = { shareFile: (b, n, m) => { calls.push({ len: b.length, n, m, at: performance.now() }); }, shareText: () => calls.push('text') }; WosChat.K.notify = (...a) => notes.push([performance.now(), ...a]); });
    await p.evaluate(id => WosChat.viewer.open([{ url: '/wizard/attachments/' + id, name: 'the_good_times_police_ep1.mp4', mime: 'video/mp4', kind: 'video', bytes: 0 }]), ID);
    await p.evaluate(() => document.addEventListener('pointerdown', () => { window.tap = window.tap || performance.now(); }, true));
    await p.locator('.mviewer [data-mv="share"]').click(); await p.locator('.mviewer [data-mv="share"]').click();
    await p.waitForFunction(() => notes.some(n => n[2] === 'Share sheet opened'), null, { timeout: 20000 }).catch(() => {});
    const r = await p.evaluate(() => ({ calls, notes })); const t0 = await p.evaluate(() => window.tap);
    ok(r.notes[0] && r.notes[0][2] === 'Preparing to share…' && r.notes[0][0] - t0 < 300, 'tap answered at once with Preparing to share…', r.notes);
    ok(r.calls.length === 1 && r.calls[0].m === 'video/mp4' && r.calls[0].n === 'the_good_times_police_ep1.mp4', 'double tap hands the video to the native sheet exactly once, named, video/mp4', r.calls);
    ok(r.calls[0] && Math.floor(r.calls[0].len * 3 / 4) - size >= 0 && Math.floor(r.calls[0].len * 3 / 4) - size <= 2, 'native share receives the whole file', { b64: r.calls[0]?.len, size });
    ok(r.notes.some(n => n[2] === 'Share sheet opened') && !r.notes.some(n => /unavailable|Couldn/.test(n[2])), 'void 0.9.22 bridge: no false failure toast', r.notes);
    console.log('INFO tap→native shareFile ms', r.calls[0] ? Math.round(r.calls[0].at - t0) : null);
    // 3. Save
    await p.evaluate(() => { notes.length = 0; });
    const dl = p.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await p.locator('.mviewer [data-mv="save"]').click();
    const d = await dl; const notes = await p.evaluate(() => notes);
    ok(!!d && new URL(d.url()).pathname === '/wizard/attachments/' + ID, 'Save hands the real attachment URL to the download path', d && d.url());
    ok(notes.some(n => n[2] === 'Saving to Downloads'), 'Save says where the file is going', notes);
    // Back closes only the viewer
    await p.keyboard.press('Escape').catch(() => {});
  } finally { await b.close(); server.close(); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
