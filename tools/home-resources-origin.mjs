// Read-only Home resource preview front. Token stays server-side. Browser sees only allowlisted numbers.
// GET /api/system/load follows Miguel/Oscar's Runtipi resource source; all other reads go to qa-origin.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
const PORT=Number(process.argv[2]),UP=Number(process.argv[3]);
const env=Object.fromEntries(readFileSync(join(homedir(),'runtipi/.env'),'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const origin=`http://${env.INTERNAL_IP||'127.0.0.1'}:${env.NGINX_PORT||80}`;
function token(){const now=Math.floor(Date.now()/1000),b=j=>Buffer.from(JSON.stringify(j)).toString('base64url'),h=b({alg:'HS256',typ:'JWT'}),p=b({sub:'cli',iat:now,nbf:now,exp:now+60});return `${h}.${p}.${createHmac('sha256',env.JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`;}
let refused=0;
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(!['GET','HEAD'].includes(req.method)){refused++;res.writeHead(403,{'content-type':'application/json'});return res.end('{"error":"preview_read_only"}');}
 if(u.pathname==='/__qa/home-review.js'){res.writeHead(200,{'content-type':'application/javascript','cache-control':'no-store'});return res.end("try{localStorage.setItem('wos.coached','true')}catch(e){};window.addEventListener('load',()=>window.__wos?.goDesk(0,true));");}
 if(u.pathname==='/__qa/resource-front'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({refused}));}
 if(u.pathname==='/api/system/load'){
  try{const r=await fetch(origin+u.pathname,{headers:{Authorization:`Bearer ${token()}`},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('upstream unavailable');const j=await r.json(),out={};for(const key of ['cpuLoad','percentUsedMemory','percentUsed','memoryTotal','diskUsed','diskSize'])out[key]=typeof j[key]==='number'&&Number.isFinite(j[key])?j[key]:null;res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(out));}
  catch{res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});return res.end('{"error":"server_resources_unavailable"}');}
 }
 const headers={...req.headers};if(u.searchParams.get('review')==='home')delete headers['accept-encoding'];
 const p=http.request({host:'127.0.0.1',port:UP,method:req.method,path:req.url,headers},r=>{if(u.searchParams.get('review')==='home'&&String(r.headers['content-type']).includes('text/html')){let body='';r.setEncoding('utf8');r.on('data',d=>body+=d);r.on('end',()=>{const h={...r.headers,'cache-control':'no-store'};delete h['content-length'];delete h.etag;res.writeHead(r.statusCode,h);res.end(body.replace('</head>','<script src="/__qa/home-review.js"></script></head>'));});}else{res.writeHead(r.statusCode,r.headers);r.pipe(res);}});p.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(p);
}).listen(PORT,'127.0.0.1',()=>console.log(`Home resource preview :${PORT} → read-only origin :${UP}`));
