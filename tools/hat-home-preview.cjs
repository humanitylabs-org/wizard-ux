// Durable Home-navigation preview. Candidate assets come from immutable Git blobs;
// generated phone data and explicitly enumerated read endpoints are separate sources.
const http=require('http'),https=require('https'),fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'..'),PORT=Number(process.env.HAT_PREVIEW_PORT||9520),APP_PORT=Number(process.env.HAT_APP_TUNNEL_PORT||19144);
const canonical='wizard.tailc0f369.ts.net';
const revision=cp.execFileSync('git',['-C',ROOT,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.md':'text/markdown','.ico':'image/x-icon'};
const blobs=new Map();let refused=0;
const SHELL_READS=[/^\/wizard\/(?:v1\/(?:bootstrap|apps)|thread-seen|thread-dispositions|attention|ai-usage)$/, /^\/wizard\/hermes\/api\/(?:model\/options|sessions(?:\/[^/]+(?:\/messages)?)?)$/, /^\/wizard\/hermes\/v1\/runs\/[^/]+$/, /^\/wizard\/files\/[^/]+\/(?:download|content|thumbnail)$/];
const HOST_ROOTS=['/cinequeue-next/','/meditate-next/','/messenger/','/wisdom-next/','/wizard-signal/','/wizard-search/','/wisdom/','/meditation/','/wizard-music/','/wizard-shopping/','/mizel-live/','/wizard-topics-preview/','/wizard-projects/','/wizard-calendar/','/trackhunt/','/cinequeue/','/wizard-social/','/files/','/iching/','/console/','/android-apps/'];
const HOST_READS=[/^\/wizard-shopping\/api\/(?:feed|saved|catalog|categories|image|category\/[^/]+)$/, /^\/files\/api\/(?:status|roots|list|search|file|download|thumbnail)(?:\/[^/]+)?$/, /^\/wizard-os-home\/store-data\/(?:system\/v1\/overview|wizard\/v1\/index\/search|api\/apps\/installed|logo\/[^/]+)$/];
// No broad /api or catch-all proxy: unknown API reads and all mutation paths fail closed.
function hostedRead(p){return HOST_READS.some(re=>re.test(p))||HOST_ROOTS.some(root=>p===root||p===root.slice(0,-1)||p.startsWith(root)&&!p.slice(root.length).split('/').some(x=>x.startsWith('.'))&&!p.includes('/api/')&&/\.(?:html|css|js|json|webmanifest|png|svg|ico|jpe?g|webp|woff2?|ttf|map|mp3|ogg)$/i.test(p));}
function deny(res,write=false){refused++;res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:write?'Home preview refuses all writes':'Home preview refuses unapproved read endpoint'}));}
function proxy(req,res,target,tls=false){
 const headers={...req.headers};for(const k of ['host','cookie','authorization','origin','referer','x-forwarded-host','accept-encoding'])delete headers[k];if(tls)headers.host=canonical;
 const up=(tls?https:http).request({...target,path:req.url,method:req.method,headers},r=>{
  const h={...r.headers,'cache-control':'no-store'};delete h['set-cookie'];
  if(h.location){try{const u=new URL(h.location,'https://'+canonical);if(u.hostname===canonical)h.location=u.pathname+u.search+u.hash;}catch{}}
  res.writeHead(r.statusCode,h);r.pipe(res);
 });
 up.setTimeout(15000,()=>up.destroy(new Error('upstream timeout')));up.on('error',e=>{if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:'read-only preview route unavailable',detail:e.message}));});up.end();
}
http.createServer((req,res)=>{
 let p;try{p=decodeURIComponent(new URL(req.url,'http://x').pathname);}catch{res.writeHead(400);return res.end();}
 if(!['GET','HEAD'].includes(req.method))return deny(res,true);
 if(p.split('/').some(s=>s==='..'||s.startsWith('.')))return deny(res);
 if(p==='/__preview/receipt'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify({revision,root:ROOT,port:PORT,appTunnelPort:APP_PORT,readOnly:true,immutableAssets:'git-blob',explicitReadAllowlist:true,refused}));}
 if(p==='/__preview/version.js'){res.writeHead(200,{'content-type':'application/javascript','cache-control':'no-store'});return res.end(`(()=>{const label='STAGING · Hat Home · ${revision.slice(0,8)} · read-only';const show=()=>{const e=document.getElementById('wiz-staging-tag');if(e&&e.textContent!==label)e.textContent=label;};new MutationObserver(show).observe(document.documentElement,{childList:true,subtree:true});show();})();`);}
 if(SHELL_READS.some(re=>re.test(p)))return proxy(req,res,{host:'127.0.0.1',port:8923});
 if(['/api/system/load','/api/system/devices'].includes(p))return proxy(req,res,{host:'127.0.0.1',port:9271});
 if(hostedRead(p))return proxy(req,res,{host:'127.0.0.1',port:APP_PORT,servername:canonical},true);
 if(p==='/wizard-os-home'){res.writeHead(302,{location:'/wizard-os-home/'});return res.end();}
 if(p.startsWith('/wizard-os-home/')){
  const rel=p.slice('/wizard-os-home/'.length)||'index.html';
  if(rel==='ux-version.txt'){res.writeHead(200,{'content-type':'text/plain','cache-control':'no-store'});return res.end(revision+'\n');}
  let body;
  try{
   if(['data.js','summaries.js'].includes(rel))body=fs.readFileSync('/home/telos/apps/wizard-os-home/web/'+rel);
   else{if(!blobs.has(rel))blobs.set(rel,cp.execFileSync('git',['-C',ROOT,'cat-file','blob',revision+':web/'+rel],{maxBuffer:16*1024*1024,stdio:['ignore','pipe','ignore']}));body=blobs.get(rel);}
  }catch{res.writeHead(404);return res.end();}
  const ext=path.extname(rel),h={'content-type':types[ext]||'application/octet-stream','cache-control':'no-store','permissions-policy':'microphone=(self)','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
  res.writeHead(200,h);if(req.method==='HEAD')return res.end();
  if(ext==='.html')return res.end(body.toString('utf8').replace(/<head([^>]*)>/i,'<head$1><script src="/__preview/version.js"></script>'));return res.end(body);
 }
 return deny(res);
}).listen(PORT,'127.0.0.1',()=>console.log(JSON.stringify({preview:'hat-home',revision,root:ROOT,port:PORT,appTunnelPort:APP_PORT,readOnly:true,immutableAssets:'git-blob',explicitReadAllowlist:true})));
