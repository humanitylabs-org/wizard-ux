// Private preview ONLY. Separate loopback front; no production/Caddy changes.
import http from 'node:http';
import { PREFIX } from './store-data-origin.mjs';
const PORT=Number(process.argv[2]||9583), SHELL=Number(process.argv[3]||9585), DATA=Number(process.argv[4]||9584);
http.createServer((req,res)=>{
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(403,{'Content-Type':'application/json'}); res.end('{"error":"preview refuses writes"}'); return; }
  const raw=req.url.split('?')[0];
  let decoded; try { decoded=decodeURIComponent(raw); } catch (_) { res.writeHead(400); res.end(); return; }
  if (decoded.split('/').some(s=>s==='..'||s==='.') || /%2f|%5c|%25/i.test(raw) || decoded.includes('\\')) { res.writeHead(400); res.end(); return; }
  const u=new URL(req.url,'http://localhost');
  const data=u.pathname.startsWith(PREFIX);
  if (!data && !u.pathname.startsWith('/wizard-os-home/') && !u.pathname.startsWith('/wizard/')) { res.writeHead(404); res.end(); return; }
  if (u.pathname === '/wizard-os-home/store/') req.url=req.url.replace('/store/','/store/index.html');
  if (u.pathname === '/wizard-os-home/sw.js') { res.writeHead(404); res.end(); return; }
  const headers={...req.headers}; delete headers.host; delete headers.origin; delete headers.referer;
  const p=http.request({host:'127.0.0.1',port:data?DATA:SHELL,method:req.method,path:req.url,headers},r=>{
    const h={...r.headers};
    if (u.pathname.startsWith('/wizard-os-home/store/')) h['content-security-policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
    res.writeHead(r.statusCode,h); r.pipe(res);
  });
  p.on('error',()=>{res.writeHead(502);res.end();}); p.end();
}).listen(PORT,'127.0.0.1',()=>console.log(`Store-window private front :${PORT}, shell :${SHELL}, read data :${DATA}`));
