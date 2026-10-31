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
// Explicit isolated-service opt-in: only the migration POST, never the live backend.
if (process.env.QA_ALLOW_PREFERENCES_SEED === '1' && BACKEND.port === 8923) throw Error('Never seed live preferences from QA');
const SEED = process.env.QA_ALLOW_PREFERENCES_SEED === '1';
const APP_PREFIX = process.env.QA_READ_APP_PREFIX || '', APP_PORT = Number(process.env.QA_READ_APP_PORT || 0);
// Some installed servers own their gateway prefix; root-hosted apps keep the old default.
const APP_UPSTREAM = process.env.QA_READ_APP_UPSTREAM_PREFIX || '';
if (APP_UPSTREAM && !/^\/[a-z0-9-]+$/.test(APP_UPSTREAM)) throw Error('QA upstream prefix must be one literal app path');
if (APP_PORT && (!/^\/[a-z0-9-]+\/$/.test(APP_PREFIX) || !Number.isInteger(APP_PORT) || APP_PORT < 1 || APP_PORT > 65535)) throw Error('QA app reads need an app prefix and valid loopback port');
const STATIC = { '127.0.0.1:9271': '/api/' }; // voice/router endpoints of the prototype server
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.md': 'text/markdown' };
const CSP = "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://derp1.tailscale.com/generate_204; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
// Explicit synthetic-only interaction preview. No fixture write is ever forwarded to the backend.
const SAMPLE_ALERTS = process.env.QA_SAMPLE_ALERTS === '1';
const sampleAlerts = () => ['archive', 'done', 'unread'].map((kind, n) => ({ id: `preview-alert-${kind}`, title: `Sample · ${kind === 'unread' ? 'Mark unread' : kind === 'done' ? 'Try Done' : 'Try Archive'}`, message: 'Hold this sample alert for quick actions. Real alerts stay unchanged.', time: Math.floor(Date.now() / 1000) - n * 60, source: 'preview', priority: 3, read: kind === 'unread', archived: false }));
let alerts = sampleAlerts(), refused = 0;
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (SAMPLE_ALERTS) {
    if (req.method === 'POST' && u.pathname === '/notifications/api/mark') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(res, 413, { error: 'Sample request too large' }); }
      let d; try { d = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      if (!d || !Array.isArray(d.ids) || !d.ids.length || d.ids.some(id => !alerts.some(i => i.id === id)) || Object.keys(d).some(k => !['ids', 'read', 'archived'].includes(k)) || ['read', 'archived'].some(k => k in d && typeof d[k] !== 'boolean')) return json(res, 400, { error: 'Only sample alerts and read / archived marks are allowed' });
      alerts = alerts.map(i => d.ids.includes(i.id) ? { ...i, ...(typeof d.read === 'boolean' ? { read: d.read } : {}), ...(typeof d.archived === 'boolean' ? { archived: d.archived } : {}), ...(d.archived ? { read: true } : {}) } : i);
      return json(res, 200, { ok: true, sample: true });
    }
    if (['GET', 'HEAD'].includes(req.method)) {
      if (u.pathname === '/__qa/alerts') return json(res, 200, { sample: true, liveWrites: false, items: alerts });
      if (u.pathname === '/notifications/api/items') return json(res, 200, { items: alerts });
      if (u.pathname === '/notifications/api/count') return json(res, 200, { unread: alerts.filter(i => !i.read && !i.archived).length, needs: 0 });
      if (u.pathname === '/wizard-os-home/data.js' || u.pathname === '/wizard-os-home/summaries.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(u.pathname.endsWith('/data.js') ? 'window.WIZ_DATA={threads:[],projects:{}};' : 'window.WIZ_SUMMARIES={};'); }
      if (u.pathname === '/wizard/hermes/api/sessions') return json(res, 200, { data: [], has_more: false });
      if (u.pathname === '/wizard/v1/ui-preferences') return json(res, 200, { pinnedChats: [], spaces: [], readyOrder: 'newest', subjectOrder: [], migrations: { 'launcher.v1': true } });
      if (u.pathname === '/wizard/v1/apps') return json(res, 200, { apps: [{ id: 'notifications', name: 'Notifications', type: 'agent', source: 'apps.json' }] });
      if (u.pathname === '/wizard-os-home/' || u.pathname === '/wizard-os-home/index.html') alerts = sampleAlerts(); // Reload resets this disposable demo.
    }
  }
  const seed = SEED && req.method === 'POST' && u.pathname === '/wizard/v1/ui-preferences/seed';
  if (!['GET', 'HEAD'].includes(req.method) && !seed) { refused++; res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"qa-origin refuses writes"}'); }
  // Explicit opt-in for in-shell appearance tests of an installed app. Strip its
  // gateway prefix, forward GET/HEAD only, never cookies or owner credentials.
  if (APP_PORT && u.pathname.startsWith(APP_PREFIX)) {
    const p = http.request({ host: '127.0.0.1', port: APP_PORT, method: req.method, path: APP_UPSTREAM + '/' + u.pathname.slice(APP_PREFIX.length) + u.search }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); }); return p.end();
  }
  if (u.pathname === '/__qa/refused') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ refused })); }
  if (u.pathname.startsWith('/wizard/') || u.pathname.startsWith('/pages/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !seed) { refused++; res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"qa-origin refuses writes"}'); }
    const headers = { ...req.headers }; delete headers.host; if (headers.origin !== 'null') delete headers.origin; delete headers.referer;
    const p = http.request({ ...BACKEND, method: req.method, path: req.url, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', e => { res.writeHead(502); res.end(String(e)); });
    if (seed) return req.pipe(p);
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
}).listen(PORT, '127.0.0.1', () => console.log(`qa-origin http://127.0.0.1:${PORT}/wizard-os-home/ → ${WEB} (reads proxied to :${BACKEND.port}, writes refused${SEED ? ' except isolated launcher seed' : ''})`));
