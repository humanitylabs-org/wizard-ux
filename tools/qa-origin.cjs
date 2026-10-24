// Local QA origin for when the Thales tunnel (127.0.0.1:18443) is down.
// Serves <web dir> at /wizard-os-home/ and proxies READS of /wizard/* and /pages/* to the Wizard Agent
// Service (127.0.0.1:8923), the same backend the live origin fronts. Any non-GET/HEAD to
// /wizard/* is refused here (403) as a second fence: suites must intercept writes themselves.
// Usage: node tools/qa-origin.cjs [port=9371] [webDir=<repo>/web]
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +(process.argv[2] || process.env.QA_ORIGIN_PORT || 9371);
const WEB = path.resolve(process.argv[3] || process.env.QA_ORIGIN_WEB || path.join(__dirname, '..', 'web'));
const FALLBACK = process.env.WIZARD_UX_FALLBACK_WEB || WEB; // optional untracked data.js / summaries.js build outputs
// Remote browser workers can tunnel the same read-only backend onto a different loopback port.
const BACKEND = { host: '127.0.0.1', port: Number(process.env.QA_BACKEND_PORT || 8923) };
const APP_PREFIX = process.env.QA_READ_APP_PREFIX || '', APP_PORT = Number(process.env.QA_READ_APP_PORT || 0);
if (APP_PORT && (!/^\/[a-z0-9-]+\/$/.test(APP_PREFIX) || !Number.isInteger(APP_PORT) || APP_PORT < 1 || APP_PORT > 65535)) throw Error('QA app reads need an app prefix and valid loopback port');
const STATIC = { '127.0.0.1:9271': '/api/' }; // voice/router endpoints of the prototype server
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.md': 'text/markdown' };
const CSP = "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
let refused = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!['GET', 'HEAD'].includes(req.method)) { refused++; res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"qa-origin refuses writes"}'); }
  // Explicit opt-in for in-shell appearance tests of an installed app. Strip its
  // gateway prefix, forward GET/HEAD only, never cookies or owner credentials.
  if (APP_PORT && u.pathname.startsWith(APP_PREFIX)) {
    const p = http.request({ host: '127.0.0.1', port: APP_PORT, method: req.method, path: '/' + u.pathname.slice(APP_PREFIX.length) + u.search }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); }); return p.end();
  }
  if (u.pathname === '/__qa/refused') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ refused })); }
  if (u.pathname.startsWith('/wizard/') || u.pathname.startsWith('/pages/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { refused++; res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"qa-origin refuses writes"}'); }
    const headers = { ...req.headers }; delete headers.host; if (headers.origin !== 'null') delete headers.origin; delete headers.referer;
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
  if (rel == null) { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end(); }
  rel = decodeURIComponent(rel) || 'index.html';
  if (rel.includes('..') || rel.split('/').some(s => s.startsWith('.'))) { res.writeHead(404); return res.end(); }
  let f = path.join(WEB, rel);
  if (!fs.existsSync(f)) f = path.join(FALLBACK, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': CSP, 'permissions-policy': 'microphone=(self)' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`qa-origin http://127.0.0.1:${PORT}/wizard-os-home/ → ${WEB} (reads proxied to :8923, writes refused)`));
