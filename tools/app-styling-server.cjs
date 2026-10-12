// Isolated fixture server. No production fallbacks, proxies, secrets or writes.
const http=require('http'),fs=require('fs'),path=require('path');
const WEB=path.resolve(process.argv[3]||path.join(__dirname,'../web')),PORT=Number(process.argv[2]||9505);
const ROOT='/wizard-os-home/'; let rejected=0;
const registry={schema:1,apps:[['wisdom','Wisdom','wisdom'],['wizard-music','Wizard Music','music'],['wizard-signal','Wizard Signal','signal'],['topics','Topics','topics']].map(([id,name,page])=>({id,name,url:ROOT+'demo/apps/'+page+'.html',desc:'Read-only styling sample',source:'isolated-preview'}))};
const bootstrap={bootstrap:1,settings:{owner:{name:'',place:''},agent:{name:'Wizard'},clock:{timezone:'Asia/Bangkok',day_starts_at:'00:00'},voice:{language:'en',vocabulary:[]}},capabilities:{voice:false,router:false,files:false,approvals:false,steer:false},endpoints:{apps:'/wizard/v1/apps'}};
const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.md':'text/markdown; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'none'";
function json(res,status,obj){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(obj))}
http.createServer((req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){rejected++;return json(res,403,{error:'Read-only isolated styling preview'})}
 let u;try{u=new URL(req.url,'http://fixture')}catch{return json(res,400,{error:'bad URL'})}
 if(u.pathname==='/__preview/status')return json(res,200,{isolated:true,productionProxy:false,writeRejections:rejected,root:WEB});
 if(u.pathname==='/wizard/v1/bootstrap')return json(res,200,bootstrap);
 if(u.pathname==='/wizard/v1/apps')return json(res,200,registry);
 if(u.pathname.startsWith('/wizard/')||u.pathname.startsWith('/api/'))return json(res,200,{data:[],sessions:[],items:[],threads:[],notifications:[],count:0,unread:0,hasMore:false});
 if(u.pathname==='/'||u.pathname==='/wizard-os-home'){res.writeHead(302,{location:ROOT});return res.end()}
 if(!u.pathname.startsWith(ROOT))return json(res,404,{error:'fixture not found'});
 let rel;try{rel=decodeURIComponent(u.pathname.slice(ROOT.length))||'index.html'}catch{return json(res,400,{error:'bad path'})}
 if(rel.split('/').some(x=>x==='..'||x.startsWith('.')))return json(res,404,{error:'invalid path'});
 const file=path.resolve(WEB,rel);if(!file.startsWith(WEB+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'fixture asset not found'});
 res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store','content-security-policy':csp,'permissions-policy':'microphone=(), camera=(), geolocation=()','x-wizard-preview':'app-styling-isolated'});
 if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
}).listen(PORT,'127.0.0.1',()=>console.log(`app-styling fixture ${PORT} ${WEB}`));
