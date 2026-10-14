// Durable, read-only Home-navigation preview. Serve only this committed checkout;
// generated phone data and authorized API/app reads are explicit separate sources.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.HAT_PREVIEW_PORT || 9520);
const APP_PORT = Number(process.env.HAT_APP_TUNNEL_PORT || 19144);
const canonical = 'wizard.tailc0f369.ts.net';
const revision = cp.execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const types = { '.js':'application/javascript', '.css':'text/css', '.html':'text/html', '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.md':'text/markdown', '.ico':'image/x-icon' };
let refused = 0;
function proxy(req, res, target, tls = false) {
 const headers = {...req.headers};
 for (const k of ['host','cookie','authorization','origin','referer','x-forwarded-host','accept-encoding']) delete headers[k];
 if (tls) headers.host = canonical;
 const up = (tls ? https : http).request({...target, path:req.url, method:req.method, headers}, r => {
  const h = {...r.headers, 'cache-control':'no-store'}; delete h['set-cookie'];
  if (h.location) { try { const u = new URL(h.location, 'https://'+canonical); if(u.hostname === canonical) h.location = u.pathname+u.search+u.hash; } catch {} }
  res.writeHead(r.statusCode, h); r.pipe(res);
 });
 up.setTimeout(15000, () => up.destroy(new Error('upstream timeout')));
 up.on('error', e => { if (!res.headersSent) res.writeHead(502, {'content-type':'application/json'}); res.end(JSON.stringify({error:'read-only preview route unavailable', detail:e.message})); });
 up.end();
}
http.createServer((req,res) => {
 let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
 if (!['GET','HEAD'].includes(req.method)) { refused++; res.writeHead(403, {'content-type':'application/json'}); return res.end('{"error":"Home preview refuses all writes"}'); }
 if (p === '/__preview/receipt') { res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'}); return res.end(JSON.stringify({revision,root:ROOT,port:PORT,appTunnelPort:APP_PORT,readOnly:true,refused})); }
 if (p === '/__preview/version.js') { res.writeHead(200, {'content-type':'application/javascript','cache-control':'no-store'}); return res.end(`(()=>{const show=()=>{const e=document.getElementById('wiz-staging-tag');if(!e)return false;e.textContent='STAGING · Hat Home · ${revision.slice(0,8)} · read-only';return true;};if(!show()){const o=new MutationObserver(()=>{if(show())o.disconnect();});o.observe(document.documentElement,{childList:true,subtree:true});}setTimeout(show,800);})();`); }
 if (p.startsWith('/wizard/')) return proxy(req,res,{host:'127.0.0.1',port:8923});
 if (p.startsWith('/api/')) return proxy(req,res,{host:'127.0.0.1',port:9271});
 if (p === '/wizard-os-home') { res.writeHead(302,{location:'/wizard-os-home/'}); return res.end(); }
 if (p.startsWith('/wizard-os-home/')) {
  const rel = p.slice('/wizard-os-home/'.length) || 'index.html';
  if (rel.split('/').some(s=>s==='..'||s.startsWith('.'))) { res.writeHead(404); return res.end(); }
  // No mutable fallback for candidate JS/CSS. These two generated read-data files
  // are intentionally supplied by the authorized running shell, not source overlays.
  const file = ['data.js','summaries.js'].includes(rel) ? '/home/telos/apps/wizard-os-home/web/'+rel : path.join(ROOT,'web',rel);
  if (!fs.existsSync(file)||!fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const ext=path.extname(file),h={'content-type':types[ext]||'application/octet-stream','cache-control':'no-store','permissions-policy':'microphone=(self)'};
  h['content-security-policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  res.writeHead(200,h);
  if(req.method==='HEAD') return res.end();
  if(ext === '.html') return res.end(fs.readFileSync(file,'utf8').replace(/<head([^>]*)>/i,'<head$1><script src="/__preview/version.js"></script>'));
  return fs.createReadStream(file).pipe(res);
 }
 return proxy(req,res,{host:'127.0.0.1',port:APP_PORT,servername:canonical},true);
}).listen(PORT,'127.0.0.1',()=>console.log(JSON.stringify({preview:'hat-home',revision,root:ROOT,port:PORT,appTunnelPort:APP_PORT,readOnly:true})));
