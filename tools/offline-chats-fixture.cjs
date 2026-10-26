// Disposable Wizard for offline/Android QA. Never proxies to a real Wizard.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
function fixture(tree=path.resolve(__dirname,'..'),options={}){
 const state={online:true,dropNextRun:false,holdNextRun:false,runs:[],keys:new Map(),posts:[],messagesReads:[],inflight:0,maxInflight:0,uploads:0};
 const now=Date.now()/1000;
 const sessions=Array.from({length:4},(_,i)=>({id:`flight-${i+1}`,title:`Flight thread ${i+1}`,source:'wizard-mobile',message_count:2,last_active:now-i*60,started_at:now-i*60,status:null,model:'qa-model',provider:'qa-provider',archived:false}));
 sessions.push({id:'unsaved',title:'Unsaved older chat',source:'wizard-mobile',message_count:2,last_active:now-864000,started_at:now-864000,status:null,model:'qa-model',provider:'qa-provider',archived:true});
 sessions.push({...sessions[4],id:'recent-older',title:'Recently opened older chat'});
 sessions[3].status='waiting_for_approval';sessions[3].last_run_id='qa-approval';
 const privateThread={...sessions[0],id:'private-thread',title:'Private thread',agent:'private'};
 const messages=id=>[{id:id+'-u1',role:'user',content:'Disposable question for '+id,timestamp:now-60},{id:id+'-a1',role:'assistant',content:id==='private-thread'?'PRIVATE_BODY_MUST_NEVER_BE_STORED':`Saved answer for ${id}. ![not cached](/wizard/attachments/private-image)`,timestamp:now}];
 let seen={initializedAt:Date.now(),threads:{}},port=0;
 const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost'),p=u.pathname;
  if(!state.online && !p.startsWith('/qa/')){req.socket.destroy();return;}
  const json=(data,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
  let bytes=[];for await(const b of req)bytes.push(b);const raw=Buffer.concat(bytes);let body={};try{body=JSON.parse(raw.toString())}catch(_){}
  if(p==='/qa/state')return json({...state,keys:undefined,messagesReads:state.messagesReads});
  if(p==='/qa/control'){Object.assign(state,body);return json({ok:true});}
  if(req.method==='POST')state.posts.push({url:req.url,body,headers:req.headers});
  if(p==='/wizard/v1/bootstrap')return json({bootstrap:1,settings:{owner:{name:'Flight QA'},agent:{name:'Wizard'},clock:{timezone:'UTC',day_starts_at:'00:00'}},capabilities:{voice:true,files:true,approvals:true,markdown:true},endpoints:{transcribe:'/wizard/voice/transcribe',upload:'/wizard/files/upload',apps:'/wizard/v1/apps'}});
  if(p==='/wizard/v1/agents')return json({agents:[{id:'hermes',is_default:true,label:'Wizard',harness:'hermes',privacy:'standard',status:'running',model:{provider:'qa-provider',model:'qa-model'},appearance:{hue:260,glyph:'spark'}},{id:'private',label:'Private',harness:'hermes',privacy:'private',status:'running',model:{provider:'qa-provider',model:'qa-model'},appearance:{hue:200,glyph:'lock'}}]});
  if(p==='/wizard/hermes/api/model/options')return json({provider:'qa-provider',model:'qa-model',providers:[{slug:'qa-provider',name:'Disposable provider',is_current:true,authenticated:true,models:[{id:'qa-model',name:'QA model'}]}]});
  if(p==='/wizard/v1/apps')return json({apps:options.apps||[]});
  if(p==='/wizard/thread-seen'){if(req.method==='PUT')seen=body;return json({state:seen});}
  if(p==='/wizard/thread-dispositions'||p==='/wizard/thread-preferences')return json({state:{}});
  if(p==='/wizard/hermes/api/sessions'){if(req.method==='POST')return json({session:{id:body.id}},201);return json({data:u.searchParams.get('agent')==='private'?[privateThread]:sessions,pagination:{returned:sessions.length,has_more:false}});}
  const m=p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/);
  if(m){const id=decodeURIComponent(m[1]);if(m[2]){state.messagesReads.push(id);return json({data:messages(id),pagination:{returned:2,has_more:false}});}return json({session:id==='private-thread'?privateThread:sessions.find(s=>s.id===id)||{id,model:'qa-model',provider:'qa-provider'}});}
  if(p==='/wizard/files/upload'){state.uploads++;return json({file:{id:'qa-audio-'+state.uploads,filename:'voice.wav',mime:'audio/wav',bytes:raw.length}},201);}
  if(p==='/wizard/voice/transcribe'||p.endsWith('/api/transcribe'))return json({text:'Flight voice reply',ms:1});
  if(p==='/wizard/hermes/v1/runs'&&req.method==='POST'){
    const key=req.headers['idempotency-key'];if(!key)return json({error:'key required'},400);
    let rec=state.keys.get(key);
    if(rec){if(rec.raw!==raw.toString())return json({error:'key conflict'},409);rec.replays++;return json({run_id:rec.runId,status:'queued'},202,{'Idempotency-Replayed':'true'});}
    rec={key,raw:raw.toString(),body,runId:'qa-flight-run-'+(state.runs.length+1),replays:0};state.keys.set(key,rec);state.runs.push(rec);
    state.inflight++;state.maxInflight=Math.max(state.maxInflight,state.inflight);
    const drop=state.dropNextRun,hold=state.holdNextRun;state.dropNextRun=false;state.holdNextRun=false;
    await new Promise(r=>setTimeout(r,hold?12000:250));state.inflight--;
    if(drop){req.socket.destroy();return;}
    return json({run_id:rec.runId,session_id:body.session_id,status:'queued'},202);
  }
  if(p.startsWith('/wizard/hermes/v1/runs/'))return json({status:'completed',run_id:p.split('/')[5],session_id:'flight-1'});
  if(p==='/wizard/hermes/v1/capabilities')return json({features:{approvals:{supported:true}}});
  if(p.startsWith('/troubleshoot/api/'))return json({ok:true,overall:'ok',checks:[]});
  if(p.startsWith('/wizard-os-home/')){
    const file=path.resolve(tree,'web',decodeURIComponent(p.slice('/wizard-os-home/'.length)||'index.html'));
    if(!file.startsWith(path.resolve(tree,'web')+path.sep))return json({},404);
    if(fs.existsSync(file)&&fs.statSync(file).isFile()){
      const ext=path.extname(file),types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'};
      res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache','Service-Worker-Allowed':'/wizard-os-home/'});return fs.createReadStream(file).pipe(res);
    }
    return json({},404);
  }
  return json({});
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}});
 return {state,server,sessions,messages,async start(bind=0){await new Promise(r=>server.listen(bind,'127.0.0.1',r));port=server.address().port;return `http://127.0.0.1:${port}`;},async close(){server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
module.exports={fixture};
if(require.main===module){const f=fixture(process.env.QA_TREE);f.start(Number(process.env.PORT||9397)).then(url=>console.log(url));const close=()=>f.close().then(()=>process.exit());process.on('SIGTERM',close);process.on('SIGINT',close);}
