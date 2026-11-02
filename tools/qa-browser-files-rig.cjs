// Shared rig for the Files browser-trust QA (wizard-os #385/#386): real Agent Service + real WAM state + an https
// shell stand-in on one synthetic host name, so every listener is its own origin on the SAME site, as on a tailnet box
// (https://<box>:<port>). Chromium maps the name to 127.0.0.1; a throwaway self-signed certificate covers it.
// The stand-in applies packaging/browser-boundary-document.conf.template (nginx is absent here; said in the evidence).
// Synthetic data only; never a live box.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), https = require('node:https');
const crypto = require('node:crypto'), { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url');

const HOST = 'box.test';
const listen = (server, port = 0) => new Promise(r => server.listen(port, '127.0.0.1', () => r(server.address().port)));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
const freePort = async () => { const s = http.createServer(); const p = await listen(s); await close(s); return p; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function certificate(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=' + HOST, '-addext', 'subjectAltName=DNS:' + HOST], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

/** raw node:http(s) request (no fetch: it would drop Host), never through the browser. */
function raw(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise(resolve => {
    const u = new URL(url), lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ host: '127.0.0.1', port: u.port, path: u.pathname + u.search, method, headers: { host: u.host, ...headers }, rejectUnauthorized: false }, res => {
      const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', e => resolve({ status: 0, error: e.code })); req.end(body);
  });
}

async function startService({ out, serviceRoot, box, token, ownerProof, content = null }) {
  const { createWizardServer } = await import(pathToFileURL(path.join(serviceRoot, 'server/service.mjs')));
  const { createHermesFixture } = await import(pathToFileURL(path.join(serviceRoot, 'server/fixture.mjs')));
  const hermes = createHermesFixture({ expectedKey: 'boundary-fixture-only' }); const hp = await listen(hermes);
  const svcHome = path.join(out, 'service-home'); fs.mkdirSync(svcHome, { recursive: true });
  const options = { upstreamOrigin: `http://127.0.0.1:${hp}`, hermesKey: 'boundary-fixture-only', requireAccess: false, ownerProof,
    browserBoundary: { enabled: true, token }, hermesHome: path.join(svcHome, 'hermes'), wizardOsHome: path.join(box, 'home'),
    appsJsonPath: path.join(box, 'home/apps.json'), settingsPath: path.join(svcHome, 'settings.json'), launcherPath: path.join(svcHome, 'launcher.json'),
    agentBridge: false, followThrough: false, joinedDelegation: 'off',
    browserAdapterWam: { receiptsPath: path.join(out, 'service-state/receipts.json'), ...(content ? { content } : {}) } };
  return { createWizardServer, options, hermes };
}

/** The shell document stand-in (template headers + token injection) on https://box.test:<port>. */
function shellProxy({ tls, web, token, ownerProof, servicePort, routes = {}, record = () => {} }) {
  const tpl = fs.readFileSync(path.join(web, '../packaging/browser-boundary-document.conf.template'), 'utf8');
  const docHeaders = [...tpl.matchAll(/add_header ([A-Za-z-]+) "([^"]*)" always;/g)].map(m => [m[1], m[2]]);
  const inject = tpl.match(/sub_filter '<head>' '([^']*)';/)[1].replace('${WIZARD_SHELL_TOKEN}', token).replace('${WIZARD_RECOVERY_TOKEN}', '');
  const serveFile = (res, file) => { if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file)); };
  const forward = (req, res, port, headers, rec) => {
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, r => { if (rec) rec.status = r.statusCode; res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up);
  };
  return https.createServer(tls, (req, res) => {
    const u = new URL(req.url, 'https://' + HOST), p = u.pathname;
    const doc = p.match(/^\/(?:wizard-os-home|wizard-ux)\/(|index\.html|desktop\.html)$/);
    if (doc) {
      if (req.headers['sec-fetch-dest'] !== 'document' || req.headers['sec-fetch-mode'] !== 'navigate' || req.method !== 'GET') { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('navigation only'); }
      const html = fs.readFileSync(path.join(web, doc[1] || 'index.html'), 'utf8').replace('<head>', '<head>' + inject);
      res.writeHead(200, { 'Content-Type': 'text/html', ...Object.fromEntries(docHeaders) }); return res.end(html);
    }
    if (p.startsWith('/wizard-os-home/')) return serveFile(res, path.join(web, path.normalize(p.slice('/wizard-os-home/'.length)).replace(/^(\.\.[/\\])+/, '')));
    if (p.startsWith('/wizard/')) return forward(req, res, servicePort, { ...req.headers, 'x-wizard-owner-proof': ownerProof });
    for (const [prefix, route] of Object.entries(routes)) {
      if (!p.startsWith(prefix)) continue;
      const rec = { via: 'shell-origin', method: req.method, path: p, site: req.headers['sec-fetch-site'] || '', dest: req.headers['sec-fetch-dest'] || '', mode: req.headers['sec-fetch-mode'] || '', origin: req.headers.origin ?? '', cookie: req.headers.cookie !== undefined };
      record(rec);
      if (route.static) return serveFile(res, path.join(route.static, p.slice(prefix.length) || 'index.html'));
      // Tailscale Serve keeps Host and adds the owner's login and X-Forwarded-*.
      return forward(req, res, route.port, { ...req.headers, 'tailscale-user-login': 'owner@example.com', 'tailscale-user-name': 'Owner', 'x-forwarded-for': '100.64.0.7', 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host }, rec);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
  });
}

/** Tailscale Serve stand-in for an app's OWN https port: keeps Host, adds the owner login; records the listener's answer. */
function serveStandIn({ tls, upstreamPort, record = () => {} }) {
  return https.createServer(tls, (req, res) => {
    const rec = { via: 'own-origin', method: req.method, path: new URL(req.url, 'https://' + HOST).pathname, site: req.headers['sec-fetch-site'] || '', dest: req.headers['sec-fetch-dest'] || '', mode: req.headers['sec-fetch-mode'] || '', origin: req.headers.origin ?? '', cookie: /(^|;\s*)auth=/.test(req.headers.cookie || ''), at: Date.now() };
    record(rec);
    const up = http.request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers: { ...req.headers, 'tailscale-user-login': 'owner@example.com', 'tailscale-user-name': 'Owner', 'x-forwarded-for': '100.64.0.7', 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host } }, r => { rec.status = r.statusCode; rec.xfo = r.headers['x-frame-options'] || ''; res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { rec.status = 502; res.writeHead(502); res.end(); }); req.pipe(up);
  });
}

module.exports = { HOST, listen, close, freePort, sleep, certificate, raw, startService, shellProxy, serveStandIn, crypto };
