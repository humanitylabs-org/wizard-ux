// Private preview only: immutable shell, deployment meta, real same-origin hosted-app reads.
// Bind loopback behind wizard-stage. Environment supplies all owner-specific routes.
// No write forwarding, WebSocket upgrade, cookie forwarding or redirect following.
const http = require('node:http'), https = require('node:https'), fs = require('node:fs'), path = require('node:path');
const web = path.resolve(process.env.PREVIEW_WEB || ''), port = Number(process.env.PORT);
const upstream = new URL(process.env.PREVIEW_UPSTREAM), connectPort = Number(process.env.PREVIEW_UPSTREAM_PORT);
if (!process.env.PREVIEW_WEB || !port || upstream.protocol !== 'https:' || !connectPort) throw Error('Configure PREVIEW_WEB, PORT, PREVIEW_UPSTREAM and PREVIEW_UPSTREAM_PORT');
const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
let refused = 0;
http.createServer((req, res) => {
  if (!['GET','HEAD'].includes(req.method)) { refused++; res.writeHead(403, { 'content-type':'application/json' }); return res.end('{"error":"Read-only skin preview: writes are disabled"}'); }
  const u = new URL(req.url, 'http://preview');
  if (u.pathname === '/__preview/receipt') { res.setHeader('content-type','application/json'); return res.end(JSON.stringify({sha:process.env.PREVIEW_SHA,readOnly:true,refused})); }
  if (u.pathname === '/wizard-os-home/ux-version.txt') { res.writeHead(200, {'content-type':'text/plain','cache-control':'no-store'}); return res.end(process.env.PREVIEW_SHA + '\n'); }
  if (u.pathname === '/') { res.writeHead(302,{location:'/wizard-os-home/?open=wisdom'}); return res.end(); }
  if (u.pathname.startsWith('/wizard-os-home/')) {
    let rel; try { rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html'; } catch { res.writeHead(400); return res.end(); }
    if (rel.split('/').some(s => s === '..' || s.startsWith('.'))) { res.writeHead(404); return res.end(); }
    let file = path.resolve(web, rel);
    if (!file.startsWith(web + path.sep)) { res.writeHead(404); return res.end(); }
    if (!fs.existsSync(file) && ['data.js','summaries.js'].includes(rel) && process.env.PREVIEW_GENERATED) file = path.join(process.env.PREVIEW_GENERATED,rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream','cache-control':'no-store','content-security-policy':csp,'permissions-policy':'microphone=()' });
    if (req.method === 'HEAD') return res.end();
    if (['index.html','desktop.html'].includes(rel)) return res.end(fs.readFileSync(file,'utf8').replace('<head>','<head>\n<meta name="wos-frame-preview" content="borderless">'));
    return fs.createReadStream(file).pipe(res);
  }
  const p = https.request({ hostname:'127.0.0.1', port:connectPort, servername:upstream.hostname, method:req.method, path:req.url,
    headers:{ host:upstream.host, accept:req.headers.accept || '*/*', ...(req.headers.range ? {range:req.headers.range} : {}) } }, r => {
      const headers = {...r.headers}; delete headers['set-cookie']; headers['cache-control']='no-store';
      // Same-origin redirects stay in this read-only gateway; foreign redirects are refused.
      if (headers.location) { const target = new URL(headers.location,upstream); if (target.origin !== upstream.origin) { r.resume(); res.writeHead(502); return res.end('External redirect disabled in preview'); } headers.location=target.pathname+target.search+target.hash; }
      res.writeHead(r.statusCode,headers); r.pipe(res);
    });
  p.setTimeout(20000, () => p.destroy(new Error('upstream timeout')));
  p.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Preview read upstream unavailable'); });
  p.end();
}).listen(port,'127.0.0.1',()=>console.log(`Read-only skin preview ${process.env.PREVIEW_SHA} on ${port}`));
