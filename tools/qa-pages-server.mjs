// Isolated Pages integration origin. No live Hermes, settings, media or queue paths.
// QA_SERVICE_DIR must point at the Agent Service feature/pages-api checkout.
import http from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
if (!process.env.QA_SERVICE_DIR) throw Error('Set QA_SERVICE_DIR to the Pages Agent Service checkout');
const root=mkdtempSync(join(tmpdir(),'pages-shell-qa-'));
const evidence=process.env.QA_EVIDENCE || join(root,'evidence');mkdirSync(evidence,{recursive:true});
// Imported service modules see only this synthetic home.
process.env.HOME=root; process.env.HERMES_HOME=join(root,'hermes');process.env.WIZARD_SETTINGS_PATH=join(root,'settings.json');
const records=[];
const upstream=http.createServer(async(req,res)=>{
 let raw='';for await (const chunk of req) raw+=chunk;
 let body;try{body=JSON.parse(raw)}catch{body=raw}
 const rec={method:req.method,path:req.url,body};records.push(rec);appendFileSync(join(evidence,'stub-upstream.jsonl'),JSON.stringify(rec)+'\n');
 res.setHeader('Content-Type','application/json');
 if(req.url==='/v1/runs'&&req.method==='POST') {res.end(JSON.stringify({run_id:'qa-run-'+records.length,status:'completed',session_id:body.session_id,result:'QA feedback received'}));return;}
 if(req.url?.startsWith('/v1/runs/')) {res.end(JSON.stringify({status:'completed',result:'QA feedback received'}));return;}
 if(req.url?.endsWith('/chat/stream')&&req.method==='POST'){const run_id='qa-run-'+records.length;const runtime={model:body.model,provider:body.provider,model_lock:'accepted'};res.setHeader('Content-Type','text/event-stream');res.end('event: run.started\ndata: '+JSON.stringify({run_id,runtime})+'\n\nevent: run.completed\ndata: '+JSON.stringify({run_id,runtime:{...runtime,model_lock:'confirmed'}})+'\n\n');return;}
 if(req.url?.includes('messages')||req.url?.includes('events')){res.end(JSON.stringify({messages:[],events:[]}));return;}
 if(req.url==='/api/sessions'&&req.method==='POST'){res.end(JSON.stringify({session:{id:body.id,session_id:body.id,title:body.title,source:'wizard',model:'qa-model',provider:'qa'}}));return;}
 if(req.url?.startsWith('/api/sessions')) {res.end(JSON.stringify({sessions:[{id:'wizard_1_pagesqa',session_id:'wizard_1_pagesqa',title:'Pages QA thread',source:'wizard',messages:1,last_active:Date.now()/1000}]}));return;}
 if(req.url?.includes('/model/options')){res.end(JSON.stringify({model:'qa-model',provider:'qa',providers:[{slug:'qa',name:'QA',is_current:true,authenticated:true,models:[{value:'qa-model',name:'QA model'}]}]}));return;}
 if(req.url?.includes('models')){res.end(JSON.stringify({models:[{id:'qa-model',name:'QA model',provider:'qa',available:true}],default_model:'qa-model'}));return;}
 res.end(JSON.stringify({ok:true,sessions:[],capabilities:{}}));
});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const {createWizardServer,listen}=await import(pathToFileURL(join(resolve(process.env.QA_SERVICE_DIR),'server/service.mjs')));
const media=join(root,'media');mkdirSync(media,{recursive:true});
const options={upstreamOrigin:`http://127.0.0.1:${upstream.address().port}`,hermesKey:'qa-only-not-a-credential',requireAccess:false,requireJoinedDelegationCapability:false,followThrough:false,settingsPath:join(root,'settings.json'),mediaRoot:media,mediaIndexPath:join(root,'state/media.json'),runQueueStatePath:join(root,'state/queue.sqlite3'),runQueuePollIntervalMs:25,activeSessionReader:async()=>[],dispatchHealthReader:()=>true,pagesWatch:false,uxDir:resolve(new URL('../web',import.meta.url).pathname)};
const service=createWizardServer(options);
// /__qa/ never exists on production: local-only fixture controls and recorded stub evidence.
const outer=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(req.method==='POST'&&u.pathname==='/wizard/hermes/v1/runs'){let raw='';const emit=req.emit;req.emit=function(type,...args){if(type==='data')raw+=args[0];if(type==='end'){let body;try{body=JSON.parse(raw)}catch{body=raw}const rec={layer:'service-ingress',method:req.method,path:req.url,body};records.push(rec);appendFileSync(join(evidence,'run-ingress.jsonl'),JSON.stringify(rec)+'\n');}return emit.call(this,type,...args);};}
 if(u.pathname==='/__qa/records'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(records));return;}
 if(u.pathname==='/__qa/seed'&&req.method==='POST'){
  const slug=u.searchParams.get('slug');if(!/^[a-z0-9-]+$/.test(slug||'')){res.writeHead(400).end();return;}
  const dir=join(media,'Pages',slug);mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'page.json'),JSON.stringify({title:`QA ${slug}`,kind:'report',project:'Pages shell',thread:u.searchParams.has('noThread') ? null : 'wizard_1_pagesqa',status:'ready',updated:new Date().toISOString()}));
  writeFileSync(join(dir,'doc.md'),'# Version one\n\nThe original report.\n');
  if(!u.searchParams.has('docOnly'))writeFileSync(join(dir,'index.html'),`<!doctype html><meta charset="utf-8"><style>body{font:18px system-ui;padding:24px;background:#202039;color:#fff}button{font:inherit;padding:12px}</style><h1>Pages QA report</h1><p>Isolated, sandboxed page.</p><button id="feedback">Ask the owner to send feedback</button><script>
  window.results=[];addEventListener('message',e=>results.push(e.data));
  document.querySelector('#feedback').onclick=()=>parent.postMessage({type:'wizard-page:feedback',id:'feedback-1',text:'Please improve the QA report.'},'*');
  window.security={};try{localStorage.setItem('probe','x');security.storage='allowed'}catch(e){security.storage=e.name}
  fetch('/wizard/v1/sessions').then(async r=>{security.status=r.status;security.body=await r.text()}).catch(e=>security.fetchError=e.message);
  </script>`);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({slug,root}));return;
 }
 if(process.env.QA_PAGES_ABSENT==='1'&&u.pathname==='/wizard/v1/pages'){res.writeHead(404,{'Content-Type':'application/json'}).end('{"error":"not_found"}');return;}
 service.emit('request',req,res);
});
await new Promise(r=>outer.listen(Number(process.env.PORT||8994),'127.0.0.1',r));
console.log(JSON.stringify({origin:`http://127.0.0.1:${outer.address().port}`,root,upstream:`http://127.0.0.1:${upstream.address().port}`,evidence,service:'feature/pages-api'}));
process.on('SIGTERM',()=>{outer.close();upstream.close();service.close();process.exit(0)});
