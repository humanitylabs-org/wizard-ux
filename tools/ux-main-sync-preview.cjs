// Convergence-only synthetic preview adapter. NOT a production Service replacement.
// No upstream, files outside the immutable source, private agents, sockets or inference.
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const WEB=fs.realpathSync(process.env.PREVIEW_WEB||path.join(__dirname,'../web'));
const PORT=Number(process.env.PORT||9590),SHA=process.env.PREVIEW_SHA||'unversioned';
const APPS=[{id:'synthetic-reader',name:'Sample Reader',url:'/synthetic-reader/',kind:'app',type:'service',source:'fixture',status:'running',view:{mode:'original',url:'/synthetic-reader/'}},{id:'synthetic-calendar',name:'Sample Calendar',url:'/synthetic-calendar/',kind:'app',type:'service',source:'fixture',status:'running'}];
const NOW=1793707200,THREADS=[{id:'synthetic-convergence',title:'Sample shared-main conversation',source:'api_server',model:'fixture',message_count:2,preview:'Synthetic only — no real account or message.',last_active:NOW,started_at:NOW-60}];
const MESSAGES=[{id:1,role:'user',content:'Show the shared shell without using private data.',timestamp:NOW-60},{id:2,role:'assistant',content:'This is a synthetic convergence preview. Sending is disabled. The running phone and daily services are unchanged.',timestamp:NOW}];
const TYPES={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.webmanifest':'application/manifest+json'};
const CSP="default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
const BOOT=`(()=>{if(window!==window.top)return;const q=new URLSearchParams(location.search);if(!sessionStorage.getItem('convergence.seeded')){sessionStorage.setItem('convergence.seeded','1');const optional=q.get('recipe')!=='shared';for(const[k,v]of Object.entries({'wos.coached':'true','wos.tour.done':'1','wos.tour.v1':'true','wos.welcome.v1':'done','wux.desk.homeOpen':'true','wos.skin':q.get('skin')||'nebula','wos.app-borders.migrated.v1':'true','wos.pin-buttons.migrated.v1':'true','wos.orb-radial.migrated.v1':'true','wos.skin-tweaks.v1':JSON.stringify({version:1,off:{},preset:'none',mix:optional?{'wizard/orb-radial':true,'wizard/new-send-list':true,'miguel/group-by-day':true}:{},defaultsMigrated:true,defaultsOff:[]})}))localStorage.setItem(k,v);}navigator.sendBeacon=()=>false;})()`;
let refused=0;
function response(res,value,type='application/json',status=200){res.writeHead(status,{'content-type':type,'cache-control':'no-store','content-security-policy':CSP,'permissions-policy':'microphone=(), camera=()'});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://synthetic');
 if(!['GET','HEAD'].includes(req.method)){refused++;return response(res,{error:'Read-only synthetic preview; no write forwarded'},'application/json',403);}
 if(u.pathname==='/__preview/receipt')return response(res,{synthetic:true,upstream:false,writes:false,websockets:false,sha:SHA,refused,recipe:'Explicit optional recipe: orb pins, desktop new-send-list and Group by day; shared recipe leaves all three OFF. No owner skin/preferences were read.',assets:Object.fromEntries(['app.js','live.js','core/skin-host.js','core/orb-switcher.js'].filter(f=>fs.existsSync(path.join(WEB,f))).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(WEB,f))).digest('hex')]))});
 if(u.pathname==='/__preview/bootstrap.js')return response(res,BOOT,'application/javascript');
 if(u.pathname==='/') {res.writeHead(302,{location:'/wizard-os-home/'});return res.end();}
 if(u.pathname==='/wizard/v1/bootstrap')return response(res,{bootstrap:1,api:'wizard-agent-service/1',settings:{owner:{name:'Sample Person'},agent:{name:'Synthetic Agent'},clock:{timezone:'UTC',day_starts_at:'06:00'},voice:{language:'en',vocabulary:[]}},capabilities:{voice:false,files:false,approvals:false,markdown:true},endpoints:{sessions:'/wizard/hermes/api/sessions',runs:'/wizard/hermes/v1/runs',apps:'/wizard/v1/apps'}});
 if(u.pathname==='/wizard/v1/setup')return response(res,{first_run:false});
 if(u.pathname==='/wizard/v1/agents')return response(res,{agents:[{id:'hermes',label:'Synthetic Agent',is_default:true,harness:'hermes',privacy:'standard',status:'running',appearance:{glyph:'spark',hue:265}}]});
 if(u.pathname==='/wizard/hermes/api/model/options')return response(res,{model:'fixture',provider:'fixture',providers:[{slug:'fixture',name:'No inference',authenticated:true,is_current:true,models:['fixture']}]});
 if(u.pathname==='/wizard/v1/apps')return response(res,{schema:1,apps:APPS,in_development:[],slots:{},parking:[]});
 if(u.pathname==='/wizard/hermes/api/sessions')return response(res,{object:'list',data:THREADS,has_more:false});
 if(u.pathname==='/wizard/hermes/api/sessions/synthetic-convergence')return response(res,{session:THREADS[0]});
 if(u.pathname==='/wizard/hermes/api/sessions/synthetic-convergence/messages')return response(res,{object:'list',data:MESSAGES});
 if(u.pathname==='/wizard/v1/ui-preferences')return response(res,{pinnedChats:[],spaces:[],readyOrder:'newest',subjectOrder:[],migrations:{'launcher.v1':true}});
 if(u.pathname==='/wizard/thread-seen')return response(res,{state:{initializedAt:NOW*1000,threads:{}}});
 if(u.pathname==='/wizard/thread-dispositions')return response(res,{state:{}});
 if(u.pathname==='/wizard/v1/skins')return response(res,{active:null,skins:[]});
 if(u.pathname==='/wizard/v1/my-skin')return response(res,u.searchParams.has('format')?{exists:false,empty:true,script:{exists:false}}:'',u.searchParams.has('format')?'application/json':'text/css');
 if(APPS.some(a=>u.pathname.startsWith(a.url)))return response(res,'<!doctype html><meta name="viewport" content="width=device-width"><title>Sample app</title><body style="background:var(--wz-surface,#15121c);color:var(--wz-text,#f5f0ff);font:20px system-ui;padding:24px">Synthetic app fixture. No private app data or writes.</body>','text/html');
 if(/^\/wizard-os-home\/(data|summaries)\.js$/.test(u.pathname))return response(res,'','application/javascript');
 if(u.pathname.startsWith('/wizard-os-home/')){
  let rel;try{rel=decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length))||'index.html';}catch{return response(res,{},'application/json',400);}
  if(rel.split('/').some(x=>x==='..'||x.startsWith('.')))return response(res,{},'application/json',404);
  const candidate=path.resolve(WEB,rel);if(!candidate.startsWith(WEB+path.sep)||!fs.existsSync(candidate))return response(res,{},'application/json',404);
  const real=fs.realpathSync(candidate);if(!real.startsWith(WEB+path.sep)||!fs.statSync(real).isFile())return response(res,{},'application/json',404);
  let body=fs.readFileSync(real);if(['index.html','desktop.html'].includes(rel))body=body.toString().replace(/<head[^>]*>/i,m=>m+'<script src="/__preview/bootstrap.js"></script>');
  return response(res,body,TYPES[path.extname(real)]||'application/octet-stream');
 }
 if(/\/events$/.test(u.pathname))return response(res,'','text/event-stream');
 return response(res,{});
});
server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
server.listen(PORT,'127.0.0.1',()=>console.log(JSON.stringify({port:PORT,sha:SHA,upstream:false,writes:false})));
