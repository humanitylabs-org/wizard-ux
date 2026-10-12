// Local QA origin for when the Thales tunnel (127.0.0.1:18443) is down.
// Serves <web dir> at /wizard-os-home/ and proxies READS of /wizard/* to the Wizard Agent
// Service (127.0.0.1:8923), the same backend the live origin fronts. Any non-GET/HEAD to
// /wizard/* is refused here (403) as a second fence: suites must intercept writes themselves.
// Usage: node tools/qa-origin.cjs [port=9371] [webDir=<repo>/web]
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +(process.argv[2] || process.env.QA_ORIGIN_PORT || 9371);
const WEB = path.resolve(process.argv[3] || process.env.QA_ORIGIN_WEB || path.join(__dirname, '..', 'web'));
const FALLBACK = '/home/telos/apps/wizard-os-home/web'; // data.js / summaries.js are untracked build outputs
const BACKEND = { host: '127.0.0.1', port: 8923 };
const STATIC = { '127.0.0.1:9271': '/api/' }; // voice/router endpoints of the prototype server
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.md': 'text/markdown' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
let refused = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__qa/refused') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ refused })); }
  if (u.pathname.startsWith('/wizard/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { refused++; res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"qa-origin refuses writes"}'); }
    const headers = { ...req.headers }; delete headers.host; delete headers.origin; delete headers.referer;
    const p = http.request({ ...BACKEND, method: req.method, path: req.url, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', e => { res.writeHead(502); res.end(String(e)); });
    return p.end();
  }
  if (u.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') { refused++; res.writeHead(403); return res.end('{}'); }
    const p = http.request({ host: '127.0.0.1', port: 9271, method: 'GET', path: req.url }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); });
    return p.end();
  }
  let rel = u.pathname.startsWith('/wizard-os-home/') ? u.pathname.slice('/wizard-os-home/'.length) : u.pathname === '/wizard-os-home' ? '' : null;
  // An unavailable app must stay unavailable: redirecting it to the shell nests Wizard inside an iframe.
  if (rel == null) { res.writeHead(404); return res.end('App is not available on this preview origin'); }
  rel = decodeURIComponent(rel) || 'index.html';
  if (rel.includes('..') || rel.split('/').some(s => s.startsWith('.'))) { res.writeHead(404); return res.end(); }
  let f = path.join(WEB, rel);
  if (!fs.existsSync(f)) f = path.join(FALLBACK, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': CSP, 'permissions-policy': 'microphone=(self)' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`qa-origin http://127.0.0.1:${PORT}/wizard-os-home/ → ${WEB} (reads proxied to :8923, writes refused)`));
