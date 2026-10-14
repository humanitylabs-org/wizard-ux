// Staging front for shell previews that need hosted apps inside desks (bound views, framed apps).
// /wizard-os-home/*, /wizard/*, /api/* → the preview's qa-origin (shell from the worktree, real reads, writes refused).
// Every other path (hosted apps: /meditation/, /wisdom/, /wizard-music/ …) → READ-ONLY pass-through to the live private
// gateway on loopback, so a framed app loads exactly as on the live origin. Any non-GET/HEAD there is refused (403).
// Usage: node tools/stage-front.cjs <port> <qa-origin-port>
// The live Wizard's names come from Wizard OS settings (network.base_url + network.aliases in $WIZARD_SETTINGS_PATH,
// default ~/.wizard-os/settings.json); WIZARD_STAGE_SERVERNAME overrides the TLS name sent to the gateway.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = +process.argv[2] || 9560, QA = +process.argv[3] || 9482;
const NET = (() => { try { return JSON.parse(fs.readFileSync(process.env.WIZARD_SETTINGS_PATH || path.join(process.env.WIZARD_OS_HOME || path.join(os.homedir(), '.wizard-os'), 'settings.json'), 'utf8')).network || {}; } catch (e) { return {}; } })();
const hostOf = v => String(v || '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/[/?#:].*$/, '');
const HOME_HOSTS = [hostOf(NET.base_url), ...(Array.isArray(NET.aliases) ? NET.aliases.map(hostOf) : [])].filter(h => /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(h));
const GW = { host: '127.0.0.1', port: 19445, servername: process.env.WIZARD_STAGE_SERVERNAME || HOME_HOSTS[0] || 'localhost' };
const HOME_RE = HOME_HOSTS.length ? new RegExp('^https://(' + HOME_HOSTS.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(:\\d+)?', 'i') : null;
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
    if (h.location && HOME_RE) h.location = String(h.location).replace(HOME_RE, '');
    res.writeHead(r.statusCode, h); r.pipe(res);
  });
  p.on('error', e => { res.writeHead(502); res.end(String(e)); });
  p.end();
}).listen(PORT, '127.0.0.1', () => console.log(`stage-front :${PORT} → shell/API :${QA}, hosted apps read-only via gateway`));
