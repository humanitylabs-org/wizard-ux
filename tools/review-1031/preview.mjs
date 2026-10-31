// review-1031: one isolated, synthetic review for James (31 Oct 2026). No live upstream, no credentials.
//   /wizard-os-home/  shell snapshot: Look "keep own skins" variant (default) or "#768 as built" (?look=768; ?look=keep back)
//   /wisdom/          Wisdom (wisdom-history feature/shell-selection-menu-1031), starter library, temp data
//   /field-notes/     synthetic app with no selection code (default Reply in chat)
//   /wizard/*         tools/agents-fixture.mjs: in-memory main agent + Private agent, synthetic threads (seed private,changes)
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';

const HERE = resolve(process.env.PREVIEW_DIR || new URL('.', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 9573), FIX = PORT + 1000, WIS = PORT + 1001;
const STATE = join(HERE, 'state'); mkdirSync(STATE, { recursive: true });
const WEB = { keep: join(HERE, 'keep/web'), asbuilt: join(HERE, 'asbuilt/web') };
const SHA = v => { try { return readFileSync(join(HERE, v, 'SHA'), 'utf8').trim(); } catch { return ''; } };
const kids = [];
const run = (cmd, args, env = {}) => { const p = spawn(cmd, args, { cwd: HERE, env: { ...process.env, ...env }, stdio: 'inherit' }); kids.push(p); p.on('exit', c => { console.error(cmd, 'exited', c); process.exit(1); }); return p; };
run(process.execPath, [join(HERE, 'keep/agents-fixture.mjs'), String(FIX), WEB.keep, '--main=fixture', '--seed=private,changes', '--binding-apps=field-notes:Field Notes:Synthetic notes']);
const wdata = join(STATE, 'wisdom'); rmSync(wdata, { recursive: true, force: true }); mkdirSync(wdata + '/data', { recursive: true }); mkdirSync(wdata + '/lib', { recursive: true });
run('python3', [join(HERE, 'wisdom/server.py')], { WISDOM_DATA: wdata + '/data', WISDOM_LIBRARY: wdata + '/lib', WISDOM_SEED_STARTER: '1', WISDOM_ADMIT: 'disabled', WISDOM_BASE: '/wisdom', WISDOM_PORT: String(WIS), PYTHONDONTWRITEBYTECODE: '1' });

const APPS = { apps: [
  { id: 'wisdom', name: 'Wisdom', url: '/wisdom/', icon: 'W', colors: ['#c9a227', '#7a4b12'], desc: 'Synthetic starter library', source: 'apps.json', type: 'view', category: 'app' },
  { id: 'field-notes', name: 'Field Notes', url: '/field-notes/', icon: 'F', colors: ['#3fe0ff', '#3f6bff'], desc: 'Synthetic app with no selection code', source: 'apps.json', type: 'view', category: 'app' },
] };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
const look = req => /(?:^|;\s*)wz_look=768(?:;|$)/.test(req.headers.cookie || '') ? 'asbuilt' : 'keep';
function file(res, root, rel, method) {
  const f = resolve(root, rel || 'index.html');
  if (!f.startsWith(root + sep) || rel.split('/').some(p => p.startsWith('.')) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': CSP, 'permissions-policy': 'microphone=(), camera=()' });
  res.end(method === 'HEAD' ? undefined : readFileSync(f));
}
function proxy(req, res, port) {
  const headers = { ...req.headers }; delete headers.host; delete headers.origin; delete headers.referer;
  const p = request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', () => { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"Preview dependency unavailable"}'); });
  req.pipe(p);
}
const front = createServer((req, res) => {
  const u = new URL(req.url, 'http://preview');
  const json = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/__preview/receipt') return json({ synthetic: true, liveUpstream: false, look: look(req), keep: SHA('keep'), asbuilt: SHA('asbuilt'), wisdom: SHA('wisdom') });
  // ?look=768 / ?look=keep picks which Settings › Look James sees; the rest of the review is identical in both.
  const pick = u.searchParams.get('look');
  if (pick === '768' || pick === 'keep') {
    u.searchParams.delete('look');
    res.writeHead(302, { 'set-cookie': `wz_look=${pick}; Path=/; SameSite=Lax; Secure; Max-Age=604800`, location: u.pathname + (u.search || '') , 'cache-control': 'no-store' });
    return res.end();
  }
  if (u.pathname === '/') { res.writeHead(302, { location: '/__preview/' }); return res.end(); }
  if (u.pathname === '/__preview/' || u.pathname === '/__preview/index.html') return file(res, HERE, 'review.html', req.method);
  if (u.pathname === '/__preview/review.css') return file(res, HERE, 'review.css', req.method);
  // The actual registry waits for bootstrap.endpoints.apps, not a hard-coded apps path.
  if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, settings: { owner: { name: 'Demo reviewer' }, agent: { name: 'Atlas' }, clock: { timezone: 'UTC', day_starts_at: '00:00' } }, capabilities: { markdown: true }, endpoints: { apps: '/wizard/v1/apps' } });
  if (u.pathname === '/wizard/v1/apps') return json(APPS);
  // Own skins are kept on this device in the preview (an older-box answer): nothing is written to any Wizard.
  if (u.pathname.startsWith('/wizard/v1/skins') || u.pathname.startsWith('/wizard/v1/my-skin')) return json({}, 404);
  if (u.pathname === '/wisdom' || u.pathname.startsWith('/wisdom/')) return proxy(req, res, WIS);
  if (u.pathname === '/field-notes') { res.writeHead(302, { location: '/field-notes/' }); return res.end(); }
  if (u.pathname.startsWith('/field-notes/')) return file(res, join(HERE, 'field-notes'), decodeURIComponent(u.pathname.slice('/field-notes/'.length)), req.method);
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
    if (rel === 'sw.js') { res.writeHead(404); return res.end(); }
    if (rel === 'data.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end('window.WIZ_DATA={projects:{},threads:[]};'); }
    if (rel === 'summaries.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end('window.WIZ_SUMMARIES={};'); }
    if (rel === 'ux-version.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(SHA(look(req))); }
    return file(res, WEB[look(req)], rel.endsWith('/') ? rel + 'index.html' : rel, req.method);
  }
  if (u.pathname.startsWith('/wizard/') || u.pathname.startsWith('/__fixture/') || u.pathname.startsWith('/wizard-tinfoil/')) return proxy(req, res, FIX);
  return json({ error: 'Not part of this synthetic review' }, 404);
});
front.on('upgrade', (_, s) => s.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
front.listen(PORT, '127.0.0.1', () => console.log('review-1031 listening', PORT));
process.on('SIGTERM', () => { for (const k of kids) { k.removeAllListeners('exit'); k.kill('SIGTERM'); } front.close(() => process.exit(0)); });
