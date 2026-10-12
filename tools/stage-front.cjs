// Staging front for shell previews that need hosted apps inside desks (bound views, framed apps).
// /wizard-os-home/*, /wizard/*, /api/* → the preview's qa-origin (shell from the worktree, real reads, writes refused).
// Every other path (hosted apps: /meditation/, /wisdom/, /wizard-music/ …) → READ-ONLY pass-through to the live private
// gateway on loopback, so a framed app loads exactly as on the live origin. Any non-GET/HEAD there is refused (403).
// Usage: node tools/stage-front.cjs <port> <qa-origin-port>
const http = require('http'), https = require('https');
const PORT = +process.argv[2] || 9560, QA = +process.argv[3] || 9482;
const GW = { host: '127.0.0.1', port: 19445, servername: 'wizard.tailc0f369.ts.net' };
const SHELL = /^\/(wizard-os-home|wizard|api|__qa)(\/|$)/;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (SHELL.test(u.pathname) || u.pathname === '/') {
    const p = http.request({ host: '127.0.0.1', port: QA, method: req.method, path: req.url, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', e => { res.writeHead(502); res.end(String(e)); });
    return req.pipe(p);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"staging preview: hosted apps are read-only"}'); }
  const headers = { ...req.headers, host: GW.servername }; delete headers.origin; delete headers.referer;
  const p = https.request({ ...GW, method: req.method, path: req.url, headers, rejectUnauthorized: false }, r => {
    const h = { ...r.headers };
    if (h.location) h.location = String(h.location).replace(/^https:\/\/(wizard\.tailc0f369\.ts\.net|private\.wizard001\.com)(:\d+)?/, '');
    res.writeHead(r.statusCode, h); r.pipe(res);
  });
  p.on('error', e => { res.writeHead(502); res.end(String(e)); });
  p.end();
}).listen(PORT, '127.0.0.1', () => console.log(`stage-front :${PORT} → shell/API :${QA}, hosted apps read-only via gateway`));
